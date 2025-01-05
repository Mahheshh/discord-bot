import { NextRequest } from "next/server";

import { Interaction, InteractionResponse } from "@/types/interaction";
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from "discord-interactions";
import initializeAgent from "@/lib/initAgent";
import { HumanMessage } from "@langchain/core/messages";

export async function POST(req: NextRequest) {
  console.log("Received POST request");
  const signature = req.headers.get("X-Signature-Ed25519") || "";
  const timestamp = req.headers.get("X-Signature-Timestamp") || "";
  console.log("Request headers:", {
    signature: signature || "missing",
    timestamp: timestamp || "missing",
  });

  if (!signature || !timestamp) {
    console.log("Missing headers:", { signature, timestamp });
    return Response.json(
      {
        message: "Missing required headers",
      },
      { status: 401 }
    );
  }

  const interaction: Interaction = await req.json();
  console.log("Received interaction:", interaction);

  const isValidRequest = await verifyKey(
    JSON.stringify(interaction),
    process.env.DISCORD_PUBLIC_KEY!,
    signature,
    timestamp
  );

  if (!isValidRequest) {
    console.log("Invalid signature detected");
    return Response.json(
      {
        message: "Invalid signature",
      },
      { status: 401 }
    );
  }

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

  const { agent, config } = await initializeAgent();
  console.log("Agent initialized");

  const stream = await agent.stream(
    { messages: [new HumanMessage(message)] },
    config
  );

  let botResponse = "";
  try {
    for await (const chunk of stream) {
      if ("agent" in chunk) {
        botResponse += chunk.agent.messages[0].content;
      }
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
