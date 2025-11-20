import { processLlmResponse } from "./aiCall.js";
import { initStore } from "./store.js";

const { getQueuedMessages, deleteQueuedMessage } = await initStore();

export async function retryQueuedMessages() {
    console.log("Starting to retry queued messages...----------------");
    const queuedMessages = await getQueuedMessages();

    console.log("----------------------Retrying queued messages:----------------------------\n\n\n\n\n", queuedMessages);
    console.log("----------------------------------------------------------------------------\n\n\n\n\n");

    for (const queuedMessage of queuedMessages) {
        try {
            console.log("Retrying queued message:", queuedMessage);
            await processLlmResponse({
                chatMessages_formatted: queuedMessage.chatmessages_formatted,
                context: queuedMessage.context,
                chatId: queuedMessage.chatId,
                senderIds: queuedMessage.senderIds,
                groupName: queuedMessage.groupName,
                id_master: queuedMessage.id_master,
                systemPrompt: queuedMessage.systemPrompt
            });
            await deleteQueuedMessage(queuedMessage.queued_message_id);
        } catch (error) {
            console.error("Error retrying queued message:", error);
        }
    }
}