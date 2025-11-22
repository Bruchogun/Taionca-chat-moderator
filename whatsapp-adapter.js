/**
 * WhatsApp Service - High-level abstraction over Baileys
 * Provides message-scoped APIs for easier migration to other WhatsApp clients
 */

import {
  makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import { exec } from "child_process";
import { handleMessage } from "./index.js";

/** @typedef {import("@hapi/boom").Boom<unknown>} BoomError */
/** @typedef {import("@whiskeysockets/baileys").WAMessage} WAMessage */
/** @typedef {import("@whiskeysockets/baileys").WAMessageKey} WAMessageKey */

/**
 * Type guard to detect Boom errors returned by Baileys.
 * @param {unknown} error
 * @returns {error is BoomError}
 */
function isBoomError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = /** @type {Record<string, unknown>} */ (error);
  return candidate.isBoom === true && "output" in candidate;
}

// Export sock instance for API access
/** @type {BaileysSocket | null} */
export let sock = null;

/**
 *
 * @param {BaileysMessage} baileysMessage
 * @returns {Promise<IncomingContentBlock[]>}
 */
async function getMessageContent(baileysMessage) {
  /** @type {IncomingContentBlock[]} */
  const content = [];

  // Check for quoted message content
  const quotedMessage = baileysMessage.message?.extendedTextMessage?.contextInfo?.quotedMessage
    || baileysMessage.message?.imageMessage?.contextInfo?.quotedMessage
    || baileysMessage.message?.videoMessage?.contextInfo?.quotedMessage
    || baileysMessage.message?.documentMessage?.contextInfo?.quotedMessage
    || baileysMessage.message?.audioMessage?.contextInfo?.quotedMessage
    || baileysMessage.message?.stickerMessage?.contextInfo?.quotedMessage;

  if (quotedMessage) {
    const quoteText = quotedMessage.conversation
      || quotedMessage.extendedTextMessage?.text
      || quotedMessage.imageMessage?.caption
      || quotedMessage.videoMessage?.caption
      || quotedMessage.documentMessage?.caption


    // const quotedSenderId = baileysMessage.message?.extendedTextMessage?.contextInfo?.participant;

    /** @type {QuoteContentBlock} */
    const quote = {
      type: "quote",
      content: [],
    };

    // if (quotedMessage.imageMessage) {
    //   quote.content.push(
    //     /** @type {ImageContentBlock} */
    //     ({
    //       type: "image",
    //       encoding: "base64",
    //       mime_type: quotedMessage.imageMessage.mimetype,
    //       data: Buffer.from(quotedMessage.imageMessage.jpegThumbnail).toString('base64')
    //     })
    //   )
    // }

    if (quoteText) {
      quote.content.push(
        /** @type {TextContentBlock} */
        ({
          type: "text",
          text: quoteText,
        })
      )
    }

    if (quote.content.length > 0) {
      content.push(quote);
    }
  }

  // Check for image content (including quoted images)
  const imageMessage = baileysMessage.message?.imageMessage;
  const videoMessage = baileysMessage.message?.videoMessage;
  const audioMessage = baileysMessage.message?.audioMessage;
  const textMessage = baileysMessage.message?.conversation
    || baileysMessage.message?.extendedTextMessage?.text
    || baileysMessage.message?.documentMessage?.caption

  if (imageMessage) {
    // Handle image message
    const messageForDownload = /** @type {WAMessage} */ (baileysMessage);
    const imageBuffer = await downloadMediaMessage(
      messageForDownload,
      "buffer",
      {},
    );
    const base64Data = imageBuffer.toString("base64");
    const mimetype = imageMessage.mimetype;

    if (mimetype) {
      content.push({
        type: "image",
        encoding: "base64",
        mime_type: mimetype,
        data: base64Data,
      });
    } else {
      content.push({
        type: "text",
        text: "Error reading image: No mimetype found",
      });
    }
    if (imageMessage.caption) {
      content.push({
        type: "text",
        text: imageMessage.caption,
      });
    }
  }

  if (videoMessage) {
    // Handle video message
    const messageForDownload = /** @type {WAMessage} */ (baileysMessage);
    const videoBuffer = await downloadMediaMessage(
      messageForDownload,
      "buffer",
      {},
    );
    const base64Data = videoBuffer.toString("base64");
    const mimetype = videoMessage.mimetype;

    content.push({
      type: "video",
      encoding: "base64",
      mime_type: mimetype || undefined,
      data: base64Data,
    });
    if (videoMessage.caption) {
      content.push({
        type: "text",
        text: videoMessage.caption,
      });
    }
  }

  if (audioMessage) {
    // Handle audio message
    const messageForDownload = /** @type {WAMessage} */ (baileysMessage);
    const audioBuffer = await downloadMediaMessage(
      messageForDownload,
      "buffer",
      {},
    );
    const base64Data = audioBuffer.toString("base64");
    const mimetype = audioMessage.mimetype;

    content.push({
      type: "audio",
      encoding: "base64",
      mime_type: mimetype || undefined,
      data: base64Data,
    });
  }

  if (textMessage) {
    // Handle text message
    content.push({
      type: "text",
      text: textMessage,
    });
  }

  if (content.length === 0) {
    console.log("Unknown baileysMessage", JSON.stringify(baileysMessage, null, 2));
  }

  return content;
}


  export async function getGroupName(chatId){
    if (!sock) throw new Error("WhatsApp socket not initialized");
    const groupMetadata = await sock.groupMetadata(chatId).catch(err => {
      console.error("Error fetching group metadata:", err);
      return null;
    });
    return groupMetadata?.subject || null;
  }


