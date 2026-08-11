import "dotenv/config";
import OpenAI from "openai";
import { ProxyAgent, setGlobalDispatcher } from "undici";

if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY is not defined in the environment variables.",
  );
}

setGlobalDispatcher(new ProxyAgent("http://127.0.0.1:7897"));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://aihub.top/v1",
  //   baseURL: "https://true-sota.com",
});

async function conversationIdExample() {
  const conversation = await client.conversations.create();

  console.log("Conversation ID: ", conversation.id);

  const firstResponse = await client.responses.create({
    model: "gpt-5.6-luna",
    conversation: conversation.id,
    input: "请记住，我叫小明。",
  });

  console.log("第一轮 Response ID: ", firstResponse.id);
  console.log("第一轮回答：", firstResponse.output_text);

  const secondResponse = await client.responses.create({
    model: "gpt-5.6-luna",
    conversation: conversation.id,
    input: "我叫什么？",
  });

  console.log("第二轮 Response ID: ", secondResponse.id);
  console.log("第二轮回答：", secondResponse.output_text);
}

async function serverSideCompactionExample(
  input: OpenAI.Responses.ResponseInput,
) {
  const response = await client.responses.create({
    model: "gpt-5.6-luna",
    input,
    context_management: [
      {
        type: "compaction",
        compact_threshold: 80_000,
      },
    ],
  });

  input.push(...(response.output as unknown as OpenAI.Responses.ResponseInput));

  return response;
}

async function standaloneCompactionExample(
  input: OpenAI.Responses.ResponseInput,
) {
  const compacted = await client.responses.compact({
    model: "gpt-5.6-luna",
    input,
  });

  const nextInput: OpenAI.Responses.ResponseInput = [
    ...(compacted.output as unknown as OpenAI.Responses.ResponseInput),
    {
      role: "user",
      content: "继续完成刚才的任务",
    },
  ];

  const response = await client.responses.create({
    model: "gpt-5.6-luna",
    input: nextInput,
  });

  return response;
}

export async function prepareContext(
  input: OpenAI.Responses.ResponseInput,
): Promise<OpenAI.Responses.ResponseInput> {
  const tokenResult = await client.responses.inputTokens.count({
    model: "gpt-5.6-luna",
    input,
  });

  console.log("当前输入 Token：", tokenResult.input_tokens);

  const compactThreshold = 80_000;

  if (tokenResult.input_tokens < compactThreshold) {
    return input;
  }

  const compacted = await client.responses.compact({
    model: "gpt-5.6-luna",
    input,
  });

  return compacted.output as unknown as OpenAI.Responses.ResponseInput;
}
