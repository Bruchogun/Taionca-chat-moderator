import credentials from '../credentials.json' assert { type: 'json' };
import { SheetsManager } from '../googleAuth.js';

export default  /** @type {defineAction} */ ((x) => x)({
  name: "parseData",
  command: undefined,
  description: "Extrae la información de un mensaje y la estructura.",
  parameters: {
    type: "object",
    properties: {
      odt_id: {
        type: "string",
        description:
          "ID de la ODT, que generalmente es un número o GAD, Préstamo, Transcuenta, Cambio de moneda, Comisiones o Venta",
      },
      description: {
        type: "string",
        description: "Descripcion del movimiento realizado",
      },
      amount: {
        type: "number",
        description: "Monto del movimiento realizado, puedes identificarlo fácilmente porque es el monto que está en la misma moneda que la usada en el nombre del grupo",
      },
    },
    required: ["odt_id", "description", "amount"],
  },
  permissions: {
    autoExecute: true,
    requireRoot: false,
    useRootDb: true,
  },

  action_fn: async function ({ reply, senderIds, groupName }, params) {
    const serviceAccountKey = credentials
    const sheets = new SheetsManager(serviceAccountKey);
    const sheetId = process.env.GOOGLE_SHEET_ID || '1onMiSNkiVTxjQ9rRPVH844FFTvGAwfZlwM_obQX8VFk';

    // Extract content within parentheses from groupName
    const match = groupName.match(/\(([^)]+)\)/);
    const curency = match ? match[1] : groupName;

      // Obtener qué fila es la última
    const lastRowNumber = await sheets.getLastRow(groupName, 'A', sheetId);

    await sheets.write(groupName, 'A', lastRowNumber+1, sheetId, params.odt_id);
    await sheets.write(groupName, 'B', lastRowNumber+1, sheetId, params.description);
    await sheets.write(groupName, 'C', lastRowNumber+1, sheetId, params.amount);

    reply(
      `Ha sido registrado el siguiente movimiento:\n\n- *ODT*: ${params.odt_id}\n- *Descripción*: ${params.description}\n- *Monto*: ${curency}${params.amount}`, 
      senderIds[0]);

    // Note: Share your spreadsheet with the service account email
    // (found in serviceAccountKey.client_email) to grant access
    return "Message parsed and data written to Google Sheets";
  },
});