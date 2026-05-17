import {
  AutojoinRoomsMixin,
  LogService,
  LogLevel,
  MatrixClient,
  RichReply,
  SimpleFsStorageProvider,
} from "matrix-bot-sdk";
import {
  Client as DiscordClient,
  Events,
  GatewayIntentBits,
  Partials,
  WebhookClient,
  type Message,
  type PartialMessage,
  type MessageReaction,
  type PartialMessageReaction,
  type User,
  type PartialUser,
} from "discord.js";
import type { BridgeConfig, BridgeMapping } from "./config.js";
import type { StateStore } from "./state.js";
import { escapeHtml, getDiscordWebhookId, makeDiscordReactionKey, toDiscordQuote } from "./util.js";

LogService.setLevel(LogLevel.INFO);

type MappingRuntime = BridgeMapping & {
  webhook: WebhookClient;
  webhookId?: string;
};

function maskWebhookUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    // /api/webhooks/{id}/{token}
    const tokenIndex = parts.findIndex((p) => p === "webhooks") + 2;
    if (tokenIndex > 1 && tokenIndex < parts.length) {
      parts[tokenIndex] = "***";
      u.pathname = "/" + parts.join("/");
    }
    u.search = "";
    return u.toString();
  } catch {
    return "(invalid webhook url)";
  }
}

