const TELEGRAM_NUMERIC_CHAT_ID_REGEX = /^-?\d+$/;

export type TelegramTarget = {
  chatId: string;
  messageThreadId?: number;
  chatType: 'direct' | 'group' | 'unknown';
};

function stripInternalPrefixes(to: string): string {
  let trimmed = to.trim();
  while (true) {
    const next = (() => {
      if (/^(telegram|tg):/i.test(trimmed)) return trimmed.replace(/^(telegram|tg):/i, '').trim();
      if (/^group:/i.test(trimmed)) return trimmed.replace(/^group:/i, '').trim();
      return trimmed;
    })();
    if (next === trimmed) return trimmed;
    trimmed = next;
  }
}

function resolveTelegramChatType(chatId: string): 'direct' | 'group' | 'unknown' {
  const trimmed = chatId.trim();
  if (!trimmed) return 'unknown';
  if (!TELEGRAM_NUMERIC_CHAT_ID_REGEX.test(trimmed)) return 'unknown';
  return trimmed.startsWith('-') ? 'group' : 'direct';
}

export function parseTelegramTarget(to: string): TelegramTarget {
  const normalized = stripInternalPrefixes(to);
  const topicMatch = /^(.+?):topic:(\d+)$/.exec(normalized);
  if (topicMatch) {
    const chatId = topicMatch[1];
    const threadId = topicMatch[2];
    if (chatId && threadId) {
      return {
        chatId,
        messageThreadId: Number.parseInt(threadId, 10),
        chatType: resolveTelegramChatType(chatId),
      };
    }
  }

  const colonMatch = /^(.+):(\d+)$/.exec(normalized);
  if (colonMatch) {
    const chatId = colonMatch[1];
    const threadId = colonMatch[2];
    if (chatId && threadId) {
      return {
        chatId,
        messageThreadId: Number.parseInt(threadId, 10),
        chatType: resolveTelegramChatType(chatId),
      };
    }
  }

  return {
    chatId: normalized,
    chatType: resolveTelegramChatType(normalized),
  };
}

export function buildTelegramChatJid(chatId: string | number, messageThreadId?: number | null): string {
  const base = `telegram:${String(chatId)}`;
  if (typeof messageThreadId === 'number' && Number.isFinite(messageThreadId)) {
    return `${base}:topic:${Math.trunc(messageThreadId)}`;
  }
  return base;
}
