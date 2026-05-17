# Discord ↔ Matrix Bridge Bot (simple)

Bridges one (or more) Discord channels to one (or more) Matrix rooms.

## Features

- Discord → Matrix: forwards messages, replies (as Matrix rich replies), and reactions (unicode emoji)
- Matrix → Discord: forwards messages via a Discord webhook (impersonates Matrix displayname/avatar), replies as quoted text (`>`), and reactions
- Optional edit forwarding in both directions

## Requirements

- Node.js 18+ (Node 20+ recommended)
- A Discord server where you can add bots + create webhooks
- A Matrix account (ideally a dedicated “bot” account)
- An **unencrypted** Matrix room (E2EE is not supported)

## 1) Install

```bash
npm install
```

## 2) Discord setup (create bot + invite it)

### 2.1 Create the Discord application + bot

1. Go to the Discord Developer Portal: https://discord.com/developers/applications
2. Click **New Application** → give it a name.
3. In the left sidebar: **Bot** → click **Add Bot**.
4. Under **Token**, click **Reset Token** (or **Copy**) and save it for your `config.json`.

### 2.2 Enable required intents

In the same **Bot** page, enable:

- **MESSAGE CONTENT INTENT** (required so the bot can read message text)

Reactions usually work without special privileged intents, but you must still give the bot channel permissions (next step).

### 2.3 Invite the bot to your server

1. In the left sidebar: **OAuth2** → **URL Generator**.
2. Scopes:
	 - ✅ **bot**
3. Bot permissions (minimum recommended for this bridge):
	 - ✅ View Channels
	 - ✅ Read Message History
	 - ✅ Add Reactions

Then copy/open the generated URL and add the bot to your server.

Tip: You can also construct an invite URL like:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_APPLICATION_CLIENT_ID&scope=bot&permissions=0
```

But using the URL Generator is simpler because it calculates permissions for you.

## 3) Discord setup (create a webhook for the target channel)

Matrix → Discord messages are posted via a webhook (so they can show Matrix display name + avatar).

1. Open your Discord server.
2. Right-click the target channel → **Edit Channel**.
3. Go to **Integrations** → **Webhooks** → **New Webhook**.
4. Copy the **Webhook URL**.

## 4) Matrix setup (create a bot user + access token)

### 4.1 Create a Matrix bot account (recommended)

Create a dedicated Matrix user for the bridge bot (recommended so you don’t use your personal account token).

- Matrix clients (pick one):
	- Element Web: https://app.element.io/
	- Element Desktop: https://element.io/get-started

Sign up on your homeserver (for example matrix.org) and log in.

### 4.2 Get an access token (easy method: Element)

In Element:

1. Click your profile picture → **All settings**.
2. **Help & About**.
3. Scroll to **Advanced** → copy **Access Token**.

This token goes into `matrix.accessToken` in `config.json`.

### 4.3 Add the bot to the room

The bot must be in the Matrix room you want to bridge.

- Invite the bot user to the room (Element: room → **Room info** → **People** → **Invite**).
- This project uses auto-join on invites, so the bot should accept the invite automatically.

Important: the room must be **unencrypted** (no E2EE), otherwise the bot won’t be able to read messages.

### 4.4 Find the Matrix room ID

In Element, open the room → **Room info** → **Settings** → **Advanced** and copy the **Internal room ID**.
It looks like:

```
!someroomid:example.org
```

## 5) Get the Discord channel ID

1. Discord **User Settings** → **Advanced** → enable **Developer Mode**.
2. Right-click the target channel → **Copy Channel ID**.

## 6) Configure the bridge

Copy the example config:

```bash
cp config.example.json config.json
```

Fill in values in `config.json`:

- `discord.botToken`: Discord bot token from the Developer Portal
- `matrix.homeserverUrl`: your homeserver base URL (example: `https://matrix.org`)
- `matrix.accessToken`: access token for the Matrix bot user
- `matrix.botUserId` (optional but recommended): the Matrix bot user ID (example: `@mybot:matrix.org`)
- `bridge.mappings[]`:
	- `discordChannelId`: the channel ID to listen to
	- `discordWebhookUrl`: webhook URL for that channel (Matrix → Discord)
	- `matrixRoomId`: Matrix room ID to send to

