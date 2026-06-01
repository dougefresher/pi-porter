import { RelationType } from 'matrix-js-sdk/lib/@types/event.js';

export const DEFAULT_MATRIX_ACK_REACTION = '👀';

export type MatrixReactionContent = {
  'm.relates_to': {
    rel_type: typeof RelationType.Annotation;
    event_id: string;
    key: string;
  };
};

export function buildMatrixReactionContent(messageId: string, emoji: string): MatrixReactionContent {
  const eventId = messageId.trim();
  const key = emoji.trim();
  if (!eventId) throw new Error('Matrix reaction requires a messageId');
  if (!key) throw new Error('Matrix reaction requires an emoji');
  return {
    'm.relates_to': {
      rel_type: RelationType.Annotation,
      event_id: eventId,
      key,
    },
  };
}
