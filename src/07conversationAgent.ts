import { createInterface } from "node:readline/promises";
import "dotenv/config";
import OpenAI from "openai";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { prepareContext } from "./08contextManagement.js";

if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY is not defined in the environment variables.",
  );
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

const instructions = `
你是一个天气查询助手。

工作规则：
1. 需要实时天气数据时，调用 get_weather。
2. 如果当前对话历史中已经有用户需要的天气数据，优先使用已有结果，不要重复调用工具。
3. 只能根据工具返回的数据回答，不要编造天气信息。
4. 比较多个城市时，确保每个城市的数据都完整出现。
5. 最终回答保持简洁，同一句话或同一张表格不要重复输出。
`;

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
    throw new Error(
      `天气接口请求失败：${response.status} ${response.statusText}`,
    );
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

// Agent Loop
async function runAgentTurn(
  input: OpenAI.Responses.ResponseInput,
): Promise<OpenAI.Responses.ResponseInput> {
  const maxSteps = 5;

  for (let step = 0; step < maxSteps; step++) {
    console.log(`\n第${step + 1}轮`);

    input = await prepareContext(input);

    const response = await client.responses.create({
      model: "gpt-5.6-luna",
      input,
      tools,
      instructions
    });

    if (response.status === "incomplete") {
      const reason = response.incomplete_details?.reason;

      if (reason === "max_output_tokens") {
        throw new Error("模型输出达到长度限制，响应未完成");
      }

      if (reason === "content_filter") {
        throw new Error("模型输出因内容过滤而中断");
      }

      throw new Error("模型响应未完成，原因未知");
    }

    for (const output of response.output) {
      if (output.type !== "message") {
        continue;
      }

      // 模型拒绝 refusal
      for (const content of output.content) {
        if (content.type === "refusal") {
          throw new Error(`模型拒绝处理该需求：${content.refusal}`);
        }
      }
    }

    const functionCalls = response.output.filter(
      (item) => item.type === "function_call",
    );

    if (functionCalls.length === 0) {
      const finalAnswer = response.output_text.trim();

      if (finalAnswer === "") {
        throw new Error("模型没有返回工具调用，也没有返回最终文本");
      }

      input.push(
        ...(response.output as unknown as OpenAI.Responses.ResponseInput),
      );

      console.log("\n最终回答：");
      console.log(finalAnswer);
      return input;
    }

    console.log(`模型返回了 ${functionCalls.length}个工具调用`);

    input.push(
      ...(response.output as unknown as OpenAI.Responses.ResponseInput),
    );

    for (const call of functionCalls) {
      if (call.name !== "get_weather") {
        throw new Error(`未知工具：${call.name}`);
      }

      const args = JSON.parse(call.arguments) as {
        city?: unknown;
      };

      if (typeof args.city !== "string" || args.city.trim() === "") {
        throw new Error("get_weather没有收到有效的city参数");
      }

      const city = args.city.trim();
      console.log(`正在查询天气：${city}`);

      const weather = await getWeather(city);

      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(weather),
      });

      console.log(`天气查询完成：${city}`);
    }
  }

  throw new Error(`Agent超过最大执行步数：${maxSteps}`);
}

async function main() {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let input: OpenAI.Responses.ResponseInput = [];

  try {
    while (true) {
      const userInput = (await readline.question("\n你：")).trim();

      if (userInput === "exit") {
        console.log("对话结束");
        break;
      }

      if (userInput === "") {
        continue;
      }

      input.push({
        role: "user",
        content: userInput,
      });

      input = await runAgentTurn(input);
    }
  } finally {
    readline.close();
  }
}

main().catch((error) => {
  console.error("运行失败：", error);
});
