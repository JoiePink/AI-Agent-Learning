import {
  Agent,
  InputGuardrailTripwireTriggered,
  OutputGuardrailTripwireTriggered,
  run,
  setDefaultOpenAIClient,
  setTracingDisabled,
  defineToolInputGuardrail,
  ToolGuardrailFunctionOutputFactory,
  tool,
  ToolInputGuardrailTripwireTriggered,
  ToolCallError,
  defineToolOutputGuardrail,
  type InputGuardrail,
  type OutputGuardrail,
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

// 定义检查规则
const secretRequestGuardrail: InputGuardrail = {
  // Guardrail名称，方便诊断
  name: "secret_request_guardrail",
  // 启动前不执行Agent
  runInParallel: false,

  // 执行检查并返回结果
  async execute({ input }) {
    const inputText = typeof input === "string" ? input : JSON.stringify(input);

    const normalizedInput = inputText.toLowerCase();

    const containsSecretRequest =
      normalizedInput.includes("api key") || normalizedInput.includes("密钥");

    return {
      // 记录检查原因和诊断信息
      outputInfo: {
        reason: containsSecretRequest ? "用户请求读取敏感密钥" : "输入检查通过",
      },

      // true触发拦截  false允许继续
      tripwireTriggered: containsSecretRequest,
    };
  },
};

const responseLengthGuardrail: OutputGuardrail = {
  name: "response_length_guardrail",

  async execute({ agentOutput }) {
    const maxLength = 30;
    const outputLength = agentOutput.length;
    const exceedsLimit = outputLength > maxLength;
    return {
      outputInfo: {
        outputLength,
        maxLength,
        reason: exceedsLimit ? "最终回答超过长度限制" : "最终回答长度合格",
      },
      tripwireTriggered: exceedsLimit,
    };
  },
};

const refundAmountGuardrail = defineToolInputGuardrail({
  name: "refund_amount_guardrail",

  async run({ toolCall }) {
    let args: unknown;

    try {
      args = JSON.parse(toolCall.arguments);
    } catch (error) {
      return ToolGuardrailFunctionOutputFactory.throwException({
        reason: "退款工具参数不是有效JSON",
      });
    }

    const amount =
      typeof args === "object" && args !== null && "amount" in args
        ? args.amount
        : undefined;

    if (typeof amount !== "number") {
      return ToolGuardrailFunctionOutputFactory.throwException({
        reason: "退款金额不是有效数字",
      });
    }

    const maxAmount = 1000;

    if (amount > maxAmount) {
      return ToolGuardrailFunctionOutputFactory.rejectContent(
        "单次退款金额不能超过1000元。",
        {
          amount,
          maxAmount,
        },
      );
    }

    return ToolGuardrailFunctionOutputFactory.allow({
      amount,
      maxAmount,
    });
  },
});

const refundOutputGuardrail = defineToolOutputGuardrail({
  name: "refund_output_guardrail",
  async run({ output }) {
    const containsInternalToken =
      typeof output === "object" &&
      output !== null &&
      "internalToken" in output;

    if (containsInternalToken) {
      return ToolGuardrailFunctionOutputFactory.rejectContent(
        "退款结果包含敏感字段，已阻止输出",
        {
          reason: "检测到 internalToken",
        },
      );
    }

    return ToolGuardrailFunctionOutputFactory.allow({
      reason: "退款结果检查通过",
    });
  },
});

const refundTool = tool({
  name: "refund",
  description: "为指定订单执行模拟退款。",
  parameters: z.object({
    orderId: z.string(),
    amount: z.number().positive(),
  }),
  inputGuardrails: [refundAmountGuardrail],
  outputGuardrails: [refundOutputGuardrail],

  async execute({ orderId, amount }) {
    // 最终业务防线，即使Guardrail配置被移除，也不能超额退款
    if (amount > 1000) {
      throw new Error("退款金额超过业务上限。");
    }

    console.log(`正在执行模拟退款：${orderId}, ${amount}元`);
    return {
      success: true,
      orderId,
      amount,
    };
  },
});

const guardedAgent = new Agent({
  name: "安全助手",
  instructions: "简洁回答用户的问题",
  model: "gpt-5.6-luna",
  inputGuardrails: [secretRequestGuardrail],
  outputGuardrails: [responseLengthGuardrail],
});

const refundAgent = new Agent({
  name: "退款助手",
  instructions: `
    你负责处理模拟退款请求

    规则：
    1. 用户要求退款时，必须调用refund工具
    2. 不得自行声称退款成功
    3. 如果工具拒绝退款，应向用户说明拒绝原因
    4. 回答保持简洁
    `,
  model: "gpt-5.6-terra",
  tools: [refundTool],
});

async function main() {
  const input = "请为订单 order-123 模拟退款500元";

  try {
    const result = await run(refundAgent, input);
    console.log("退款助手回答：", result.finalOutput);
  } catch (error) {
    if (error instanceof InputGuardrailTripwireTriggered) {
      console.error("输入已被Guardrail拦截：", error.result.output.outputInfo);
      return;
    }

    if (error instanceof OutputGuardrailTripwireTriggered) {
      console.error(
        "最终回答已被Guardrail拦截：",
        error.result.output.outputInfo,
      );
      return;
    }

    if (
      error instanceof ToolCallError &&
      error.error instanceof ToolInputGuardrailTripwireTriggered
    ) {
      console.error("工具触发异常: ", error.error.result.output.outputInfo);
      return;
    }

    throw error;
  }
}

main().catch(console.error);
