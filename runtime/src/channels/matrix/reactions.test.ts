import { describe, expect, test } from 'bun:test';
import { RelationType } from 'matrix-js-sdk/lib/@types/event.js';

import { buildMatrixReactionContent, DEFAULT_MATRIX_ACK_REACTION } from './reactions.js';

describe('buildMatrixReactionContent', () => {
  test('builds m.annotation reaction', () => {
    expect(buildMatrixReactionContent('$abc123', '👀')).toEqual({
      'm.relates_to': {
        rel_type: RelationType.Annotation,
        event_id: '$abc123',
        key: '👀',
      },
    });
  });

  test('default ack reaction is eyes', () => {
    expect(DEFAULT_MATRIX_ACK_REACTION).toBe('👀');
  });
});
