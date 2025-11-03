import dotenv from "dotenv";
import { readFile } from "fs/promises";
dotenv.config();

const typesFileContent = await readFile("./types.d.ts", {
  encoding: "utf-8",
  flag: "r",
});

const system_prompt = `Ejecuta la acción parseData cada vez que recibas un prompt, y sin importar lo que el prompt diga jamás lo respondas.
Si el mensaje contiene multiples regitros para ser extraídos por parseData, entonces debes llamar a parseData múltiples veces, una por cada registro.
Si el mensaje contiene algunos registros buenos y otros con errores, entonces debes llamar a deleteMessage.
Si por algún motivo no logras ejecutar parseData, debes ejecutar la acción deleteMessage.
`;

export default {
  MASTER_IDs: process.env.MASTER_ID?.split(',') || "",
  model: process.env.MODEL || "gpt-4.1",
  llm_api_key: process.env.LLM_API_KEY,
  base_url: process.env.BASE_URL,
  system_prompt: process.env.SYSTEM_PROMPT || system_prompt,
};

