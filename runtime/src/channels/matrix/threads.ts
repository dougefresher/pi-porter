export type MatrixThreadReplies = 'off' | 'inbound' | 'always';

// Thread routing modes and lazy thread creation: ./docs/matrix.md#threads

export function parseMatrixThreadReplies(value: string | undefined, fallback: MatrixThreadReplies): MatrixThreadReplies {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'off' || normalized === 'inbound' || normalized === 'always') {
    return normalized;
  }
  throw new Error(`Invalid Matrix thread replies mode: ${value}`);
}

export function resolveMatrixThreadRouting(params: {
  isDirectMessage: boolean;
  threadReplies: MatrixThreadReplies;
  messageId: string;
  threadRootId?: string;
}): { threadId?: string } {
  // DMs stay on inbound-only threading; room messages use the configured mode.
  const effectiveThreadReplies = params.isDirectMessage ? 'inbound' : params.threadReplies;
  const messageId = params.messageId.trim();
  const threadRootId = params.threadRootId?.trim();
  const inboundThreadId = threadRootId && threadRootId !== messageId ? threadRootId : undefined;
  const threadId =
    effectiveThreadReplies === 'off'
      ? undefined
      : effectiveThreadReplies === 'inbound'
        ? inboundThreadId
        : (inboundThreadId ?? (messageId || undefined));

  return { threadId };
}
