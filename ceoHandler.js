import config from "./config.js";

/**
 * Handles messages from CEO users by sending them to a webhook.
 * @param {IncomingContext} messageContext
 * @returns {Promise<void>}
 */
export async function handleCeoMessage(messageContext) {
  const { senderIds, content, chatId, senderName, timestamp } = messageContext;

  // Only process private chats (ignore groups)
  if (chatId.endsWith("@g.us")) {
    return;
  }

  // Check if any of the sender IDs are in the CEO_IDs list
  const isCeo = senderIds.some(id => config.CEO_IDs.includes(id));

  if (!isCeo) {
    return;
  }

  if (!config.CEO_WEBHOOK_URL) {
    console.warn("CEO message detected but CEO_WEBHOOK_URL is not configured.");
    return;
  }

  console.log(`CEO message detected from ${senderName} (${senderIds.join(", ")}). Sending to webhook...`);

  try {
    const payload = {
      senderIds,
      senderName,
      chatId,
      content,
      timestamp,
      rawMessage: messageContext.rawMessage
    };

    const response = await fetch(config.CEO_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook responded with status: ${response.status} ${response.statusText}`);
    }

    console.log("CEO message successfully sent to webhook.");
  } catch (error) {
    console.error("Error sending CEO message to webhook:", error);
  }
}
