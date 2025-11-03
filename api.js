import polka from 'polka';
import { json } from '@polka/parse';
import messageRoutes from './routes/messages.js';

const app = polka();

// Middleware to parse JSON
app.use(json());

// Middleware logging
app.use((req, _res, next) => {
  console.log(`[API] ${req.method} ${req.path}`);
  next();
});

// Mount routes
messageRoutes.mount('/api/messages', app);


// Health check
app.get('/health', (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    status: 'ok', 
    timestamp: Date.now(),
    uptime: process.uptime()
  }));
});

// Root endpoint - API info
app.get('/', (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    name: 'Taionca WhatsApp Bot API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      messages: {
        send: 'POST /api/messages/send',
        reply: 'POST /api/messages/reply',
        delete: 'DELETE /api/messages/:messageId'
      },
    }
  }));
});

const PORT = process.env.API_PORT || 3000;
app.listen(PORT, (err) => {
  if (err) {
    console.error('[API] Failed to start:', err);
    process.exit(1);
  }
  console.log(`[API] Server running on http://localhost:${PORT}`);
});