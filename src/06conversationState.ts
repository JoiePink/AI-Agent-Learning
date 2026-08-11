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

async function main() {
  const firstResponse = await client.responses.create({
    model: "gpt-5.6-luna",
    input: "请记住：我今天正在学习previous_response_id。只回复“已记住”",
    // 允许服务端保存这次响应，以便后续通过它的 ID 延续上下文。
    store: true,
  });

  console.log("第一轮回答：", firstResponse.output_text);
  console.log("第一轮响应ID：", firstResponse.id);

  const secondResponse = await client.responses.create({
    model: "gpt-5.6-luna",
    previous_response_id: firstResponse.id,
    input: "我今天正在学习什么?请简短回答。",
    store: true,
  });

  console.log("第二轮回答：", secondResponse.output_text);
  console.log("第二轮响应ID：", secondResponse.id);
}

main().catch((error) => {
  console.error("运行失败：", error);
});
