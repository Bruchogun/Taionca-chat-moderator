import { sock } from '../whatsapp-adapter.js';

/**
 * Monta las rutas de mensajes en la aplicación
 * @param {string} prefix - Prefijo para las rutas (ej: '/api/messages')
 * @param {import('polka').Polka} app - Instancia de Polka
 */
export function mount(prefix, app) {
  // POST /send
  app.post(`${prefix}/send`, async (req, res) => {
    try {
      if (!sock) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ 
          success: false,
          error: 'WhatsApp not connected yet' 
        }));
      }

      const { chatId, message } = req.body;
      
      if (!chatId || !message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ 
          success: false,
          error: 'chatId and message are required' 
        }));
      }

      const result = await sock.sendMessage(chatId, { text: message });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true,
        data: {
          messageId: result?.key.id,
          timestamp: result?.messageTimestamp
        }
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  });

  // POST /reply - Reply to a message
  app.post(`${prefix}/reply`, async (req, res) => {
    try {
      if (!sock) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ 
          success: false,
          error: 'WhatsApp not connected yet' 
        }));
      }

      const { chatId, message, quotedMessageId } = req.body;
      
      if (!chatId || !message || !quotedMessageId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ 
          success: false,
          error: 'chatId, message, and quotedMessageId are required' 
        }));
      }

      const result = await sock.sendMessage(chatId, { 
        text: message 
      }, {
        quoted: {
          key: {
            remoteJid: chatId,
            id: quotedMessageId
          }
        }
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true,
        data: {
          messageId: result?.key.id,
          timestamp: result?.messageTimestamp
        }
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  });

  // DELETE /:messageId
  app.delete(`${prefix}/:messageId`, async (req, res) => {
    try {
      if (!sock) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ 
          success: false,
          error: 'WhatsApp not connected yet' 
        }));
      }

      const { messageId } = req.params;
      const { chatId } = req.body;
      
      if (!chatId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ 
          success: false,
          error: 'chatId is required' 
        }));
      }

      await sock.sendMessage(chatId, { delete: { 
        remoteJid: chatId,
        fromMe: true,
        id: messageId
      }});
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true 
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  });
}

export default { mount };