Notes:

- `bridge.statePath` stores message-id mappings so replies/reactions can map across platforms.
- `bridge.matrixSyncPath` stores Matrix sync state so the bot can resume properly.

## 7) Start the bot

Development mode (recommended while setting up):

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

## 8) What replies/reactions look like

- Discord → Matrix replies: sent as Matrix rich replies (reply threading)
- Matrix → Discord replies: sent as quoted text using `>`
- Reactions: unicode emoji reactions are mirrored both ways (custom Discord emoji are not)

## Troubleshooting

- Discord messages not arriving:
	- Ensure **MESSAGE CONTENT INTENT** is enabled for the bot in the Developer Portal.
	- Ensure the bot has access to the channel and can read message history.
	- Ensure `discordChannelId` matches the channel you’re testing in.

- Matrix messages not arriving:
	- Ensure the bot user is actually in the room.
	- Ensure the room is **unencrypted**.
	- Verify `matrix.homeserverUrl` and `matrix.accessToken`.

- Matrix → Discord “impersonation” doesn’t work:
	- Matrix → Discord uses a **webhook**; make sure `discordWebhookUrl` is the webhook URL for the channel.

- Error: `Unknown Webhook` / DiscordAPIError `10015`:
	- The webhook URL in `discordWebhookUrl` is invalid (deleted webhook or regenerated token).
	- Create a new webhook in the target channel and replace `discordWebhookUrl` in `config.json`.

- Reactions don’t mirror Matrix → Discord:
	- The Discord bot must have permission to **Add Reactions** in that channel.
	- Only unicode emoji reactions are supported.

## Notes / limitations

- Matrix messages are sent by the Matrix bot user (Matrix has no native “webhook impersonation”). The bridge includes author info in the message formatting.
- Custom Discord emojis are currently not mirrored to Matrix (unicode emoji reactions work).
- E2EE rooms are not supported.

## How “big / better” Matrix↔Discord bridges are usually built

If you’ve seen a Discord↔Matrix bridge that “feels native” (each Discord user appears as themselves in Matrix, replies/threading look correct, edits/reactions work reliably, etc.), it’s usually **not** a simple bot that posts messages.

Most mature bridges use a **Matrix Application Service (AS)** bridge design:

- **Application Service registration** on the Matrix homeserver
	- The bridge is trusted by the homeserver via an AS registration file (contains tokens + namespace rules).
	- This lets the bridge create/“own” many virtual users on Matrix.

- **Puppeting / virtual users**
	- For each Discord user, the bridge creates a corresponding Matrix “ghost” user (or connects the user’s own Matrix account).
	- That’s how messages on Matrix appear as the real Discord author instead of `Bot: Alice: hello`.

- **Real state + storage**
	- Uses a real database (SQLite/Postgres) for message ID mapping, reactions, edits, membership, and resuming after restarts.

- **Protocol-aware mapping**
	- Handles Discord mentions/roles/channels, attachments, threads, replies, embeds, stickers, edits, deletes, and rate limits.
	- Implements backoff/retry so a single API failure doesn’t crash the bridge.

Examples of popular open-source bridges (for reference):

- `mautrix-discord` (Python, mature “puppeting” bridge): https://docs.mau.fi/bridges/go/discord/index.html
- `matrix-appservice-discord` (Node, AS bridge): https://github.com/matrix-org/matrix-appservice-discord

This project is intentionally simpler: it’s a **relay bridge** (Discord bot + Matrix bot + Discord webhook). It’s easier to run, but it can’t match the UX of a full AS/puppeting bridge without a larger redesign.

## Security

- Treat `config.json` like a secret (it contains tokens). Do not commit it.
- If you accidentally leaked a token, rotate it immediately:
	- Discord bot token: Developer Portal → Bot → Reset Token
	- Matrix access token: depends on homeserver/client; easiest is create a new token (or new bot account) if your client doesn’t support rotation.
