# Discord ↔ Matrix Bridge

A self-hosted relay bridge that connects Discord channels to Matrix rooms in **both directions** — messages, replies, edits, and reactions all sync, and the original author's **display name + avatar** are carried across.

## Features

- **Both directions** — messages, replies, edits, and unicode-emoji reactions sync between Discord and Matrix.
- **Original identity on Discord** — Matrix → Discord messages are posted through a channel **webhook** with the Matrix sender's display name and avatar (Discord supports per-message webhook identity, so this side is exact).
- **Original identity on Matrix** — Discord → Matrix messages are sent by the bot account, whose display name and avatar are repointed to the Discord sender right before each message (see [limitations](#notes--limitations) for how this works).
- **Replies** — Discord → Matrix as Matrix rich replies; Matrix → Discord as quoted text (`>`).
- **Edits** — forwarded in both directions (toggle with `bridge.forwardEdits`).
- **Reactions** — unicode emoji reactions mirror both ways (toggle with `bridge.forwardReactions`).
- **Multiple mappings** — one config can bridge several `channel ↔ room` pairs.
- **Crash-safe state** — Discord↔Matrix message/reaction ID mappings are persisted to disk, so replies/edits/reactions keep working across restarts.

## How it works

```
 Discord channel  ──Discord bot──▶  Matrix room
       ▲                                  │
       │         ──Discord webhook──      ▼
```

- A **Discord bot** (discord.js) listens on configured channels and sends Discord messages into Matrix.
- A **Matrix bot** (matrix-bot-sdk) syncs configured rooms (auto-joining on invite) and relays Matrix messages to Discord.
- Matrix → Discord goes through a per-channel **Discord webhook** — that's what allows impersonating the Matrix sender's name/avatar.
- Discord → Matrix is sent by the Matrix bot account; the bridge repoints the bot's Matrix display name + avatar to the Discord sender.
- A JSON **state file** keeps the ID mappings that make replies, edits, and reactions match up across platforms.

## Requirements

- **Node.js 18+** (uses global `fetch` and `structuredClone`; Node 20+ recommended)
- A Discord server where you can create a **bot** and a **webhook**
- A Matrix account (ideally a dedicated **bot** account) and an **unencrypted** Matrix room — E2EE rooms are **not** supported

## 1) Install

```bash
npm install
```

## 2) Discord: create the bot and invite it

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Left sidebar → **Bot** → **Add Bot**.
3. Under **Token**, click **Reset Token** / **Copy** — this is your `discord.botToken`.
4. In the same **Bot** page, enable **MESSAGE CONTENT INTENT** (required for the bot to read message text).
5. **OAuth2 → URL Generator**:
   - Scopes: ✅ **bot**
   - Bot permissions (minimum): ✅ View Channels · ✅ Read Message History · ✅ Add Reactions
6. Open the generated URL and add the bot to your server.

## 3) Discord: create a webhook for the target channel

Matrix → Discord messages are posted through a webhook (so they can show the Matrix sender's name + avatar).

1. Right-click the target channel → **Edit Channel**.
2. **Integrations → Webhooks → New Webhook**.
3. Copy the **Webhook URL** — this is your `discordWebhookUrl`.

## 4) Matrix: bot account, access token, and room

### 4.1 Create a bot account

Create a dedicated Matrix user for the bridge (don't use your personal account's token). Log in with it in any client, e.g. [Element Web](https://app.element.io).

### 4.2 Get an access token (Element)

1. Click your profile picture → **All settings** → **Help & About**.
2. Scroll to **Advanced** → copy **Access Token**.

> **Important:** the account that owns this token *is* the bot. Whatever Matrix user the token belongs to is the identity that appears in the bridged room. `matrix.botUserId` in the config is informational only.

### 4.3 Add the bot to the room

Invite the bot user to the Matrix room. The bridge **auto-joins on invite**, so it should accept on its own. The room must be **unencrypted**.

### 4.4 Find the room ID

Element: open the room → **Room info** → **Settings** → **Advanced** → **Internal room ID**. It looks like `!someroomid:example.org`.

## 5) Get the Discord channel ID

Discord **User Settings → Advanced** → enable **Developer Mode**, then right-click the target channel → **Copy Channel ID**.

## 6) Configure

```bash
cp config.example.json config.json
```

### Config reference

| Key | Required | Description |
| --- | --- | --- |
| `discord.botToken` | ✅ | Discord bot token (Developer Portal) |
| `matrix.homeserverUrl` | ✅ | Homeserver base URL, e.g. `https://matrix.org` |
| `matrix.accessToken` | ✅ | Access token for the Matrix bot user (Section 4.2) |
| `matrix.botUserId` | optional | The bot's Matrix user ID (informational only — the token's owner is what matters) |
| `bridge.statePath` | optional | Where ID mappings are stored (default `./data/state.json`) |
| `bridge.matrixSyncPath` | optional | Matrix sync state for resuming (default `./data/matrix-sync.json`) |
| `bridge.forwardReactions` | optional | Mirror unicode reactions both ways (default `true`) |
| `bridge.forwardEdits` | optional | Mirror edits both ways (default `true`) |
| `bridge.mappings[]` | ✅ | One or more channel ↔ room pairs |
| `mappings[].discordChannelId` | ✅ | Discord channel ID to listen to |
| `mappings[].discordWebhookUrl` | ✅ | Webhook URL for that channel (Matrix → Discord) |
| `mappings[].matrixRoomId` | ✅ | Matrix room ID to bridge to |

Notes:

- Add as many `mappings[]` entries as you need — each one bridges one channel to one room.
- You can point at a different config with `CONFIG_PATH=/path/to/config.json npm run dev` (also settable in a `.env` file — `dotenv` is loaded at startup).
- `config.json` and `.env` are gitignored — **never commit them**.

## 7) Run

Development (recommended while setting up):

```bash
npm run dev
```

Production:

```bash
npm run build
npm start
```

On startup you should see two lines confirming both sides are authenticated:

```
Discord logged in as Nova#9189
Matrix syncing as @yourbot:matrix.org
```

## 8) What syncing looks like

| | Discord → Matrix | Matrix → Discord |
| --- | --- | --- |
| **Sender identity** | Bot's Matrix display name + avatar repointed to the Discord sender | Webhook username + avatar = Matrix sender's display name + avatar |
| **Message** | Only the content (no name prefix — the sender line shows it) | Only the content |
| **Reply** | Matrix rich reply quoting the original | Quoted text using `>` |
| **Edit** | `(edited)` via Matrix edit events | Webhook message edit |
| **Reaction** | Unicode emoji reactions | Unicode emoji reactions (bot must have Add Reactions permission) |
| **Attachments** | Attachment URLs appended to the message | `m.image` / `m.file` sent as a link |

## Troubleshooting

- **`M_UNKNOWN_TOKEN: Token is not active`** — the Matrix access token is invalid, expired, or truncated. Generate a fresh one (Element: Settings → **Help & About** → Access Token) and update `matrix.accessToken`.
- **"Matrix syncing as @...:matrix.org" shows the wrong user** — that line prints the account the token belongs to. If it isn't the account you invited to the room, either invite that account or get a token for the right one (see Section 4).
- **Discord messages never arrive in Matrix**
  - Ensure **MESSAGE CONTENT INTENT** is enabled for the bot.
  - Ensure the bot can view the channel and read message history.
  - Ensure `discordChannelId` matches the channel you're testing in.
- **Matrix messages never arrive in Discord**
  - Ensure the bot user is actually in the room (auto-join only triggers on invite).
  - Ensure the room is **unencrypted**.
  - Verify `matrix.homeserverUrl` / `matrix.accessToken`.
- **Startup fails with a webhook error (URL masked as `***`)** — the webhook URL is invalid, deleted, or its token was regenerated. Create a new webhook and update `discordWebhookUrl`.
- **Reactions don't mirror Matrix → Discord** — the bot needs **Add Reactions** permission in that channel, and only unicode emoji reactions are supported (custom Discord emoji are not).
- **Sender name/avatar not updating on Matrix** — check the logs for `Failed to set Matrix display name` / `Failed to set Matrix avatar`; the first message from a new user also incurs an avatar upload, so it may take a second.

## Notes / limitations

- **Identity mirroring on Matrix is per-account, not per-message.** The bot has a single Matrix account, and Matrix clients keep one profile per user. When the profile is repointed to a new Discord sender, older messages from the bot can re-render under the new name/avatar, and the room may flicker when several people type at once. This is inherent to relay bridges on shared homeservers — true per-message identity requires an application-service (puppeting) bridge.
- Attachments are forwarded as links/URLs, not re-uploaded media.
- Custom Discord emoji reactions are not mirrored (unicode only).
- E2EE (encrypted) Matrix rooms are not supported.
- The bridge ignores its own messages to avoid loops.

## How bigger bridges are built

If you've seen a Discord↔Matrix bridge that feels native — every Discord user appears as their own Matrix account, threads/replies are perfect, media is re-uploaded — it's almost certainly a **Matrix Application Service (AS) bridge**:

- **AS registration** on the homeserver gives the bridge a trusted, namespaced set of virtual users ("ghosts"), one per Discord user.
- **Puppeting / virtual users** let each Discord user *be* their own Matrix account, instead of one bot account switching profiles.
- **Real storage** (SQLite/Postgres) plus protocol-aware handling of threads, embeds, stickers, rate limits, and retries.

Examples:

- `mautrix-discord` (Python, mature puppeting bridge): https://docs.mau.fi/bridges/go/discord/index.html
- `matrix-appservice-discord` (Node, AS bridge): https://github.com/matrix-org/matrix-appservice-discord

This project is intentionally a **simple relay bridge** (Discord bot + Matrix bot + Discord webhook): easy to self-host, no homeserver-side registration, but it can't match the UX of a full AS/puppeting bridge without a much larger redesign.

## Project layout

```
src/
  index.ts        # entrypoint: loads config + state, starts the bridge
  config.ts       # zod-validated config schema (errors fast on bad config)
  startBridge.ts  # all bridge logic (Discord + Matrix clients, handlers)
  state.ts        # persisted Discord↔Matrix message/reaction ID mappings
  util.ts         # helpers (HTML escaping, quoting, webhook URL parsing)
data/             # runtime state (gitignored)
```

## Security

- Treat `config.json` like a secret — it contains live tokens. It's gitignored; don't commit it.
- If a token leaks, rotate it immediately:
  - **Discord**: Developer Portal → Bot → **Reset Token**
  - **Matrix**: generate a new access token (or a new bot account) — the old one can't be "un-leaked".
