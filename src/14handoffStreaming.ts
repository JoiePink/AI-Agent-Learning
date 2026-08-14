import {
  Agent,
  setDefaultOpenAIClient,
  setTracingDisabled,
  run,
  setOpenAIAPI,
} from "@openai/agents";
import "dotenv/config";
import OpenAI from "openai";
import { ProxyAgent, setGlobalDispatcher } from "undici";

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

const refundAgent = new Agent({
  name: "退款专家",
  handoffDescription: "处理退款条件、退款政策和退款进度问题",
  instructions: `
    你是退款专家。
    接管退款问题后直接回答用户。
    回答应当简洁，不得声称已执行真实退款
    `,
  model: "gpt-5.6-terra",
});

const triageAgent = Agent.create({
  name: "分流客服",
  instructions: `
    你负责识别用户的问题类型。
    遇到退款条件、退款政策或退款进度问题时，
    必须把对话移交给退款专家，不要自行回答。
    `,
  model: "gpt-5.6-terra",
  handoffs: [refundAgent],
});

triageAgent.on("agent_start", (_context, agent) => {
  console.log(`[Hook] ${agent.name} 开始运行`);
});

triageAgent.on("agent_handoff", (_context, nextAgent) => {
  console.log(`[Hook] ${triageAgent.name} 移交给 ${nextAgent.name}`);
});

refundAgent.on("agent_start", (_context, agent) => {
  console.log(`[Hook] ${agent.name} 开始运行`);
});

triageAgent.on("agent_end", (_context, output) => {
  console.log(`[Hook] ${triageAgent.name} 结束，输出长度：${output.length}`);
});

refundAgent.on("agent_end", (_context, output) => {
  console.log(`[Hook] ${refundAgent.name} 结束，输出长度：${output.length}`);
});

async function main() {
  const stream = await run(triageAgent, "我的订单符合什么条件才能退款？", {
    stream: true,
  });

  for await (const event of stream) {
    if (event.type === "run_item_stream_event") {
      console.log("运行项目：", event.name);
    }

    if (event.type === "agent_updated_stream_event") {
      console.log("当前Agent：", event.agent.name);
    }
  }

  await stream.completed;

  console.log("最终负责的Agent", stream.currentAgent?.name);

  console.log("\n最终回答：", stream.finalOutput);
}

main().catch(console.error);
