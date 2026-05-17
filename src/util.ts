export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function toDiscordQuote(text: string, maxChars = 600): string {
  const normalized = text.replaceAll("\r\n", "\n").trim();
  if (!normalized) return "> (empty)";

  const limited = normalized.length > maxChars ? `${normalized.slice(0, maxChars - 1)}…` : normalized;
  return limited
    .split("\n")
    .slice(0, 10)
    .map((line) => `> ${line}`)
    .join("\n");
}

export function getDiscordWebhookId(webhookUrl: string): string | undefined {
  const match = webhookUrl.match(/\/webhooks\/(\d+)\//);
  return match?.[1];
}

export function makeDiscordReactionKey(messageId: string, emojiKey: string, userId: string): string {
  return `${messageId}|${emojiKey}|${userId}`;
}