/** @type {(chatId, senderIds) => Promise<boolean>}*/
  export async function getIsAdmin (chatId, senderIds){
    if(!sock) throw new Error("WhatsApp socket not initialized");
    const isGroup = !!chatId?.endsWith("@g.us");
    if (!isGroup) return true; // In private chats, treat as admin
    try {
      const groupMetadata = await sock.groupMetadata(chatId);
      const participant = groupMetadata.participants.find(
        participant => senderIds.includes(participant.id)
      );
      return participant?.admin === "admin" || participant?.admin === "superadmin";
    } catch (error) {
      console.error("Error checking group admin status:", error);
      return false;
    }
  }

/** @type {(text: string, chatId: string) => Promise<void>}*/
  export async function sendMessage (text, chatId){
    if(!sock) throw new Error("WhatsApp socket not initialized");
    await sock.sendMessage(chatId, { text });
  }

/** @type {(text: string, chatId: string, baileysMessage) => Promise<void>}*/
  export async function replyToMessage (text, chatId, baileysMessage){
    if(!sock) throw new Error("WhatsApp socket not initialized");
    const quotedMessage = /** @type {WAMessage} */ (baileysMessage);
    await sock.sendMessage(chatId, { text }, { quoted: quotedMessage });
  }

  /** @type {(chatId: string, messageKey: any) => Promise<void>}*/
  export async function deleteMessage (chatId, messageKey){
    if(!sock) throw new Error("WhatsApp socket not initialized");
    await sock.sendMessage(chatId, { delete: messageKey });
  }


