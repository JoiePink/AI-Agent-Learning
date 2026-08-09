import "dotenv/config";
import OpenAI from "openai";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import fs from "node:fs";
import path from "node:path";

if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not defined in the environment variables.");
}

setGlobalDispatcher(new ProxyAgent("http://127.0.0.1:7897"));

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://aihub.top/v1",
});

async function main() {
    // const filePath = path.resolve(__dirname, "../files/demo.txt");

    // if (!fs.existsSync(filePath)) {
    //     throw new Error(`文件不存在：${filePath}`);
    // }

    // const file = await client.files.create({
    //     file: fs.createReadStream(filePath),
    //     purpose: "user_data",
    // });

    const res = await client.responses.create({
        model: "gpt-5.6-luna",
        input: [
            {
                role: "user",
                content: [
                    {
                        type: "input_file",
                        file_url: "https://www.berkshirehathaway.com/letters/2024ltr.pdf",
                    },
                    {
                        type: "input_text",
                        text: "请分析这个文件的内容，并总结出主要观点。",
                    },
                ],
            },
        ],
    });

    console.log(res.output_text);
}

main().catch((error) => {
    console.error("Error:", error);
});

// async function main() {
//     const res = await client.responses.create({
//         model: 'gpt-5.6-luna',
//         input: "请用三句话解释：什么是AI Agent"
//     })

//     console.log(res.output_text);
// }

// main().catch(err => {
//     console.error("Error:", err);
// })
