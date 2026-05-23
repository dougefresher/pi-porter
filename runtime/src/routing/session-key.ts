const validSegmentRe = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/i;
const invalidCharsRe = /[^a-z0-9_-]+/g;
const leadingDashRe = /^-+/;
const trailingDashRe = /-+$/;

export type BuildSessionKeyParams = {
  agentId: string;
  source: string;
  accountId: string;
  peerKind: string;
  peerId: string;
  threadId?: string | null;
};

export type ParsedSessionKey = {
  agentId: string;
  source: string;
  accountId: string;
  peerKind: string;
  peerId: string;
  threadId?: string;
};

export function sanitizeSegment(value: string | undefined | null, options?: { allowLeadingDash?: boolean }): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '';

  let cleaned = trimmed.toLowerCase().replace(invalidCharsRe, '-');
  cleaned = options?.allowLeadingDash
    ? cleaned.replace(trailingDashRe, '')
    : cleaned.replace(leadingDashRe, '').replace(trailingDashRe, '');

  return cleaned.slice(0, 64);
}

export function isValidSegment(value: string | undefined | null): boolean {
  const trimmed = (value ?? '').trim();
  return Boolean(trimmed && trimmed.length <= 64 && validSegmentRe.test(trimmed));
}

export function buildSessionKey(params: BuildSessionKeyParams): string {
  const segments = [
    sanitizeSegment(params.agentId) || 'main',
    sanitizeSegment(params.source) || 'unknown',
    sanitizeSegment(params.accountId) || 'default',
    sanitizeSegment(params.peerKind) || 'unknown',
    sanitizeSegment(params.peerId, { allowLeadingDash: true }) || 'unknown',
  ];

  if (params.threadId) {
    segments.push('thread', sanitizeSegment(params.threadId, { allowLeadingDash: true }) || 'unknown');
  }

  return segments.join(':');
}

export function parseSessionKey(sessionKey: string | undefined | null): ParsedSessionKey | null {
  const parts = (sessionKey ?? '').trim().split(':');
  if (parts.length < 5) return null;

  const [agentId, source, accountId, peerKind, peerId, ...rest] = parts;
  if (!agentId || !source || !accountId || !peerKind || !peerId) return null;

  const parsed: ParsedSessionKey = {
    agentId: agentId.toLowerCase(),
    source: source.toLowerCase(),
    accountId: accountId.toLowerCase(),
    peerKind: peerKind.toLowerCase(),
    peerId: peerId.toLowerCase(),
  };

  let i = 0;
  while (i < rest.length) {
    const marker = rest[i]?.toLowerCase();
    const value = rest[i + 1];
    if (marker === 'thread' && value) {
      parsed.threadId = value.toLowerCase();
      i += 2;
    } else {
      i += 1;
    }
  }

  return parsed;
}
