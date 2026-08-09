import "dotenv/config";
import OpenAI from "openai";
import { ProxyAgent, setGlobalDispatcher } from "undici";

if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not defined in the environment variables.");
}

setGlobalDispatcher(
    new ProxyAgent("http://127.0.0.1:7897")
)

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://aihub.top/v1",
})

// 联合类型，表示任务类型只能是三者之一
type TaskType = "frontend" | "backend" | "test"

// 定义“一条开发任务”应该有什么字段
type RequirementTask = {
    title: string;
    type: TaskType;
    description: string;
    acceptanceCriteria: string[];
}

// 定义一次完整的需求分析结果
type RequirementResult = {
    // 需求摘要
    summary: string;
    // 需求中没有说清楚的信息
    missingInformation: string[];
    // 需要完成的开发任务
    tasks: RequirementTask[];
    // 可能的风险
    risks: string[];
}

function isStringArray(value: unknown): value is string[] {
    return (
        Array.isArray(value) && value.every((item) => typeof item === 'string')
    )
}

const allowedTaskTypes: TaskType[] = [
    "frontend",
    "backend",
    "test"
]

function isRequirementTask(value: unknown): value is RequirementTask {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    // Record<string, unknown>表示这是一个拥有字符串属性名的对象，但我们还不知道每个属性的类型
    const task = value as Record<string, unknown>;

    return (
        typeof task.title === 'string' &&
        typeof task.type === 'string' &&
        allowedTaskTypes.includes(task.type as TaskType) &&
        typeof task.description === 'string' &&
        isStringArray(task.acceptanceCriteria) &&
        // 至少有一条验收标准
        task.acceptanceCriteria.length > 0
    )
}

function isRequirementResult(value: unknown): value is RequirementResult {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const result = value as Record<string, unknown>;

    return (
        typeof result.summary === 'string' &&
        isStringArray(result.missingInformation) &&
        Array.isArray(result.tasks) &&
        // tasks 数组中的每一项，都必须通过 isRequirementTask() 校验
        result.tasks.every(isRequirementTask) &&
        Array.isArray(result.risks) &&
        result.risks.every((item) => typeof item === 'string')
    )
}


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
9. 只返回合法 JSON，不要返回 Markdown 代码块或额外解释。
`;

// 告诉模型这次要分析什么
const requirement: string = `
小程序新增手机号验证码登录功能。

用户输入手机号后可以获取验证码，填写验证码并点击登录。
登录成功后进入首页，登录失败时显示错误提示。
`;

async function analyzeRequirement(requirement: string): Promise<RequirementResult> {
    const response = await client.responses.create({
        model: 'gpt-5.6-luna',
        instructions,
        input: requirement,
    })

    const rawText = response.output_text.trim();

    let parsed: unknown;

    try {
        parsed = JSON.parse(rawText);
    } catch (error) {
        console.error("模型返回的原始内容")
        console.error(rawText)
        throw new Error("模型返回的内容不是合法的 JSON。");
    }

    if (!isRequirementResult(parsed)) {

        console.error("模型返回的原始内容")
        console.error(rawText)

        throw new Error("模型返回的 JSON 不符合 RequirementResult 类型要求。");
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

    const result = await analyzeRequirement(
      testCase.requirement,
    );

    console.log("\n分析摘要：", result.summary);
    console.log(
      "缺失信息数量：",
      result.missingInformation.length,
    );
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