import {
  Agent,
  MaxTurnsExceededError,
  MemorySession,
  run,
  Runner,
  setDefaultOpenAIClient,
  setTracingDisabled,
  tool,
  RunContext,
  ModelBehaviorError,
} from "@openai/agents";
import "dotenv/config";
import OpenAI from "openai";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { z } from "zod";

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

setDefaultOpenAIClient(client);

// 暂时关闭默认 Trace 上传，避免第三方密钥无法用于 OpenAI Trace 服务
setTracingDisabled(true);

const runner = new Runner();

const session = new MemorySession({
  sessionId: "weather-learning-session",
});

class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

interface WeatherAppContext {
  userId: string;
  canQueryWeather: boolean;
}

const appContext: WeatherAppContext = {
  userId: "user-123",
  canQueryWeather: true,
};

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

const WeatherSummarySchema = z.object({
  cities: z.array(
    z.object({
      city: z.string(),
      weather: z.string(),
      temperature: z.number(),
      humidity: z.number().min(0).max(100),
    }),
  ),
  summary: z.string(),
});

type WeatherSummary = z.infer<typeof WeatherSummarySchema>;

function printWeatherSummary(
  title: string,
  output: WeatherSummary | undefined,
) {
  console.log(title);
  if (!output) {
    console.log("Agent未生成最终结果");
    return;
  }

  for (const city of output.cities) {
    console.log(
      `${city.city}: ${city.weather},${city.temperature}℃,湿度${city.humidity}%`,
    );
  }

  console.log(`总结：${output.summary}`);
}

const getWeather = tool({
  name: "get_weather",
  description: "查询指定城市的当前天气",
  parameters: z.object({
    city: z.string().describe("需要查询天气的城市名称"),
  }),
  execute: async ({ city }, runContext?: RunContext<WeatherAppContext>) => {
    if (!runContext?.context.canQueryWeather) {
      throw new PermissionDeniedError(
        `用户 ${runContext?.context.userId ?? "unknown"}没有天气查询权限`,
      );
    }

    console.log(`用户 ${runContext.context.userId} 正在查询天气：${city}`);

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
  },
  errorFunction: (_context, error) => {
    console.error("天气工具内部错误：", error);

    if (error instanceof PermissionDeniedError) {
      return "当前用户没有天气查询权限，请明确告知用户无权执行此查询";
    }

    return "天气服务暂时不可用，请告诉用户稍后重试";
  },
  isEnabled: ({ runContext }) => {
    return runContext.context.canQueryWeather;
  },
});

const weatherAgent = new Agent<WeatherAppContext, typeof WeatherSummarySchema>({
  name: "天气助手",
  instructions: (runContext) => {
    const permissionRule = runContext.context.canQueryWeather
      ? "当前用户可以查询天气。需要新数据时调用 get_weather。"
      : "当前用户没有天气查询权限。不要编造天气数据，并明确告知用户无权限。";

    return `
你是一个天气助手。

${permissionRule}

工作规则：
1. 如果历史已有所需天气数据，直接使用已有结果。
2. 只能根据工具返回的数据回答。
3. 回答保持简洁。
`;
  },
  model: "gpt-5.6-terra",
  tools: [getWeather],
  outputType: WeatherSummarySchema,
});

async function main() {
  try {
    const firstResult = await runner.run(
      weatherAgent,
      "请分别查询宁波和杭州今天的天气，并告诉我两座城市的湿度。",
      {
        maxTurns: 5,
        session,
        context: appContext,
      },
    );

    printWeatherSummary("第一轮回答：", firstResult.finalOutput);

    const secondResult = await runner.run(
      weatherAgent,
      "根据刚才已经查询到的结果，两座城市的湿度分别是多少？不要重新查询。",
      {
        session,
        maxTurns: 5,
        context: appContext,
      },
    );

    printWeatherSummary("\n第二轮回答：", secondResult.finalOutput);

    console.log(
      "第二轮工具调用数：",
      secondResult.newItems.filter((item) => item.type === "tool_call_item")
        .length,
    );

    console.log("\n第一轮历史项目数：", firstResult.history.length);
    console.log("第二轮历史项目数：", secondResult.history.length);

    const storedItems = await session.getItems();
    console.log("\nSession存储项目数：", storedItems.length);

  } catch (error) {
    if (error instanceof MaxTurnsExceededError) {
      console.error("Agent未能在规定轮次内生成最终回答");
      return;
    }

    if (error instanceof ModelBehaviorError) {
      console.error("Agent返回的结果不符合预期结构，已阻止后续处理");
      return;
    }

    throw error;
  }
}

main().catch(console.error);
