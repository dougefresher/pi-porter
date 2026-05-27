export type MatrixMentionsPayload = {
  user_ids?: string[];
  room?: boolean;
};

export type MatrixMentionInput = {
  body: string;
  formattedBody?: string;
  mMentions?: MatrixMentionsPayload;
  botUserId: string;
};

export function matrixUserLocalpart(userId: string): string {
  const trimmed = userId.trim();
  if (!trimmed.startsWith('@')) return trimmed;
  const colon = trimmed.indexOf(':');
  return colon === -1 ? trimmed.slice(1) : trimmed.slice(1, colon);
}

export function isMatrixMentioned(input: MatrixMentionInput): boolean {
  const botUserId = input.botUserId.trim().toLowerCase();
  if (!botUserId) return true;

  const mentions = input.mMentions;
  if (mentions?.room === true) return true;
  if (Array.isArray(mentions?.user_ids)) {
    for (const userId of mentions.user_ids) {
      if (typeof userId === 'string' && userId.trim().toLowerCase() === botUserId) return true;
    }
  }

  const localpart = matrixUserLocalpart(botUserId).toLowerCase();
  const sources = [input.body];
  if (input.formattedBody?.trim()) sources.push(input.formattedBody);

  for (const source of sources) {
    const lower = source.toLowerCase();
    if (/\B@room\b/.test(lower)) return true;
    if (lower.includes(`@${localpart}`)) return true;
    if (lower.includes(botUserId)) return true;
  }

  return false;
}

export function stripMatrixMentionPrefix(text: string, botUserId: string): string {
  let trimmed = text.trim();
  if (!trimmed || !botUserId.trim()) return trimmed;

  const localpart = matrixUserLocalpart(botUserId);
  const patterns = [
    new RegExp(`^@?${escapeRegExp(localpart)}\\s*[:,-]?\\s*`, 'i'),
    new RegExp(`^${escapeRegExp(botUserId.trim())}\\s*[:,-]?\\s*`, 'i'),
  ];

  for (const pattern of patterns) {
    if (pattern.test(trimmed)) {
      trimmed = trimmed.replace(pattern, '').trim();
      break;
    }
  }

  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