function toDiscordApiV10WebhookUrl(url: string): string {
  const u = new URL(url);
  // Accept either /api/webhooks/... or /api/v10/webhooks/...
  u.pathname = u.pathname.replace(/^\/api\/webhooks\//, "/api/v10/webhooks/");
  return u.toString();
}

async function validateDiscordWebhooks(mappings: MappingRuntime[]): Promise<void> {
  for (const mapping of mappings) {
    try {
      const validateUrl = toDiscordApiV10WebhookUrl(mapping.discordWebhookUrl);
      const res = await fetch(validateUrl, { method: "GET" });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Webhook check failed: HTTP ${res.status} ${res.statusText} ${body}`.trim());
      }
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : String(err);
      // eslint-disable-next-line no-console
      console.error(
        `[bridge] Discord webhook validation failed for channelId=${mapping.discordChannelId} matrixRoomId=${mapping.matrixRoomId}. ` +
          `Webhook URL (masked): ${maskWebhookUrl(mapping.discordWebhookUrl)}. Error: ${msg}`,
      );
      throw err;
    }
  }
}

async function resolveMatrixBotUserId(config: BridgeConfig, matrix: MatrixClient): Promise<string> {
  if (config.matrix.botUserId) return config.matrix.botUserId;

  try {
    const maybe = (matrix as any).getUserId;
    if (typeof maybe === "function") {
      const id = await maybe.call(matrix);
      if (typeof id === "string" && id.startsWith("@")) return id;
    }
  } catch {
    // ignore
  }

  const res = await (matrix as any).doRequest("GET", "/_matrix/client/v3/account/whoami");
  return res.user_id as string;
}

async function getMatrixDisplayName(matrix: MatrixClient, userId: string): Promise<string> {
  try {
    const profile = await (matrix as any).getUserProfile(userId);
    const name = profile?.displayname;
    if (typeof name === "string" && name.trim()) return name;
  } catch {
    // ignore
  }
  return userId;
}

async function getMatrixAvatarUrl(matrix: MatrixClient, userId: string): Promise<string | undefined> {
  try {
    const profile = await (matrix as any).getUserProfile(userId);
    const avatarMxc = profile?.avatar_url;
    if (typeof avatarMxc !== "string" || !avatarMxc.startsWith("mxc://")) return undefined;

    const fn = (matrix as any).mxcToHttp;
    if (typeof fn === "function") return fn.call(matrix, avatarMxc);

    // fallback if method name changes
    return undefined;
  } catch {
    return undefined;
  }
}

function mappingForDiscordChannel(mappings: MappingRuntime[], channelId: string): MappingRuntime | undefined {
  return mappings.find((m) => m.discordChannelId === channelId);
}

function mappingForMatrixRoom(mappings: MappingRuntime[], roomId: string): MappingRuntime | undefined {
  return mappings.find((m) => m.matrixRoomId === roomId);
}

function isUnicodeEmoji(emoji: { id: string | null; name: string | null }): emoji is { id: null; name: string } {
  return emoji.id === null && typeof emoji.name === "string" && emoji.name.length > 0;
}

export async function startBridge(config: BridgeConfig, state: StateStore): Promise<void> {
  const mappings: MappingRuntime[] = config.bridge.mappings.map((m) => ({
    ...m,
    webhook: new WebhookClient({ url: m.discordWebhookUrl }),
    webhookId: getDiscordWebhookId(m.discordWebhookUrl),
  }));

  await validateDiscordWebhooks(mappings);

  const discord = new DiscordClient({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
  });

  const matrix = new MatrixClient(config.matrix.homeserverUrl, config.matrix.accessToken, new SimpleFsStorageProvider(config.bridge.matrixSyncPath));
  AutojoinRoomsMixin.setupOnClient(matrix);

  const matrixBotUserId = await resolveMatrixBotUserId(config, matrix);

  // Discord -> Matrix
  discord.on(Events.MessageCreate, async (message: Message) => {
    const mapping = mappingForDiscordChannel(mappings, message.channelId);
    if (!mapping) return;

    if (message.author.bot) return;
    if (message.webhookId && message.webhookId === mapping.webhookId) return;

    const authorName = message.member?.displayName ?? message.author.username;

    const attachmentUrls = Array.from(message.attachments.values()).map((a) => a.url);
    const content = [message.cleanContent, ...attachmentUrls].filter(Boolean).join("\n");
    if (!content.trim()) return;

    let toSend: any;

    if (message.reference?.messageId) {
      const referencedMatrixEventId = state.getMatrixEventIdForDiscordMessage(message.reference.messageId);
      if (referencedMatrixEventId) {
        try {
          const originalEvent = await matrix.getEvent(mapping.matrixRoomId, referencedMatrixEventId);
          const plain = `${authorName}: ${content}`;
          const html = `<strong>${escapeHtml(authorName)}</strong>: ${escapeHtml(content).replaceAll("\n", "<br/>")}`;
          toSend = RichReply.createFor(mapping.matrixRoomId, originalEvent, plain, html);
        } catch {
          // fallback below
        }
      }
    }

    if (!toSend) {
      toSend = {
        msgtype: "m.text",
        body: `${authorName}: ${content}`,
        format: "org.matrix.custom.html",
        formatted_body: `<strong>${escapeHtml(authorName)}</strong>: ${escapeHtml(content).replaceAll("\n", "<br/>")}`,
      };
    }

    const matrixEventId = await matrix.sendMessage(mapping.matrixRoomId, toSend);
    await state.setDiscordMatrixMessage(message.id, matrixEventId);
  });

  // Discord edits -> Matrix edits
  discord.on(Events.MessageUpdate, async (oldMsg: Message | PartialMessage, newMsg: Message | PartialMessage) => {
    if (!config.bridge.forwardEdits) return;
    if (newMsg.partial) {
      try {
        await newMsg.fetch();
      } catch {
        return;
      }
    }

    const mapping = mappingForDiscordChannel(mappings, newMsg.channelId);
    if (!mapping) return;

    const msg = newMsg as Message;
    if (msg.author?.bot) return;
    if (msg.webhookId && msg.webhookId === mapping.webhookId) return;

    const originalMatrixEventId = state.getMatrixEventIdForDiscordMessage(msg.id);
    if (!originalMatrixEventId) return;

    const authorName = msg.member?.displayName ?? msg.author.username;
    const content = msg.cleanContent;

    const newContent = {
      msgtype: "m.text",
      body: `${authorName}: ${content}`,
      format: "org.matrix.custom.html",
      formatted_body: `<strong>${escapeHtml(authorName)}</strong>: ${escapeHtml(content).replaceAll("\n", "<br/>")}`,
    };

    await matrix.sendMessage(mapping.matrixRoomId, {
      msgtype: "m.text",
      body: `* ${newContent.body}`,
      format: "org.matrix.custom.html",
      formatted_body: `* ${newContent.formatted_body}`,
      "m.new_content": newContent,
      "m.relates_to": {
        rel_type: "m.replace",
        event_id: originalMatrixEventId,
      },
    });
  });

  // Discord reactions -> Matrix
  discord.on(Events.MessageReactionAdd, async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
    if (!config.bridge.forwardReactions) return;
    if (user.bot) return;

    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }

    const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
    if (!message) return;

    const mapping = mappingForDiscordChannel(mappings, message.channelId);
    if (!mapping) return;

    if (!isUnicodeEmoji(reaction.emoji)) return;

    const targetMatrixEventId = state.getMatrixEventIdForDiscordMessage(message.id);
    if (!targetMatrixEventId) return;

    const key = makeDiscordReactionKey(message.id, reaction.emoji.name, user.id);
    const existing = state.getMatrixReactionEventIdForDiscordReaction(key);
    if (existing) return;

    const matrixReactionEventId = await matrix.sendEvent(mapping.matrixRoomId, "m.reaction", {
      "m.relates_to": {
        rel_type: "m.annotation",
        event_id: targetMatrixEventId,
        key: reaction.emoji.name,
      },
    });

    await state.setDiscordReactionMatrixEvent(key, matrixReactionEventId);
  });

  discord.on(Events.MessageReactionRemove, async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
    if (!config.bridge.forwardReactions) return;
    if (user.bot) return;

    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }

    const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
    if (!message) return;

    const mapping = mappingForDiscordChannel(mappings, message.channelId);
    if (!mapping) return;

    if (!isUnicodeEmoji(reaction.emoji)) return;

    const key = makeDiscordReactionKey(message.id, reaction.emoji.name, user.id);
    const matrixReactionEventId = state.getMatrixReactionEventIdForDiscordReaction(key);
    if (!matrixReactionEventId) return;

    await matrix.redactEvent(mapping.matrixRoomId, matrixReactionEventId, "reaction removed");
    await state.deleteDiscordReaction(key);
  });

  // Matrix -> Discord
  matrix.on("room.message", async (roomId: string, event: any) => {
    const mapping = mappingForMatrixRoom(mappings, roomId);
    if (!mapping) return;

    if (event?.sender === matrixBotUserId) return;
    if (event?.type !== "m.room.message") return;

    const content = event.content ?? {};

    // Edits
    if (config.bridge.forwardEdits && content?.["m.relates_to"]?.rel_type === "m.replace") {
      const replacedEventId = content?.["m.relates_to"]?.event_id as string | undefined;
      const newBody = content?.["m.new_content"]?.body as string | undefined;
      if (!replacedEventId || !newBody) return;

      const discordMessageId = state.getDiscordMessageIdForMatrixEvent(replacedEventId);
      if (!discordMessageId) return;

      try {
        await mapping.webhook.editMessage(discordMessageId, {
          content: newBody,
          allowedMentions: { parse: [] },
        });
      } catch (err: any) {
        const msg = err?.message ? String(err.message) : String(err);
        // eslint-disable-next-line no-console
        console.error(
          `[bridge] Failed to edit Discord webhook message. channelId=${mapping.discordChannelId} messageId=${discordMessageId}. ` +
            `Webhook URL (masked): ${maskWebhookUrl(mapping.discordWebhookUrl)}. Error: ${msg}`,
        );
      }
      return;
    }

    const sender = event.sender as string;
    const displayName = await getMatrixDisplayName(matrix, sender);
    const avatarURL = await getMatrixAvatarUrl(matrix, sender);

    const msgtype = content.msgtype as string | undefined;

    let body = "";
    if (typeof content.body === "string") body = content.body;

    // reply quoting
    const inReplyTo = content?.["m.relates_to"]?.["m.in_reply_to"]?.event_id as string | undefined;
    if (inReplyTo) {
      try {
        const original = await matrix.getEvent(roomId, inReplyTo);
        const originalBody = typeof original?.content?.body === "string" ? original.content.body : "";
        if (originalBody.trim()) {
          body = `${toDiscordQuote(originalBody)}\n${body}`.trim();
        }
      } catch {
        // ignore
      }
    }

    // basic support for images/files: include mxc link if possible
    if ((msgtype === "m.image" || msgtype === "m.file") && typeof content.url === "string" && typeof body === "string") {
      const mxc = content.url as string;
      const httpUrl = typeof (matrix as any).mxcToHttp === "function" ? (matrix as any).mxcToHttp(mxc) : undefined;
      if (httpUrl) body = `${body}\n${httpUrl}`;
    }

    if (!body.trim()) return;

    try {
      const sent = await mapping.webhook.send({
        content: body,
        username: displayName,
        avatarURL,
        allowedMentions: { parse: [] },
      });

      await state.setDiscordMatrixMessage(sent.id, event.event_id);
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : String(err);
      // eslint-disable-next-line no-console
      console.error(
        `[bridge] Failed to send Matrix→Discord via webhook. channelId=${mapping.discordChannelId} roomId=${roomId}. ` +
          `Webhook URL (masked): ${maskWebhookUrl(mapping.discordWebhookUrl)}. Error: ${msg}`,
      );
    }
  });

  matrix.on("room.event", async (roomId: string, event: any) => {
    const mapping = mappingForMatrixRoom(mappings, roomId);
    if (!mapping) return;

    if (event?.sender === matrixBotUserId) return;

    // Matrix reactions
    if (config.bridge.forwardReactions && event?.type === "m.reaction") {
      const relates = event?.content?.["m.relates_to"];
      const targetEventId = relates?.event_id as string | undefined;
      const key = relates?.key as string | undefined;
      if (!targetEventId || !key) return;

      const discordMessageId = state.getDiscordMessageIdForMatrixEvent(targetEventId);
      if (!discordMessageId) return;

      const channel = await discord.channels.fetch(mapping.discordChannelId).catch(() => null);
      if (!channel) return;
      const isTextBased = (channel as any).isTextBased;
      if (typeof isTextBased !== "function" || !isTextBased.call(channel)) return;
      const isDMBased = (channel as any).isDMBased;
      if (typeof isDMBased === "function" && isDMBased.call(channel)) return;

      const messages = (channel as any).messages;
      if (!messages || typeof messages.fetch !== "function") return;

      const msg = await messages.fetch(discordMessageId).catch(() => null);
      if (!msg) return;

      // try to react with unicode emoji only
      try {
        await msg.react(key);
        await state.setMatrixReactionDiscordInfo(event.event_id, { discordMessageId, emoji: key });
      } catch {
        // ignore
      }
      return;
    }

    // Matrix reaction removals via redaction
    if (config.bridge.forwardReactions && event?.type === "m.room.redaction" && typeof event?.redacts === "string") {
      const info = state.getDiscordInfoForMatrixReaction(event.redacts);
      if (!info) return;

      const channel = await discord.channels.fetch(mapping.discordChannelId).catch(() => null);
      if (!channel) return;
      const isTextBased = (channel as any).isTextBased;
      if (typeof isTextBased !== "function" || !isTextBased.call(channel)) return;
      const isDMBased = (channel as any).isDMBased;
      if (typeof isDMBased === "function" && isDMBased.call(channel)) return;

      const messages = (channel as any).messages;
      if (!messages || typeof messages.fetch !== "function") return;

      const msg = await messages.fetch(info.discordMessageId).catch(() => null);
      if (!msg) return;

      const reaction = msg.reactions.resolve(info.emoji);
      if (!reaction) {
        await state.deleteMatrixReaction(event.redacts);
        return;
      }

      try {
        const botId = discord.user?.id;
        if (botId) await reaction.users.remove(botId);
      } catch {
        // ignore
      }

      await state.deleteMatrixReaction(event.redacts);
    }
  });

  discord.once(Events.ClientReady, async () => {
    // eslint-disable-next-line no-console
    console.log(`Discord logged in as ${discord.user?.tag}`);
  });

  await discord.login(config.discord.botToken);
  await matrix.start();

  // eslint-disable-next-line no-console
  console.log(`Matrix syncing as ${matrixBotUserId}`);
}
