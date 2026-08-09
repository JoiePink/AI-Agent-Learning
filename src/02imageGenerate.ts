import "dotenv/config";
import OpenAI from "openai";
import { ProxyAgent, setGlobalDispatcher } from "undici";

if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not defined in the environment variables.");
}

setGlobalDispatcher(new ProxyAgent("http://127.0.0.1:7897"));

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://aihub.top/v1",
});

async function main() {

    const response = await client.responses.create({
        model: 'gpt-5.6-luna',
        input: "生成一张有两只紫色蝴蝶和'Joie Pink'文字的图片，背景透明",
        tools: [{ type: 'image_generation' }]
    })

    const imageData = response.output.filter((item) => item.type === 'image_generation_call').map((item) => item.result)

    if (imageData.length > 0) {
        const imageBase64 = imageData[0]
        const fs = await import('fs')
        fs.writeFileSync('output.svg', Buffer.from(imageBase64, 'base64'));
    }
}

main().catch((error) => {
    console.error("Error:", error);
});