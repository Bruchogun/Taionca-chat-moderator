/**
 * AI Call Module - Handles LLM response processing and tool execution
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { executeAction, getActions } from "./actions.js";
import { shortenToolId } from "./utils.js";
import config from "./config.js";
import { initStore } from "./store.js";
import { replyToMessage, sendMessage } from "./whatsapp-adapter.js";

const { addMessageToQueue, addMessage } = await initStore();

/**
 * Process LLM response, execute tools, and handle recursive calls
 * @param {{
 *   chatMessages_formatted: Array,
 *   context: Context,
 *   chatId: string,
 *   senderIds: string[],
 *   groupName: string,
 *   id_master: string,
 *   systemPrompt: string
 * }} params
 * @returns {Promise<any>}
 * 
 */
export async function processLlmResponse({
  chatMessages_formatted,
  context,
  chatId,
  senderIds,
  groupName,
  id_master,
  systemPrompt
}) {
  // Load actions
  /** @type {Action[]} */
  const actions = await getActions();

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
    const errorMessage = JSON.stringify(error, null, 2);

    const messageToQueue = {
        chatMessages_formatted,
        context,
        chatId,
        senderIds,
        groupName,
        id_master,
        systemPrompt,
        errorMessage
    }

    await replyToMessage(
      "❌ *Error* \n\nAn error occurred while processing the message.\n\n" + errorMessage,
      id_master,
      context.rawMessage
    );
    console.log("QUEUED MESSAGE DUE TO ERROR:", messageToQueue);
    await addMessageToQueue(
      chatMessages_formatted,
      context,
      chatId,
      senderIds,
      groupName,
      id_master, // id_master
      systemPrompt,
      errorMessage
    )
    return messageToQueue;
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
        await sendMessage(
          `❌ *Tool Error*   [${shortId}]\n\n` + errorMessage,
          id_master
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
      await processLlmResponse({
        chatMessages_formatted,
        context,
        chatId,
        senderIds,
        groupName,
        id_master,
        systemPrompt
      });
    }
  } else {
    // Only add assistant message if no tool calls (to avoid duplicates)
    if (assistantMessage.content.length > 0) {
      await addMessage(chatId, assistantMessage, senderIds);
    }
  }
}
