import {
  Agent,
  setDefaultOpenAIClient,
  setTracingDisabled,
  run,
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

// 关闭 运行轨迹上传
setTracingDisabled(true);

// 可以独立运行的Agent
const refundSpecialist = new Agent({
  name: "退款专家",
  instructions: `
        你是退款政策专家。
        你只负责分析退款问题，并给出简洁的专业建议。
        你不能声称已经执行了真实退款。
    `,
  model: "gpt-5.6-luna",
});

// 主管Agent可以调用的工具
const refundSpecialistTool = refundSpecialist.asTool({
  toolName: "ask_refund_specialist",
  toolDescription: "咨询退款政策、退款条件和退款限制",
});

const logisticsSpecialist = new Agent({
  name: "物流专家",
  instructions: `
    你是物流问题专家。
    你只负责分析配送、签收、拒收和退货运输问题。
    回答应当简洁，不要处理退款政策。
    `,
  model: "gpt-5.6-luna",
});

const logisticsSpecialistTool = logisticsSpecialist.asTool({
  toolName: "ask_logistics_specialist",
  toolDescription: "咨询配送、签收、拒收和退货运输问题。",
});

const customerServiceManager = new Agent({
  name: "客服主管",
  instructions: `
    你负责统一回复用户。

    当用户询问退款政策、退款条件或退款限制时：
    1. 必须调用ask_refund_specialist
    2. 阅读退款专家的意见
    3. 用简洁、友好的语言向用户提供最终回答

    当问题设计配送、签收、拒收或退货运输时，必须调用ask_logistics_specialist。

    如果问题同时涉及退款和物流，需要分别咨询两位专家，再统一回复客户。
    `,
  model: "gpt-5.6-luna",
  tools: [refundSpecialistTool, logisticsSpecialistTool],
});

async function main() {
  const input = "商品签收后发现有质量问题，我想退款，退货应该怎么寄回？";

  const result = await run(customerServiceManager, input);

  const calledTools = result.newItems
    .filter(
      (item) =>
        item.type === "tool_call_item" && item.rawItem.type === "function_call",
    )
    .map((item) => item.rawItem.name);

  console.log("主管调用的工具：",calledTools)  

  console.log("最终回答：", result.finalOutput);
  console.log("最终负责的Agent：", result.lastAgent?.name);
}

main().catch(console.error);
