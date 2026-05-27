import { describe, expect, test } from 'bun:test';

import { assistantErrorText, sanitizeAgentErrorText } from '../../agent/agent-error-text.js';
import { directRoomIdsFromMap, isDirectRoomWithFallback } from './direct-rooms.js';
import { markdownToMatrixHtml, sanitizeMatrixHtml } from './matrix-html.js';
import { isMatrixMentioned, stripMatrixMentionPrefix } from './mentions.js';

describe('isMatrixMentioned', () => {
  const botUserId = '@porter:localhost';

  test('DM bypass is handled by caller, mention still detected in body', () => {
    expect(
      isMatrixMentioned({
        body: '@porter:localhost hello',
        botUserId,
      }),
    ).toBe(true);
  });

  test('detects m.mentions user_ids', () => {
    expect(
      isMatrixMentioned({
        body: 'hello',
        mMentions: { user_ids: [botUserId] },
        botUserId,
      }),
    ).toBe(true);
  });

  test('detects @room', () => {
    expect(
      isMatrixMentioned({
        body: '@room stand up',
        botUserId,
      }),
    ).toBe(true);
  });

  test('room without mention is not mentioned', () => {
    expect(
      isMatrixMentioned({
        body: 'hello everyone',
        botUserId,
      }),
    ).toBe(false);
  });
});

describe('stripMatrixMentionPrefix', () => {
  test('strips localpart mention prefix', () => {
    expect(stripMatrixMentionPrefix('@porter hello there', '@porter:localhost')).toBe('hello there');
  });
});

describe('directRoomIdsFromMap', () => {
  test('collects room ids from m.direct map', () => {
    const ids = directRoomIdsFromMap({
      '@alice:localhost': ['!a:localhost', '!b:localhost'],
      '@bob:localhost': ['!c:localhost'],
    });
    expect(ids.has('!a:localhost')).toBe(true);
    expect(ids.has('!c:localhost')).toBe(true);
    expect(ids.size).toBe(3);
  });
});

describe('isDirectRoomWithFallback', () => {
  test('uses m.direct when seeded', () => {
    const room = { roomId: '!dm:localhost', getJoinedMemberCount: () => 2 };
    expect(isDirectRoomWithFallback(room as never, new Set(['!dm:localhost']), true)).toBe(true);
    expect(isDirectRoomWithFallback(room as never, new Set(), true)).toBe(false);
  });

  test('falls back to member count before m.direct is seeded', () => {
    const room = { roomId: '!maybe:localhost', getJoinedMemberCount: () => 2 };
    expect(isDirectRoomWithFallback(room as never, new Set(), false)).toBe(true);
    expect(isDirectRoomWithFallback({ ...room, getJoinedMemberCount: () => 3 } as never, new Set(), false)).toBe(false);
  });
});

describe('matrix-html', () => {
  test('sanitizes script tags from html output', () => {
    const sanitized = sanitizeMatrixHtml('<p>ok</p><script>alert(1)</script>');
    expect(sanitized).not.toContain('script');
    expect(sanitized).toContain('ok');
  });

  test('renders markdown bold and code', () => {
    const formatted = markdownToMatrixHtml('**bold** and `code`', { isDirect: true });
    expect(formatted.formatted_body).toContain('<strong>bold</strong>');
    expect(formatted.formatted_body).toContain('<code>code</code>');
  });

  test('adds room prefix only outside DMs', () => {
    const room = markdownToMatrixHtml('hello', { prefix: 'porter', isDirect: false });
    expect(room.body).toBe('porter: hello');
    expect(room.formatted_body).toContain('<strong>porter:</strong>');

    const dm = markdownToMatrixHtml('hello', { prefix: 'porter', isDirect: true });
    expect(dm.body).toBe('hello');
    expect(dm.formatted_body).not.toContain('<strong>porter:</strong>');
  });
});

describe('assistantErrorText', () => {
  test('returns sanitized provider error', () => {
    const text = assistantErrorText([
      { role: 'assistant', stopReason: 'error', errorMessage: '429 rate limit exceeded' },
    ]);
    expect(text).toBe('429 rate limit exceeded');
  });

  test('truncates long errors', () => {
    const long = 'x'.repeat(600);
    expect(sanitizeAgentErrorText(long).length).toBeLessThanOrEqual(501);
  });
});
