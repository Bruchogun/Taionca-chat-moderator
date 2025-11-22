import { getDb } from "./db.js";
import { getGroupName } from "./whatsapp-adapter.js";

/**
 * @typedef {{
 *   chat_id: string;
 *   name: string;
 *   is_enabled: boolean;
 *   system_prompt: string;
 *   timestamp: string;
 * }} ChatRow
 *
 * @typedef {{
 *   message_id: number;
 *   chat_id: string;
 *   sender_id: string;
 *   message_data: Message;
 *   timestamp: Date;
 * }} MessageRow
 *
 * @typedef {{
 *   chatMessages_formatted: Array,
 *   context: Context,
 *   chatId: string,
 *   senderIds: string[],
 *   groupName: string | null,
 *   addMessage: (chatId: string, message: Message, senderIds: string[]) => Promise<any>,
 *   id_master: string,
 *   systemPrompt: string,
 *   error: string,
 * }} queuedMessage
 */


export async function initStore(){
    // Initialize database
    const db = getDb("./pgdata/root");

    // Initialize database tables
    await db.sql`
        CREATE TABLE IF NOT EXISTS chats (
            chat_id VARCHAR(50) PRIMARY KEY,
            is_enabled BOOLEAN DEFAULT FALSE,
            system_prompt TEXT,
            name TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    await db.sql`
        CREATE TABLE IF NOT EXISTS messages (
            message_id SERIAL PRIMARY KEY,
            chat_id VARCHAR(50) REFERENCES chats(chat_id),
            sender_id VARCHAR(50),
            message_data JSONB,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

        await db.sql`
        CREATE TABLE IF NOT EXISTS queued_messages (
            queued_message_id SERIAL PRIMARY KEY,
            chatMessages_formatted JSONB NOT NULL,
            context JSONB NOT NULL,
            chatId TEXT NOT NULL,
            senderIds JSONB NOT NULL,
            groupName TEXT NOT NULL,
            id_master TEXT NOT NULL,
            systemPrompt TEXT NOT NULL,
            error TEXT,
            is_proccessed BOOLEAN DEFAULT FALSE,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    // Add new columns if they don't exist (for existing databases)
    try {
      await Promise.all([
        db.sql`ALTER TABLE chats ADD COLUMN IF NOT EXISTS name TEXT`,
        db.sql`ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT FALSE`,
        db.sql`ALTER TABLE chats ADD COLUMN IF NOT EXISTS system_prompt TEXT`,
        db.sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_data JSONB`,
        db.sql`ALTER TABLE messages DROP COLUMN IF EXISTS message_type`,
        db.sql`ALTER TABLE messages DROP COLUMN IF EXISTS tool_call_id`,
        db.sql`ALTER TABLE messages DROP COLUMN IF EXISTS tool_name`,
        db.sql`ALTER TABLE messages DROP COLUMN IF EXISTS tool_args`,
        db.sql`ALTER TABLE messages DROP COLUMN IF EXISTS content`,
        db.sql`ALTER TABLE chats ADD COLUMN IF NOT EXISTS name TEXT`,
      ]);
    } catch (error) {
      // Ignore errors if columns already exist
      console.log("Database schema already up to date");
    }
    return {
      /**
      * @param {ChatRow['chat_id']} chatId
      */
      async getChat (chatId) {
        const { rows: [chat] } = await db.sql`SELECT * FROM chats WHERE chat_id = ${chatId}`;
        return /** @type {ChatRow} */ (chat);
      },

      closeDb () {
        console.log("Closing database...");
        return db.close();
      },

      /**
      * @param {ChatRow['chat_id']} chatId
      * @param {number} limit
      */
      async getMessages (chatId, limit = 1) {
        const {rows: messages} = await db.sql`SELECT * FROM messages WHERE chat_id = ${chatId} ORDER BY timestamp DESC LIMIT ${limit}`;
        // messages.message_data = JSON.parse(messages.message_data);
        return /** @type {MessageRow[]} */ (messages);
      },

      /**
      * @param {ChatRow['chat_id']} chatId
      * @param {ChatRow['name']?} name
      */
      async createChat (chatId, name = null) {
        await db.sql`INSERT INTO chats(chat_id, name) VALUES (${chatId}, ${name}) ON CONFLICT (chat_id) DO UPDATE SET name = COALESCE(EXCLUDED.name, chats.name);`;
      },

      /**
      * @param {MessageRow['chat_id']} chatId
      * @param {MessageRow['message_data']} message_data
      * @param {MessageRow['sender_id'][]?} senderIds
      */
      async addMessage (chatId, message_data, senderIds = null) {
        const {rows: [message]} = await db.sql`INSERT INTO messages(chat_id, sender_id, message_data)
          VALUES (${chatId}, ${senderIds?.join(",")}, ${message_data})
          RETURNING *`;
        return /** @type {MessageRow} */ (message);
      },

            /**
      * @param {queuedMessage['chatMessages_formatted']} chatMessages_formatted
      * @param {queuedMessage['context']} context
      * @param {queuedMessage['chatId']} chatId
      * @param {queuedMessage['senderIds']} senderIds
      * @param {queuedMessage['groupName']} groupName
      * @param {queuedMessage['id_master']} id_master
      * @param {queuedMessage['systemPrompt']} systemPrompt
      * @param {queuedMessage['error']} error
      */
      async addMessageToQueue (chatMessages_formatted, context, chatId, senderIds, groupName, id_master, systemPrompt, error) {
        const {rows: [queued]} = await db.sql`INSERT INTO queued_messages(chatMessages_formatted, context, chatId, senderIds, groupName, id_master, systemPrompt, error)
          VALUES (${chatMessages_formatted}, ${context}, ${chatId}, ${senderIds}, ${groupName}, ${id_master}, ${systemPrompt}, ${error})
          RETURNING *`;
        return /** @type {queuedMessage} */ (queued);
      },

      async getQueuedMessages(limit = 10) {
        const { rows } = await db.sql`SELECT * FROM queued_messages WHERE is_proccessed = FALSE ORDER BY queued_message_id ASC LIMIT ${limit}`;
        return (rows);
      },

      async deleteQueuedMessage(queued_message_id) {
        const { rows } = await db.sql`UPDATE queued_messages SET is_proccessed = TRUE WHERE queued_message_id = ${queued_message_id} RETURNING *`;
        return (rows);
      },

      async getGroupNameDB(chatId) {
        const { rows: [group] } = await db.sql`SELECT name FROM chats WHERE chat_id = ${chatId}`;
        return group?.name || await getGroupName(chatId);
      }
    }
}