# Taionca Chat Moderator

An intelligent WhatsApp bot powered by Google Gemini AI that automates data extraction from messages and writes them to Google Sheets. Designed for financial transaction tracking in WhatsApp groups.

## Features

- 🤖 **AI-Powered Bot**: Google Gemini integration with multimodal support (text, images, videos, audio)
- 📊 **Automatic Data Extraction**: Parse structured data from messages (transaction ID, description, amount)
- 📝 **Google Sheets Integration**: Automatically write data to spreadsheets
- 🔧 **Extensible Actions System**: Modular plugin-like actions loaded from files
- 🌐 **REST API**: HTTP endpoints for programmatic control
- 💾 **PGlite Database**: Embedded PostgreSQL for local data persistence
- 🔒 **Permission System**: Granular access control (user, admin, root)

## Quick Start

### Prerequisites

```bash
# Linux (Ubuntu/Debian)
sudo apt install -y nodejs npm qrencode ffmpeg
```

### Installation

1. Clone and install dependencies:

```bash
git clone https://github.com/Bruchogun/Taionca-chat-moderator.git
cd Taionca-chat-moderator
npm install
```

2. Create `.env` file:

```bash
# Google Gemini API Key (required)
LLM_API_KEY=your_gemini_api_key

# Model to use (optional, default: gemini-1.5-flash)
MODEL=gemini-1.5-flash

# Master user IDs (comma-separated)
MASTER_ID=573208763482,573001234567

# Google Sheet ID (required for parseData action)
GOOGLE_SHEET_ID=your_sheet_id

# API Port (optional, default: 3000)
API_PORT=2500
```

3. Setup Google Service Account:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a Service Account and download JSON credentials
   - Enable Google Sheets API
   - Save credentials as `credentials.json` in project root
   - Share your Google Sheet with the service account email

4. Start the bot:

```bash
npm run dev
```

5. Scan the QR code with WhatsApp to authenticate

## Available Commands

Commands use the `!` prefix:

- **`!new`** - Clear conversation history (admin)
- **`!enable [chatId]`** - Enable bot responses (admin)
- **`!disable [chatId]`** - Disable bot responses (root)
- **`!info`** - Show chat information
- **`!set-prompt <prompt>`** - Set custom system prompt (admin)
- **`!get-prompt`** - Get current system prompt (admin)
- **`!js <code>`** - Execute JavaScript code (root)

## Built-in Actions

### parseData
Extracts transaction data and writes to Google Sheets.

**Parameters:**
- `odt_id`: Transaction ID
- `description`: Movement description
- `amount`: Transaction amount

**Example message:**
```
GAD #12345
Transfer to John Doe
$500
```

### deleteMessage
Deletes messages with formatting errors.

### Other Actions
- `new_conversation`: Clear chat history
- `enable_chat` / `disable_chat`: Toggle bot responses
- `set_system_prompt` / `get_system_prompt`: Manage custom prompts
- `run_javascript`: Execute JS code with bot context
- `show_info`: Display chat information

## REST API

The bot exposes a REST API (default port: 3000).

### Send Message
```bash
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{"chatId": "573001234567@s.whatsapp.net", "message": "Hello!"}'
```

### Reply to Message
```bash
curl -X POST http://localhost:3000/api/messages/reply \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "573001234567@s.whatsapp.net",
    "message": "Thanks!",
    "quotedMessageId": "MESSAGE_ID"
  }'
```

### Delete Message
```bash
curl -X DELETE http://localhost:3000/api/messages/MESSAGE_ID \
  -H "Content-Type: application/json" \
  -d '{"chatId": "573001234567@s.whatsapp.net"}'
```

### Health Check
```bash
curl http://localhost:3000/health
```

## Project Structure

```
Taionca-chat-moderator/
├── actions/                # Bot actions (plugins)
│   ├── parseData.js       # Data extraction to Sheets
│   ├── deleteMessage.js   # Message deletion
│   ├── newConversation.js # Clear history
│   └── ...
├── routes/                # API routes
├── auth_info_baileys/     # WhatsApp credentials
├── pgdata/                # PGlite databases
├── index.js               # Main entry point
├── whatsapp-adapter.js    # Baileys adapter
├── api.js                 # REST API server
├── store.js               # Database layer
├── googleAuth.js          # Google Sheets auth
└── credentials.json       # Google Service Account key
```

## Creating Custom Actions

Create a file in `actions/myAction.js`:

