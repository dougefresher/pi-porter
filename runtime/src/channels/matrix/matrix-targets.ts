const MATRIX_PREFIX = 'matrix:';
const ROOM_PREFIX = 'room:';

export type MatrixTarget = {
  roomId: string;
  threadEventId?: string;
  isDirect: boolean;
};

function stripKnownPrefixes(raw: string, prefixes: readonly string[]): string {
  let normalized = raw.trim();
  while (normalized) {
    const lowered = normalized.toLowerCase();
    const matched = prefixes.find((prefix) => lowered.startsWith(prefix));
    if (!matched) return normalized;
    normalized = normalized.slice(matched.length).trim();
  }
  return normalized;
}

export function isMatrixRoomId(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('!') && trimmed.includes(':');
}

export function isMatrixUserId(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('@') && trimmed.includes(':');
}

export function encodeMatrixPeerId(matrixId: string): string {
  return Buffer.from(matrixId, 'utf8').toString('hex');
}

export function decodeMatrixPeerId(encoded: string): string {
  return Buffer.from(encoded, 'hex').toString('utf8');
}

export function encodeMatrixThreadId(eventId: string): string {
  return Buffer.from(eventId, 'utf8').toString('hex');
}

export function decodeMatrixThreadId(encoded: string): string {
  return Buffer.from(encoded, 'hex').toString('utf8');
}

export function parseMatrixTarget(to: string): MatrixTarget {
  const normalized = stripKnownPrefixes(to, [MATRIX_PREFIX, ROOM_PREFIX]);
  if (!normalized) {
    throw new Error('invalid Matrix target: missing room id');
  }

  const threadMatch = /^(.+?):thread:(.+)$/.exec(normalized);
  if (threadMatch) {
    const roomId = threadMatch[1]?.trim() ?? '';
    const threadEventId = threadMatch[2]?.trim();
    if (roomId && threadEventId) {
      if (!isMatrixRoomId(roomId)) {
        throw new Error(`invalid Matrix target: bad room id ${roomId}`);
      }
      return {
        roomId,
        threadEventId,
        isDirect: false,
      };
    }
    throw new Error('invalid Matrix target: malformed thread suffix');
  }

  if (!isMatrixRoomId(normalized)) {
    throw new Error(`invalid Matrix target: bad room id ${normalized}`);
  }

  return {
    roomId: normalized,
    isDirect: false,
  };
}

export function buildMatrixChatId(
  roomId: string,
  options?: { threadEventId?: string | null; isDirect?: boolean },
): string {
  const base = `${MATRIX_PREFIX}${ROOM_PREFIX}${roomId}`;
  if (options?.threadEventId) {
    return `${base}:thread:${options.threadEventId}`;
  }
  return base;
}
