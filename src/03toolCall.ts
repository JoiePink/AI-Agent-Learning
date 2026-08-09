import "dotenv/config";
import OpenAI from "openai";
import { ProxyAgent, setGlobalDispatcher } from "undici";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not defined in the environment variables.");
}

setGlobalDispatcher(new ProxyAgent("http://127.0.0.1:7897"));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://aihub.top/v1",
});

const tools = [
  {
    type: "function" as const,
    name: "get_weather",
    description: "查询指定城市的实时天气。城市名称支持中文和英文。",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称，例如宁波、北京或 Tokyo。",
        },
      },
      required: ["city"],
      // 这个工具的参数对象只允许定义好的字段 不允许模型额外传入未声明的字段
      additionalProperties: false,
    },
    // 开启严格模式，要求模型生成的工具参数必须严格符合你写的 parameters 规则：city 必填、必须是字符串、不能有额外字段。
    strict: true,
  },
];

type WeatherResponse = {
  city?: string;
  district?: string;
  weather?: string;
  temperature?: number;
  humidity?: number;
  wind_direction?: string;
  wind_power?: string;
  report_time?: string;
};

/**
 * 根据城市名获取天气
 * @param city 
 * @returns 
 */
async function getWeather(city: string) {
  const url = new URL("https://uapis.cn/api/v1/misc/weather");
  // Node.js 内置的 Web API. 把 city 安全地拼到地址中
  url.searchParams.set("city", city);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`天气接口请求失败：${response.status} ${response.statusText}`);
  }

  const weather = (await response.json()) as WeatherResponse;

  return {
    city: weather.city ?? city,
    district: weather.district,
    weather: weather.weather,
    temperature: weather.temperature,
    humidity: weather.humidity,
    windDirection: weather.wind_direction,
    windPower: weather.wind_power,
    reportTime: weather.report_time,
  };
}

async function main() {
  const userInput = "请问宁波今天天气怎么样？需要带伞吗？";
  const input: OpenAI.Responses.ResponseInput = [
    { role: "user", content: userInput },
  ];

  // 第一轮：模型决定是否调用 get_weather，并给出 city 参数。
  const firstResponse = await client.responses.create({
    model: "gpt-5.6-luna",
    input,
    tools,
  });

  const functionCalls = firstResponse.output.filter(
    (item) => item.type === "function_call",
  );

  if (functionCalls.length === 0) {
    console.log(firstResponse.output_text);
    return;
  }

  // 第二步：保留模型输出，真正执行天气查询，并追加每个工具调用的结果。
  // SDK 当前将输出项和后续输入项声明为不同联合类型；运行时它们可按
  // Function Calling 协议原样回传，因此在这里收窄为 ResponseInput。
  input.push(
    ...(firstResponse.output as unknown as OpenAI.Responses.ResponseInput),
  );

  for (const call of functionCalls) {
    const args = JSON.parse(call.arguments) as { city: string };

    if (typeof args.city !== "string" || args.city.trim() === "") {
      throw new Error("模型调用 get_weather 时没有提供有效的 city 参数。");
    }

    const weather = await getWeather(args.city.trim());

    input.push({
      type: "function_call_output",
      call_id: call.call_id,
      output: JSON.stringify(weather),
    });
  }

  // 第三步：把模型的工具调用和真实天气数据一并回传。
  // stream: true 会使 API 持续返回事件，而不是等待整段回答生成完毕。
  const stream = await client.responses.create({
    model: "gpt-5.6-luna",
    input,
    tools,
    stream: true,
  });

  // 只打印文本增量事件；每个 delta 都是一小段刚生成的文字。
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      process.stdout.write(event.delta);
    }
  }

  process.stdout.write("\n");
}

main().catch((error) => {
  console.error("Error:", error);
});
