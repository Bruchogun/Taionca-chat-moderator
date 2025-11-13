import credentials from '../credentials.json' assert { type: 'json' };
import { SheetsManager } from '../googleAuth.js';

export default  /** @type {defineAction} */ ((x) => x)({
  name: "deleteMessage",
  command: undefined,
  description: "Informa al usuario que envió el mensaje acerca de un error en la extracción de datos con la acción parseData y elimina el mensaje",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  permissions: {
    autoExecute: true,
    requireRoot: false,
    useRootDb: true,
  },

  action_fn: async function ({ reply, deleteMessage, senderIds }) {

    console.log("Sender ID:", senderIds);
    // Notify about the error
    console.log("Antes de reply")
    await reply("❌ No se pudo extraer la información del mensaje. Por favor revisa el formato.", senderIds[0]);
    console.log("Antes de deleteMessage")
    // Delete the original message
    await deleteMessage();
    console.log("Después de deleteMessage")

    return "Message deleted due to parsing error"
  },
});