/**
 * Internal method to process incoming messages and create enriched context
 * @param {BaileysMessage} baileysMessage - Raw Baileys message
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 */
async function adaptIncomingMessage(baileysMessage, sock) {
  // Extract message content from Baileys format
  // Ignore status updates
  if (!baileysMessage.key?.remoteJid) {
    console.warn("Skipping message with missing remoteJid", baileysMessage);
    return;
  }

  if (baileysMessage.key.remoteJid === "status@broadcast") {
    return;
  }

  const content = await getMessageContent(baileysMessage);

  if (content.length === 0) {
    return
  }

  const messageKey = /** @type {WAMessageKey} */ (baileysMessage.key);
  const chatId = messageKey.remoteJid || "";
  /** @type {string[]} */
  const senderIds = [];
  const keyInfo = /** @type {Partial<Record<string, string | undefined>>} */ (messageKey ?? {});
  const idCandidates = [
    keyInfo.participant,
    keyInfo.remoteJid,
    keyInfo.participantPn,
    keyInfo.participantLid,
    keyInfo.participantPid,
    keyInfo.senderLid,
    keyInfo.senderPid,
  ];

  for (const candidate of idCandidates) {
    if (candidate && !senderIds.includes(candidate)) {
      senderIds.push(candidate);
    }
  }
  console.log("New baileysMessage", baileysMessage, "New baileysMessage");

  const isGroup = !!chatId?.endsWith("@g.us");

  // Create timestamp
  const timestamp =
    (typeof baileysMessage.messageTimestamp === "number")
      ? new Date(baileysMessage.messageTimestamp * 1000)
      : (!baileysMessage.messageTimestamp)
        ? new Date()
        : new Date(baileysMessage.messageTimestamp.toNumber() * 1000);


  /** @type {string[]} */
  const selfIds = [];
  {
    const lid = sock.user?.lid?.split(":")[0] || sock.user?.lid;
    const id = sock.user?.id?.split(":")[0] || sock.user?.id;
    if (id) selfIds.push(id);
    if (lid) selfIds.push(lid);
  }

  /** @type {IncomingContext} */
  const messageContext = {
    // Message data
    chatId,
    senderIds: senderIds,
    senderName: baileysMessage.pushName || "",
    content: content,
    isGroup,
    timestamp,
    rawMessage: baileysMessage,

    // Bot info
    selfIds: selfIds || [],
    selfName: sock.user?.name || "",

    // Raw mention data
    mentions:
      baileysMessage.message?.extendedTextMessage?.contextInfo?.mentionedJid
      || [],
  };

  // Call the user-provided message handler with enriched context
  await handleMessage(messageContext);
}

/**
 * Initialize WhatsApp connection and set up message handling
 * @param {(message: IncomingContext) => Promise<void>} onMessageHandler - Handler function that receives enriched message context
 */
export async function connectToWhatsApp(onMessageHandler) {

  const { state, saveCreds } = await useMultiFileAuthState(
    "./auth_info_baileys",
  );

  sock = makeWASocket({
    auth: state,
    browser: ["WhatsApp LLM Bot", "Chrome", "1.0.0"],
  });

  sock.ev.process(async (events) => {
    if (events["connection.update"]) {
      const update = events["connection.update"];
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        exec(`echo "${qr}" | qrencode -t ansiutf8`, (error, stdout, stderr) => {
          if (error) {
            // qrencode not available, display QR code as plain text
            console.log(error)
            console.log(stderr)
            console.log('\n=== WhatsApp QR Code ===');
            console.log(qr);
            console.log('========================\n');
            console.log('Scan this QR code with WhatsApp to login.');
            console.log('Tip: Install qrencode for a better visual experience.');
            return;
          }
          console.log(stdout);
        });
      }

      if (connection === "close") {
        const rawError = lastDisconnect?.error;
        const errorMessage =
          rawError && typeof rawError === "object" && "message" in rawError && typeof rawError.message === "string"
            ? rawError.message
            : "";
        const shouldReconnect = errorMessage !== "logged out";
        const statusCode = isBoomError(rawError)
          ? rawError.output?.statusCode
          : undefined;

        console.log(
          "Connection closed due to ",
          rawError,
          ", status code:",
          statusCode,
          ", reconnecting ",
          shouldReconnect,
        );

        if (shouldReconnect) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          await connectToWhatsApp(onMessageHandler);
        }
      } else if (connection === "open") {
        console.log("WhatsApp connection opened");
        if (sock) {
          const lid = sock.user?.lid?.split(":")[0] || sock.user?.lid;
          const id = sock.user?.id?.split(":")[0] || sock.user?.id;
          const selfIds = [];
          if (id) selfIds.push(id);
          if (lid) selfIds.push(lid);
          console.log("Self IDs:", selfIds, JSON.stringify(sock.user, null, 2));
        }
      }
    }

    if (events["creds.update"]) {
      await saveCreds();
    }

    if (events["messages.upsert"]) {
      const { messages } = events["messages.upsert"];
      for (const message of messages) {
        if (message.key.fromMe || !message.message) continue;
        if (sock) {
          await adaptIncomingMessage(message, sock);
        }
      }
    }
  });

  return {
    async closeWhatsapp() {
      console.log("Cleaning up WhatsApp connection...");
      try {
        if (sock) {
          sock.end(undefined);
        }
      } catch (error) {
        console.error("Error during WhatsApp cleanup:", error);
      }
    }
  }
}
