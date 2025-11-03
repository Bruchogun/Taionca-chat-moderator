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

    const filteredSenderId = senderIds.filter(x => x !== "unknown" && x.length < 14)[0] + "@s.whatsapp.net";
    // Notify about the error
    reply("❌ No se pudo extraer la información del mensaje. Por favor revisa el formato.", filteredSenderId);
    // Delete the original message
    await deleteMessage();
    

    return "Message deleted due to parsing error"
  },
});