/**
 * WhatsApp LLM Bot with JavaScript execution capabilities
 */

import { getActions, executeAction } from "./actions.js";
import config from "./config.js";
import { connectToWhatsApp, replyToMessage } from "./whatsapp-adapter.js";
import { initStore } from "./store.js";
import { convertAudioToMp3Base64 } from "./audio_conversion.js";
import { processLlmResponse } from "./aiCall.js";
import './api.js'; // Importar y ejecutar la API
import { retryQueuedMessages } from "./retryQueuedMessages.js";
import { handleCeoMessage } from "./ceoHandler.js";

const { addMessage, closeDb, createChat, getChat, getMessages, getGroupNameDB } = await initStore();

export const MAURO_IR_ID = config.MASTER_IDs[1]

/**
 * Handle incoming WhatsApp messages
 * @param {IncomingContext} messageContext
 * @returns {Promise<void>}
 */
export async function handleMessage(messageContext) {
  const { chatId, senderIds, content, isGroup, senderName, selfIds, mentions } = messageContext;

  const groupName = await getGroupNameDB(chatId);

  console.log("INCOMING MESSAGE:", JSON.stringify(messageContext, null, 2));

  // Check for CEO message and handle it
  await handleCeoMessage(messageContext);


  async function reply(header, text, customChatId) {
    const fullMessage = `${header}\n\n${text}`;
    await replyToMessage(fullMessage, customChatId, messageContext.rawMessage);
  }

  // Create legacy context for actions (maintains backward compatibility)
  /** @type {Context} */
  const context = {
    chatId: chatId,
    senderIds,
    content: content,
    groupName,
    rawMessage: messageContext.rawMessage,
    // sendMessage: async (header, text, customChatId) => {
    //   const fullMessage = `${header}\n\n${text}`;
    //   await messageContext.sendMessage(fullMessage, customChatId);
    // },
    // deleteMessage: async (customChatId) => {
    //   await messageContext.deleteMessage(customChatId);
    // },
  };

  // Load actions
  /** @type {Action[]} */
  const actions = await getActions();

  const firstBlock = content.find(block => block.type === "text")

  if (firstBlock?.text?.startsWith("!")) {
    const [rawCommand, ...args] = firstBlock.text.slice(1).trim().split(" ");
    const command = rawCommand.toLowerCase();

    const action = actions.find(action => action.command === command);

    if (!action) {
      await reply("❌ *Error*", `Unknown command: ${command}`, MAURO_IR_ID);
      return;
    }

    // Map command arguments to action parameters
    /** @type {{[paramName: string]: string}} */
    const params = {};
    Object.entries(action.parameters.properties).forEach(
      ([paramName, param], i) => {
        params[paramName] = args[i] || param.default;
      },
    );

    console.log("executing", action.name, params);

    try {
      const { result } = await executeAction(action.name, context, params);

      if (typeof result === "string") {
        await reply(`⚡ *Command* !${command}`, result, MAURO_IR_ID);
      }
    } catch (error) {
      console.error("Error executing command:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await reply("❌ *Error*", `Error: ${errorMessage}`, MAURO_IR_ID);
    }

    return;
  }

  // Use data from message context
  const time = messageContext.timestamp.toLocaleString("en-EN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Insert chatId into DB if not already present
  // Use groupName for groups, or senderName for individual chats
  const chatName = isGroup ? groupName : senderName;
  await createChat(chatId, chatName);


  // Get system prompt from current chat or use default
  const chatInfo = await getChat(chatId);
  let systemPrompt = chatInfo?.system_prompt || config.system_prompt;

  if (firstBlock) {
    let messageBody_formatted;
    if (isGroup) {

      // Remove mention of self from start of message
      const mentionPattern = new RegExp(`^@(${messageContext.selfIds.join("|")}) *`, "g");
      const cleanedContent = firstBlock.text.replace(mentionPattern, "");

      // TODO: Implement mention replacement using mentions
      messageBody_formatted = `[${time}] ${senderName}: ${cleanedContent}`;
      systemPrompt += `\n\nNombre del grupo: "${groupName}"`;
    } else {
      messageBody_formatted = `[${time}] ${firstBlock.text}`;
    }
    firstBlock.text = messageBody_formatted;
  }

  /** @type {UserMessage} */
  const message = { role: "user", content }

  // Insert message into DB
  await addMessage(chatId, message, senderIds);


  /**
   * Check if the bot should respond to a message
   */
  shouldRespond: {
    // Skip if chat is not enabled
    const chatInfo = await getChat(chatId);
    if (!chatInfo?.is_enabled) {
      return;
    }

    // Respond if in a private chat
    if (!isGroup) {
      break shouldRespond;
    }

    // Respond in groups if I have been mentioned
    const isMentioned = mentions.some((contactId) =>
      selfIds.some(selfId => contactId.startsWith(selfId))
    );
    if (isMentioned || !isMentioned) {
      break shouldRespond;
    }
    return;
  }

  // Get latest messages from DB
  const chatMessages = await getMessages(chatId)

  // Prepare messages for Gemini (convert to Gemini format)
  /** @type {Array} */
  const chatMessages_formatted = [];
  const reversedMessages = chatMessages.reverse();

  // remove starting tool results from the messages
  while (reversedMessages[0]?.message_data?.role === "tool") {
    reversedMessages.shift();
  }

  for (const msg of reversedMessages) {
    switch (msg.message_data?.role) {
      case "user":
        /** @type {Array} */
        const messageParts = []
        for (const contentBlock of msg.message_data.content) {
          switch (contentBlock.type) {
            case "quote":
              for (const quoteBlock of contentBlock.content) {
                switch (quoteBlock.type) {
                  case "text":
                    messageParts.push({ text: `> ${quoteBlock.text.trim().replace(/\n/g, '\n> ')}` });
                    break;
                  case "image":
                    messageParts.push({
                      inlineData: {
                        data: quoteBlock.data,
                        mimeType: quoteBlock.mime_type
                      }
                    });
                    break;
                }
              }
              break;
            case "text":
              messageParts.push({ text: contentBlock.text });
              break;
            case "image":
              messageParts.push({
                inlineData: {
                  data: contentBlock.data,
                  mimeType: contentBlock.mime_type
                }
              });
              break;
            case "audio":
              let format = contentBlock.mime_type?.split("audio/")[1].split(";")[0];
              let data;
              if (format !== "wav" && format !== "mp3") {
                console.warn(`Unsupported audio format: ${contentBlock.mime_type}`);
                data = convertAudioToMp3Base64(contentBlock.data);
                format = "mp3";
              } else {
                data = contentBlock.data;
              }
              messageParts.push({
                inlineData: {
                  data: data,
                  mimeType: `audio/${format}`
                }
              });
              break;
          }
        };
        chatMessages_formatted.push({
          role: "user",
          parts: messageParts,
        });
        break;
      case "assistant":
        /** @type {Array} */
        const assistantParts = [];
        for (const contentBlock of msg.message_data.content) {
          switch (contentBlock.type) {
            case "text":
              assistantParts.push({ text: contentBlock.text });
              break;
            case "tool":
              assistantParts.push({
                functionCall: {
                  name: contentBlock.name,
                  args: JSON.parse(contentBlock.arguments)
                }
              });
              break;
          }
        }
        if (assistantParts.length > 0) {
          chatMessages_formatted.push({
            role: "model",
            parts: assistantParts,
          });
        }
        break;
      case "tool":
        for (const contentBlock of msg.message_data.content) {
          switch (contentBlock.type) {
            case "text":
              chatMessages_formatted.push({
                role: "function",
                parts: [{
                  functionResponse: {
                    name: msg.message_data.tool_id,
                    response: {
                      result: contentBlock.text
                    }
                  }
                }]
              });
              break;
          }
        }
        break;
      // Optionally handle unknown types
      default:
        // Ignore or log unknown message types
        break;
    }
  }

  // Call the modularized LLM response processor

  console.log(await processLlmResponse({
    chatMessages_formatted,
    context,
    chatId,
    senderIds,
    groupName,
    id_master: MAURO_IR_ID,
    systemPrompt
  }));
}

async function setup() {
  // Initialize everything
  const { closeWhatsapp } = await connectToWhatsApp(handleMessage)
    .catch(async (error) => {
      console.error("Initialization error:", error);
      await closeDb();
      process.exit(1);
    })

  // Start retry queue interval after everything is initialized
  console.log("Starting retry queue interval (every 60 seconds)...");
  const retryInterval = setInterval(async () => {
    try {
      console.log("Retrying queued messages...");
      await retryQueuedMessages();
    } catch (error) {
      console.error("Error in retry queue interval:", error);
    }
  }, 60000); // 1 minute


  async function cleanup() {
    try {
      clearInterval(retryInterval);
      await closeWhatsapp();
      await closeDb();
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  }

  process.on("SIGINT", async function () {
    console.log("SIGINT received, cleaning up...");
    await cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", async function () {
    console.log("SIGTERM received, cleaning up...");
    await cleanup();
    process.exit(0);
  });
  process.on("uncaughtException", async (error) => {
    console.error("Uncaught Exception:", error);
    await cleanup();
    process.exit(1);
  });
}

await setup()
