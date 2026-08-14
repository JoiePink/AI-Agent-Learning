import {
  Agent,
  setDefaultOpenAIClient,
  setTracingDisabled,
  run,
  setOpenAIAPI,
  tool,
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

// 配置本地代理
setGlobalDispatcher(new ProxyAgent("http://127.0.0.1:7897"));

// 创建第三方网关客户端
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://aihub.top/v1",
});

// 设置Agents SDK默认客户端
setDefaultOpenAIClient(client);

// 底层模型请求改用Chat Completions
setOpenAIAPI("chat_completions");

// 关闭 运行轨迹上传
setTracingDisabled(true);

const getConceptExample = tool({
  name: "get_concept_example",
  description: "获取指定技术概念的简短示例",
  parameters: z.object({
    concept: z.string(),
  }),
  execute: async ({ concept }) => {
    console.log(`正在查询示例：${concept}`);
    return `${concept}示例：大模型在生成回答时，边生成边把文字显示给用户。`;
  },
});

const streamingAgent = new Agent({
  name: "流式讲解助手",
  instructions: `
        你负责用简洁的中文解释技术概念。
        回答前必须调用get_concept_example获取示例
        根据工具返回的示例组织三个简洁段落
    `,
  model: "gpt-5.6-terra",
  tools: [getConceptExample],
});

async function main() {
  const stream = await run(
    streamingAgent,
    "请用三个简短段落解释什么是流式输出。",
    {
      stream: true,
    },
  );

  for await (const event of stream) {
    if (event.type === "run_item_stream_event") {
      console.log("运行项目：", event.name);
    }
  }

  // 等待完整结束
  await stream.completed;
  console.log("\n\n最终结果：", stream.finalOutput);
}

main().catch(console.error);
