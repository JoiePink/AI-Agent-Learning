import "dotenv/config";
import OpenAI from "openai";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod.js";

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

// 联合类型，表示任务类型只能是三者之一
const TaskTypeSchema = z.enum(["frontend", "backend", "test"]);

const RequirementTaskSchema = z.object({
  title: z.string(),
  type: TaskTypeSchema,
  description: z.string(),
  acceptanceCriteria: z.array(z.string()).min(1),
});

const RequirementResultSchema = z.object({
  summary: z.string(),
  missingInformation: z.array(z.string()),
  tasks: z.array(RequirementTaskSchema),
  risks: z.array(z.string()),
});

type RequirementResult = z.infer<typeof RequirementResultSchema>;

// 告诉模型应该怎么工作
const instructions = `
你是一个前端研发团队的需求分析助手。

你的任务是分析用户提供的产品需求，并生成结构化的分析结果。

分析规则：
1. summary：用一句话总结需求的目标。
2. missingInformation：列出需求中没有明确说明、但会影响开发的信息。
3. tasks：把需求拆分为可以执行的开发任务。
4. tasks 中的 type 只能是 frontend、backend 或 test。
5. 每条任务都必须包含标题、描述和至少一条验收标准。
6. risks：列出需求可能涉及的安全、成本、兼容性或业务风险。
7. 不要编造需求中没有提供的接口地址、字段名称和业务规则。
8. 如果信息不明确，把它放入 missingInformation，不要自己猜测。
`;

async function analyzeRequirement(
  requirement: string,
): Promise<RequirementResult> {
  const response = await client.responses.parse({
    model: "gpt-5.6-luna",
    // 负责“内容应该怎么分析”
    instructions,
    input: requirement,
    // 负责“结果必须长什么样”
    text: {
      format: zodTextFormat(RequirementResultSchema, "requirement_analysis"),
    },
  });

  // 响应不完整 incomplete
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

  const parsed = response.output_parsed;
  if (!parsed) {
    throw new Error("模型没有返回可解析的结构化结果");
  }

  return parsed;
}

async function main() {
  const testCases = [
    {
      name: "信息相对清晰的需求",
      requirement: `
小程序新增手机号验证码登录功能。

用户输入手机号后可以获取验证码，填写验证码并点击登录。
登录成功后进入首页，登录失败时显示错误提示。
`,
    },
    {
      name: "非常模糊的需求",
      requirement: `
把个人中心页面做得更好看、更好用。
`,
    },
    {
      name: "涉及高风险操作的需求",
      requirement: `
个人中心新增注销账号功能。
用户确认注销后，删除账号及其全部数据。
`,
    },
  ];

  for (const testCase of testCases) {
    console.log("\n================================");
    console.log("测试场景：", testCase.name);
    console.log("原始需求：", testCase.requirement.trim());
    console.log("正在分析，请稍候……");

    const result = await analyzeRequirement(testCase.requirement);

    console.log("\n分析摘要：", result.summary);
    console.log("缺失信息数量：", result.missingInformation.length);
    console.log("开发任务数量：", result.tasks.length);
    console.log("风险数量：", result.risks.length);

    console.log("\n缺失信息：");

    for (const item of result.missingInformation) {
      console.log("-", item);
    }

    console.log("\n风险：");

    for (const risk of result.risks) {
      console.log("-", risk);
    }
  }
}

main().catch((error) => {
  console.error("运行失败：", error);
});
