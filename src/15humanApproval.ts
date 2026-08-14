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
import readline from "node:readline/promises";

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

const cancelOrderTool = tool({
  name: "cancel_order",
  description: "根据订单号取消订单，这是敏感操作，执行前必须获得用户批准",
  parameters: z.object({
    orderId: z.string().describe("需要取消的订单号"),
  }),
  needsApproval: true,
  execute: async ({ orderId }) => {
    console.log(`[工具执行]正在取消订单：${orderId}`);
    return `模拟环境：订单 ${orderId} 只完成了取消演练，没有操作真实订单。`;
  },
});

const orderAgent = new Agent({
  name: "订单助手",
  instructions: `
        你负责处理订单操作。
        用户要求取消订单时，必须调用cancel_order工具。
        不要自行询问用户是否确认，审批流程由程序处理。
        不得在工具执行前声称订单已经取消。
        最终回答必须准确保留工具结果中的“模拟环境”和“没有操作真实订单”，
        不得把模拟操作描述成真实订单已经取消。
    `,
  model: "gpt-5.6-terra",
  tools: [cancelOrderTool],
});

async function main() {
  const result = await run(orderAgent, "请取消订单 ORD-1001");

  console.log("待审批数量：", result.interruptions.length);

  const interruption = result.interruptions[0];

  if (!interruption) {
    console.log("没有待审批的操作");
    return;
  }

  console.log("审批项目类型：", interruption.type);
  console.log("工具名称：", interruption.name);
  console.log("工具参数：", interruption.arguments);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let approved = false;

  try {
    const answer = await rl.question(
      `是否批准调用 ${interruption.name}, 参数为 ${interruption.arguments}？(y/n)`,
    );
    approved = answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }

  if (approved) {
    result.state.approve(interruption);
    console.log("操作已批准，准备恢复运行");
  } else {
    result.state.reject(interruption, {
      message: "用户拒绝取消订单，本次不要执行取消操作。",
    });
    console.log("操作已拒绝，准备恢复运行");
  }

  // 第二个参数必须是原来的 RunState
  const resumedResult = await run(orderAgent, result.state);

  console.log("恢复后的待审批数量：", resumedResult.interruptions.length);
  console.log("最终输出：", resumedResult.finalOutput);
}

main().catch(console.error);
