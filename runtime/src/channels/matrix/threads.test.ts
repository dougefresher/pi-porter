import { describe, expect, test } from 'bun:test';

import { buildSessionKey, parseSessionKey } from '../../routing/session-key.js';
import {
  buildMatrixChatId,
  decodeMatrixThreadId,
  encodeMatrixThreadId,
  parseMatrixTarget,
} from './matrix-targets.js';
import { buildMatrixSessionKey } from './session.js';
import { parseMatrixThreadReplies, resolveMatrixThreadRouting } from './threads.js';

describe('resolveMatrixThreadRouting', () => {
  const messageId = '$abcDef123';

  test('always uses message id for top-level room messages', () => {
    expect(
      resolveMatrixThreadRouting({
        isDirectMessage: false,
        threadReplies: 'always',
        messageId,
      }),
    ).toEqual({ threadId: messageId });
  });

  test('always keeps existing thread root in room messages', () => {
    expect(
      resolveMatrixThreadRouting({
        isDirectMessage: false,
        threadReplies: 'always',
        messageId: '$reply123',
        threadRootId: '$root456',
      }),
    ).toEqual({ threadId: '$root456' });
  });

  test('inbound only threads when user is already in a thread', () => {
    expect(
      resolveMatrixThreadRouting({
        isDirectMessage: false,
        threadReplies: 'inbound',
        messageId,
      }),
    ).toEqual({ threadId: undefined });

    expect(
      resolveMatrixThreadRouting({
        isDirectMessage: false,
        threadReplies: 'inbound',
        messageId: '$reply123',
        threadRootId: '$root456',
      }),
    ).toEqual({ threadId: '$root456' });
  });

  test('off disables thread routing', () => {
    expect(
      resolveMatrixThreadRouting({
        isDirectMessage: false,
        threadReplies: 'off',
        messageId,
        threadRootId: '$root456',
      }),
    ).toEqual({ threadId: undefined });
  });

  test('DMs stay inbound-only even when mode is always', () => {
    expect(
      resolveMatrixThreadRouting({
        isDirectMessage: true,
        threadReplies: 'always',
        messageId,
      }),
    ).toEqual({ threadId: undefined });
  });
});

describe('parseMatrixThreadReplies', () => {
  test('defaults to always', () => {
    expect(parseMatrixThreadReplies(undefined, 'always')).toBe('always');
  });

  test('accepts valid modes', () => {
    expect(parseMatrixThreadReplies('inbound', 'always')).toBe('inbound');
    expect(parseMatrixThreadReplies('OFF', 'always')).toBe('off');
  });
});

describe('matrix thread id encoding', () => {
  test('preserves case through session key roundtrip', () => {
    const eventId = '$7aVLDylqL5VqpEy-q3ijxx_PFbg00o-cxcU2y0Fvszw';
    const roomId = '!wzxHFYaZwEjmpVibbK:dougefresh.dev';
    const chatId = buildMatrixChatId(roomId, { threadEventId: eventId });
    const sessionKey = buildMatrixSessionKey(chatId);

    expect(encodeMatrixThreadId(eventId)).toBe('243761564c44796c714c3556717045792d7133696a78785f5046626730306f2d637863553279304676737a77');
    expect(decodeMatrixThreadId(encodeMatrixThreadId(eventId))).toBe(eventId);

    const parsed = parseSessionKey(sessionKey);
    expect(parsed?.threadId).toBe(encodeMatrixThreadId(eventId));

    const roundTripChatId = buildMatrixChatId(roomId, {
      threadEventId: parsed?.threadId ? decodeMatrixThreadId(parsed.threadId) : null,
    });
    expect(roundTripChatId).toBe(chatId);
    expect(parseMatrixTarget(roundTripChatId).threadEventId).toBe(eventId);
  });

  test('buildSessionKey stores encoded thread id without lowercasing payload', () => {
    const eventId = '$CaseSensitiveThreadId';
    const sessionKey = buildSessionKey({
      agentId: 'main',
      source: 'matrix',
      accountId: 'default',
      peerKind: 'room',
      peerId: 'abc123',
      threadId: encodeMatrixThreadId(eventId),
    });

    expect(parseSessionKey(sessionKey)?.threadId).toBe(encodeMatrixThreadId(eventId));
    expect(decodeMatrixThreadId(parseSessionKey(sessionKey)!.threadId!)).toBe(eventId);
  });
});