```javascript
export default {
  name: "my_action",
  command: "mycommand",
  description: "My custom action",
  parameters: {
    type: "object",
    properties: {
      param1: { type: "string", description: "Parameter description" }
    },
    required: ["param1"]
  },
  permissions: {
    autoExecute: true,
    requireAdmin: false
  },
  action_fn: async function(context, params) {
    // Your implementation
    return "Result";
  }
};
```

The bot will automatically load it on startup.

## Database Schema

**chats table:**
```sql
CREATE TABLE chats (
    chat_id VARCHAR(50) PRIMARY KEY,
    is_enabled BOOLEAN DEFAULT FALSE,
    system_prompt TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**messages table:**
```sql
CREATE TABLE messages (
    message_id SERIAL PRIMARY KEY,
    chat_id VARCHAR(50) REFERENCES chats(chat_id),
    sender_id VARCHAR(50),
    message_data JSONB,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Troubleshooting

**Bot not connecting:**
```bash
# Check dependencies
ffmpeg -version
qrencode --version

# Remove old credentials
rm -rf auth_info_baileys/
```

**Google Sheets error:**
- Make sure you're using Service Account credentials (not OAuth2)
- Share the spreadsheet with the service account email
- Verify `GOOGLE_SHEET_ID` is correct in `.env`

**Bot not responding in groups:**
1. Check chat status: `!info`
2. Enable chat: `!enable`
3. Ensure bot is mentioned or message matches system prompt

## License

See `LICENSE` file for details.

## Authors

- **Madacol** - Original author
- **Bruchogun** - Current maintainer

## Acknowledgments

- [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp client
- [Google Gemini](https://ai.google.dev/) - AI model
- [PGlite](https://electric-sql.com/product/pglite) - Embedded database
- [Polka](https://github.com/lukeed/polka) - Web framework
  "participants": [
    "573001234567@s.whatsapp.net",
    "573007654321@s.whatsapp.net"
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "groupId": "120363421118002801@g.us",
    "subject": "My Group Name"
  }
}
```

---

#### Add Participants to Group
```http
POST /api/groups/:groupId/participants/add
```

**Body:**
```json
{
  "participants": [
    "573001234567@s.whatsapp.net",
    "573007654321@s.whatsapp.net"
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": [...]
}
```

---

#### Remove Participants from Group
```http
POST /api/groups/:groupId/participants/remove
```

**Body:**
```json
{
  "participants": [
    "573001234567@s.whatsapp.net"
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": [...]
}
```

---

#### Update Group Settings
```http
PUT /api/groups/:groupId/settings
```

**Body:**
```json
{
  "setting": "announcement"
}
```

**Settings options:**
- `announcement` - Only admins can send messages
- `not_announcement` - Everyone can send messages
- `locked` - Only admins can edit group info
- `unlocked` - Everyone can edit group info

**Response:**
```json
{
  "success": true
}
```

---

### Chat ID Format

- **Individual chats:** `<phone_number>@s.whatsapp.net`
  - Example: `573001234567@s.whatsapp.net`
- **Group chats:** `<group_id>@g.us`
  - Example: `120363421118002801@g.us`

### Error Responses

All endpoints may return error responses in this format:

```json
{
  "success": false,
  "error": "Error message description"
}
```

**Common errors:**
- `503` - WhatsApp not connected yet
- `400` - Missing required parameters
- `500` - Internal server error

---

## Auto-start on Boot (Optional)

To automatically start the bot when the system boots:

1. The project includes a cronjob configuration that waits 60 seconds after boot and then starts the bot

2. View current cronjobs:
   ```bash
   crontab -l
   ```

3. The bot logs are saved to:
   - Bot logs: `/home/brucho/Taionca-chat-moderator/bot.log`
   - Cron logs: `/home/brucho/Taionca-chat-moderator/cron.log`

---

## Project Structure

```
Taionca-chat-moderator/
├── index.js              # Main bot entry point
├── api.js                # REST API server
├── whatsapp-adapter.js   # WhatsApp connection handler
├── config.js             # Configuration
├── routes/               # API route modules
│   ├── messages.js       # Message endpoints
│   └── groups.js         # Group endpoints
├── actions/              # Bot action handlers
├── auth_info_baileys/    # WhatsApp authentication data
└── package.json
```

## Technology Stack

- **WhatsApp Client:** [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)
- **LLM APIs:** OpenAI, Google Gemini
- **HTTP Server:** [Polka](https://github.com/lukeed/polka) (lightweight, fast)
- **Database:** PGlite (embedded PostgreSQL)
- **Media Processing:** ffmpeg, yt-dlp

---

## License

See [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
