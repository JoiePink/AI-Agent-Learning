import {
  Agent,
  setDefaultOpenAIClient,
  setTracingDisabled,
  run,
  handoff,
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

// 关闭 运行轨迹上传
setTracingDisabled(true);

const refundAgent = new Agent({
  name: "退款专家",
  handoffDescription: "处理退款政策、退款条件和退款进度问题。",
  instructions: `
        你是退款专家。
        分流客服把退款问题移交给你之后，由你直接回答用户。
        回答应当简洁、明确。
        不得生成已经执行真实退款。
    `,
  model: "gpt-5.6-luna",
});

const refundHandoffInput = z.object({
  reason: z.string(),
  orderId: z.string().nullable(),
});

const refundHandoff = handoff(refundAgent, {
  toolNameOverride: "transfer_to_refund_specialist",
  toolDescriptionOverride: "把退款政策、退款条件或退款进度问题移交给退款专家",
  inputType: refundHandoffInput,
  onHandoff(_context, input) {
    console.log("发生退款移交：", {
      reason: input?.reason,
      orderId: input?.orderId ?? "未提供",
    });
  },
});

const triageAgent = Agent.create({
  name: "分流客服",
  instructions: `
        你负责识别用户的问题类型。
        遇到退款政策、退款条件或退款进度问题时，
        必须把对话移交给退款专家，不要自行回答。
    `,
  model: "gpt-5.6-luna",
  handoffs: [refundHandoff],
});

async function main() {
  const input = "订单 order-456 收到的商品有质量问题，请问能退款吗？";
  const result = await run(triageAgent, input);
  console.log("最终回答：", result.finalOutput);
  console.log("最终负责的Agent：", result.lastAgent?.name);
}

main().catch(console.error);
