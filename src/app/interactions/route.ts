import { NextRequest } from "next/server";

import { Interaction, InteractionResponse } from "@/types/interaction";
import { InteractionResponseType, InteractionType } from "discord-interactions";
import { HumanMessage } from "@langchain/core/messages";

import { verifyInteractionRequest } from "@/discord/verifyReq";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createSolanaTools, SolanaAgentKit } from "solana-agent-kit";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

const llm = new ChatGoogleGenerativeAI({
  modelName: "gemini-pro",
  temperature: 0.7,
});

const solanaAgent = new SolanaAgentKit(
  process.env.SOLANA_PRIVATE_KEY!,
  process.env.RPC_URL!,
  {
    OPENAI_API_KEY: process.env.GOOGLE_APPLICATION_CREDENTIALS!,
  }
);

const tools = createSolanaTools(solanaAgent);
const memory = new MemorySaver();

const agent = createReactAgent({
  llm,
  tools,
  checkpointSaver: memory,
  messageModifier: `
          You are a helpful agent that can interact onchain using the Solana Agent Kit. You are
          empowered to interact onchain using your tools. If you ever need funds, you can request them from the
          faucet. If not, you can provide your wallet details and request funds from the user. If there is a 5XX
          (internal) HTTP error code, ask the user to try again later. If someone asks you to do something you
          can't do with your currently available tools, you must say so, and encourage them to implement it
          themselves using the Solana Agent Kit, recommend they go to https://www.solanaagentkit.xyz for more information. Be
          concise and helpful with your responses. Refrain from restating your tools' descriptions unless it is explicitly requested.
        `,
});

export async function POST(req: NextRequest) {
  console.log("Received POST request");

  const verifyResult = await verifyInteractionRequest(
    req,
    process.env.DISCORD_PUBLIC_KEY as string
  );

  if (!verifyResult.isValid || !verifyResult.interaction) {
    return new Response("Invalid request", { status: 401 });
  }

  const { interaction } = verifyResult as { interaction: Interaction };
  console.log("Received interaction:", interaction);

  if (interaction.type === InteractionType.PING) {
    console.log("Handling PING interaction");
    return Response.json(
      {
        type: InteractionResponseType.PONG,
      } as InteractionResponse,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  if (interaction.type !== InteractionType.APPLICATION_COMMAND) {
    console.log("Invalid interaction type:", interaction.type);
    return Response.json(
      {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "I only accept, application command",
        },
      } as InteractionResponse,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  const commandName = interaction.data.name;
  console.log("Command received:", commandName);

  if (commandName !== "chat") {
    console.log("Invalid command name");
    return Response.json(
      {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "available command is /chat",
        },
      } as InteractionResponse,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  const message = interaction.data.options[0].value;
  console.log("Processing message:", message);

  const stream = await agent.stream(
    { messages: [new HumanMessage(message)] },
    {
      configurable: {
        thread_id: interaction.user.id || "solana agent kit",
      },
    }
  );

  let botResponse = "";
  try {
    for await (const chunk of stream) {
      if (!("agent" in chunk) || !chunk.agent?.messages?.[0]?.content) {
        continue;
      }
      if (typeof chunk.agent.messages[0].content !== "string") {
        continue;
      }
      botResponse += chunk.agent.messages[0].content;
      console.log("chunk: ", chunk.agent.messages[0].content);
    }
    console.log("Bot response:", botResponse);
    return Response.json(
      {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: botResponse,
        },
      } as InteractionResponse,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error processing stream: ", error);
    return Response.json(
      {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "cannot process the request, an error has occured",
        },
      } as InteractionResponse,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
}
