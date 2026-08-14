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

const refundOrderTool = tool({
  name: "refund_order",
  description: "根据订单号执行退款操作，执行前必须获得用户批准",
  parameters: z.object({
    orderId: z.string().describe("需要退款的订单号"),
  }),
  needsApproval: true,
  execute: async ({ orderId }) => {
    console.log(`[工具执行] 订单：${orderId} 正在退款`);
    return `模拟环境：订单 ${orderId} 只完成了退款演练，没有操作真实订单`;
  },
});

const refundAgent = new Agent({
  name: "退款专家",
  handoffDescription: "处理退款条件、退款政策和退款进度问题",
  instructions: `
    你是退款专家。

    用户咨询退款条件、政策或进度时，直接回答。
    用户明确要求对某个订单执行退款，并且提供了订单号时，
    必须调用 refund_order 工具，不要直接回答，也不要自行询问是否确认。
    人工审批由程序处理。

    不得在工具执行前声称退款已经完成。
    最终回答必须说明这是模拟环境，没有操作真实订单。
    `,
  model: "gpt-5.6-luna",
  tools: [refundOrderTool],
});

const triageAgent = Agent.create({
  name: "分流客服",
  instructions: `
    你负责识别用户的问题类型。
    遇到退款条件、退款政策或退款进度问题时，
    必须把对话移交给退款专家，不要自行回答。
    `,
  model: "gpt-5.6-luna",
  handoffs: [refundAgent],
});

async function main() {
  const stream = await run(triageAgent, "我想将订单 ORD-1001 退款", {
    stream: true,
  });

  for await (const event of stream) {
    if (event.type === "run_item_stream_event") {
      console.log("运行项目：", event.name);
    }

    if (event.type === "agent_updated_stream_event") {
      console.log("当前 Agent：", event.agent.name);
    }
  }

  await stream.completed;

  console.log("待审批数量：", stream.interruptions.length);

  const interruption = stream.interruptions[0];

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
    stream.state.approve(interruption);
    console.log("操作已批准，准备恢复运行");
  } else {
    stream.state.reject(interruption, {
      message: "用户拒绝退款，本次不要执行退款操作。",
    });
    console.log("操作已拒绝，准备恢复运行");
  }

  // 第二个参数必须是原来的 RunState
  const resumedStream = await run(triageAgent, stream.state, { stream: true });

  for await (const event of resumedStream) {
    if (event.type === "run_item_stream_event") {
      console.log("恢复运行项目：", event.name);
    }
  }

  await resumedStream.completed;

  console.log("恢复后的待审批数量：", resumedStream.interruptions.length);
  console.log("最终输出：", resumedStream.finalOutput);
}

main().catch(console.error);
