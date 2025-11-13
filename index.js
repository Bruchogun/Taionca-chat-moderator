/**
 * WhatsApp LLM Bot with JavaScript execution capabilities
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { getActions, executeAction } from "./actions.js";
import config from "./config.js";
import { shortenToolId } from "./utils.js";
import { connectToWhatsApp } from "./whatsapp-adapter.js";
import { initStore } from "./store.js";
import { convertAudioToMp3Base64 } from "./audio_conversion.js";
import './api.js'; // Importar y ejecutar la API

const { addMessage, closeDb, createChat, getChat, getMessages } = await initStore();

const MAURO_IR_ID = config.MASTER_IDs[1]

/**
 * Convert actions to Gemini tools format (keeping for backward compatibility but not used)
 * @param {Action[]} actions
 * @returns {Array}
 */
function actionsToGeminiFormat(actions) {
  return actions.map((action) => ({
    functionDeclarations: [{
      name: action.name,
      description: action.description,
      parameters: action.parameters,
    }],
  }));
}

/**
 * Handle incoming WhatsApp messages
 * @param {IncomingContext} messageContext
 * @returns {Promise<void>}
 */
export async function handleMessage(messageContext) {
  const { chatId, senderIds, content, isGroup, senderName, selfIds, mentions, groupName } = messageContext; // added groupName

  console.log("INCOMING MESSAGE:", JSON.stringify(messageContext, null, 2));

  // Create legacy context for actions (maintains backward compatibility)
  /** @type {Context} */
  const context = {
    chatId: chatId,
    senderIds,
    content: content,
    groupName,
    getIsAdmin: async () => {
      const adminStatus = await messageContext.getAdminStatus();
      return adminStatus === "admin" || adminStatus === "superadmin";
    },
    sendMessage: async (header, text, customChatId) => {
      const fullMessage = `${header}\n\n${text}`;
      await messageContext.sendMessage(fullMessage, customChatId);
    },
    reply: async (header, text, customChatId) => {
      const fullMessage = `${header}\n\n${text}`;
      await messageContext.replyToMessage(fullMessage, customChatId);
    },
    deleteMessage: async (customChatId) => {
      await messageContext.deleteMessage(customChatId);
    },
  };

  // Load actions
  /** @type {Action[]} */
  const actions = await getActions();

  const firstBlock = content.find(block=>block.type === "text")

  if (firstBlock?.text?.startsWith("!")) {
    const [rawCommand, ...args] = firstBlock.text.slice(1).trim().split(" ");
    const command = rawCommand.toLowerCase();

    const action = actions.find(action => action.command === command);

    if (!action) {
      await context.reply("❌ *Error*", `Unknown command: ${command}`,MAURO_IR_ID);
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
        await context.reply(`⚡ *Command* !${command}`, result, MAURO_IR_ID);
      }
    } catch (error) {
      console.error("Error executing command:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await context.reply("❌ *Error*", `Error: ${errorMessage}`, MAURO_IR_ID);
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
  const message = {role: "user", content}

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

  // Initialize LLM client
  const genAI = new GoogleGenerativeAI(config.llm_api_key || "");
  
  // Configure the model with tools (deduplicate by name)
  const seenNames = new Set();
  /** @type {Action[]} */
  const uniqueActions = [];
  for (const action of actions) {
    if (!seenNames.has(action.name)) {
      seenNames.add(action.name);
      uniqueActions.push(action);
    }
  }
  
  const toolsConfig = uniqueActions.length > 0 ? {
    functionDeclarations: uniqueActions.map((action) => ({
      name: action.name,
      description: action.description,
      parameters: {
        type: "OBJECT",
        properties: action.parameters.properties,
        required: action.parameters.required,
      },
    }))
  } : undefined;

  const model = genAI.getGenerativeModel({ 
    model: config.model,
    systemInstruction: systemPrompt,
    // @ts-ignore - Type mismatch with SchemaType
    tools: toolsConfig ? [toolsConfig] : undefined,
  });

  async function processLlmResponse() {//Modularizar esto

    let response;
    try {
      console.log(JSON.stringify(chatMessages_formatted, null, 2))
      
      // Start chat with history
      const chat = model.startChat({
        history: chatMessages_formatted.slice(0, -1), // All messages except the last one
      });
      
      // Send the last message
      const lastMessage = chatMessages_formatted[chatMessages_formatted.length - 1];
      const result = await chat.sendMessage(lastMessage.parts);
      response = result.response;
    } catch (error) {
      console.error(error);
      const errorMessage = JSON.stringify(error, null, 2);
      await context.reply(
        "❌ *Error*",
        "An error occurred while processing the message.\n\n" + errorMessage,
        MAURO_IR_ID
      );
      return;
    }

    // Get response text (may be empty if only function calls)
    let responseText = "";
    try {
      responseText = response.text();
    } catch (e) {
      // No text content, only function calls
      console.log("No text content in response");
    }
    const functionCalls = response.functionCalls();

    // Add assistant message to conversation context
    /** @type {AssistantMessage} */
    const assistantMessage = {
      role: "assistant",
      content: [],
    };

    if (responseText && responseText.trim()) {
      console.log("RESPONSE SENT:", responseText);
      // const filteredSenderId = senderIds.filter(x => x !== "unknown" && x.length < 14)[0] + "@s.whatsapp.net";
      // await context.reply("🤖 *AI Assistant*", responseText, filteredSenderId);
      assistantMessage.content.push({
        type: "text",
        text: responseText,
      });
    }


    if (functionCalls && functionCalls.length > 0) {
      // Add tool calls to assistant message
      for (const functionCall of functionCalls) {
        const toolId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        assistantMessage.content.push({
          type: "tool",
          tool_id: toolId,
          name: functionCall.name,
          arguments: JSON.stringify(functionCall.args)
        })

        // Show tool call to user
        const shortId = shortenToolId(toolId);
        // await context.sendMessage(
        //   `🔧 *Executing* ${functionCall.name}    [${shortId}]`,
        //   `parameters:\n\`\`\`\n${JSON.stringify(functionCall.args, null, 2)}\n\`\`\``,
        //   MAURO_IR_ID
        // );
      }

      // Store tool calls in database
      await addMessage(chatId, assistantMessage, senderIds)

      // Add assistant message with tool calls to conversation context
      chatMessages_formatted.push({
        role: "model",
        parts: functionCalls.map(fc => ({
          functionCall: {
            name: fc.name,
            args: fc.args
          }
        }))
      });

      let continueProcessing = false;

      // Create a map of function names to tool IDs
      const toolIdMap = new Map();
      for (const content of assistantMessage.content) {
        if (content.type === "tool") {
          toolIdMap.set(content.name, content.tool_id);
        }
      }

      for (const functionCall of functionCalls) {
        const toolName = functionCall.name;
        const toolArgs = { ...functionCall.args, groupName };// added groupName
        const toolId = toolIdMap.get(toolName);
        const shortId = shortenToolId(toolId);
        console.log("executing", toolName, toolArgs);

        try {
          const functionResponse = await executeAction(
            toolName,
            context,
            toolArgs,
            toolId,
          );
          console.log("response", functionResponse);

          if (toolName !== "new_conversation") {
            // Store tool result in database
            /** @type {ToolMessage} */
            const toolMessage = {
              role: "tool",
              tool_id: toolId,
              content: [{type: "text", text: JSON.stringify(functionResponse.result)}]
            }
            await addMessage(chatId, toolMessage, senderIds)
          }

          const resultMessage =
            typeof functionResponse.result === "string"
              ? functionResponse.result
              : JSON.stringify(functionResponse.result, null, 2);
          // Show tool result to user
          // await context.sendMessage(
          //   `✅ *Result*    [${shortId}]`,
          //   resultMessage,
          //   MAURO_IR_ID
          // );

          if (functionResponse.permissions.autoContinue) {
            // If the tool result indicates to continue processing, set flag
            continueProcessing = true;
          }

          // Add tool result to conversation context
          chatMessages_formatted.push({
            role: "function",
            parts: [{
              functionResponse: {
                name: toolName,
                response: {
                  result: resultMessage
                }
              }
            }]
          });

        } catch (error) {
          console.error("Error executing tool:", error);
          const errorMessage = `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
          // Store error as tool result
          /** @type {ToolMessage} */
          const toolError = {
            role: "tool",
            tool_id: toolId,
            content: [{type: "text", text: errorMessage}],
          }
          await addMessage(chatId, toolError, senderIds)

          // Show tool error to user
          await context.sendMessage(
            `❌ *Tool Error*    [${shortId}]`,
            errorMessage,
            MAURO_IR_ID
          );

          // Continue processing to selffix the error
          continueProcessing = true;

          // Add tool error to conversation context
          chatMessages_formatted.push({
            role: "function",
            parts: [{
              functionResponse: {
                name: toolName,
                response: {
                  error: errorMessage
                }
              }
            }]
          });
        }

      }

      // Recursively process LLM response after tool execution
      if (continueProcessing) {
        await processLlmResponse();
      }
    } else {
      // Only add assistant message if no tool calls (to avoid duplicates)
      if (assistantMessage.content.length > 0) {
        await addMessage(chatId, assistantMessage, senderIds);
      }
    }
  }

  await processLlmResponse();
}

async function setup () {
  // Initialize everything
  const { closeWhatsapp } = await connectToWhatsApp(handleMessage)
    .catch(async (error) => {
      console.error("Initialization error:", error);
      await closeDb();
      process.exit(1);
    })


  async function cleanup() {
    try {
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
