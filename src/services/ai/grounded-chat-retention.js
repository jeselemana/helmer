export const MAX_GROUNDED_CHAT_RETENTION_MS = 730 * 86400000;

export function isGroundedAssistantMessage(message) {
  return (message?.role === 'assistant' || message?.role === 'model') && Boolean(
    message.groundingMetadata ||
    message.type === 'research' ||
    message.pluginIds?.includes('web') ||
    (Array.isArray(message.sources) && message.sources.length > 0)
  );
}

export function pruneExpiredGroundedResults(chat, now = Date.now()) {
  if (!Array.isArray(chat?.messages)) return 0;
  const retained = chat.messages.filter(message => {
    if (!isGroundedAssistantMessage(message)) return true;
    const created = Date.parse(message.createdAt || chat.createdAt);
    return Number.isFinite(created) && created <= now && now - created < MAX_GROUNDED_CHAT_RETENTION_MS;
  });
  const removed = chat.messages.length - retained.length;
  if (removed) chat.messages = retained;
  return removed;
}
