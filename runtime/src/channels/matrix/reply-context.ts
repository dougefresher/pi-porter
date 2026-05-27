import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk/lib/matrix.js';

import { readMatrixMessagePlainText } from './matrix-html.js';

const PARENT_FETCH_TIMEOUT_MS = 3_000;

export function readInReplyToEventId(event: MatrixEvent): string | undefined {
  const relatesTo = event.getContent()?.['m.relates_to'] as
    | {
        'm.in_reply_to'?: { event_id?: string };
      }
    | undefined;
  const eventId = relatesTo?.['m.in_reply_to']?.event_id;
  return typeof eventId === 'string' && eventId.trim() ? eventId : undefined;
}

function readSenderLabel(event: MatrixEvent): string {
  const sender = event.getSender();
  return sender?.trim() || 'unknown';
}

function truncateReplyQuote(text: string, maxLen = 200): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}…`;
}

async function fetchParentContent(
  client: MatrixClient,
  room: Room,
  eventId: string,
): Promise<{ senderLabel: string; quote: string } | null> {
  const fromTimeline = room.findEventById(eventId);
  if (fromTimeline && !fromTimeline.isRedacted()) {
    const quote = readMatrixMessagePlainText(fromTimeline.getContent() as Record<string, unknown>);
    if (quote.trim()) {
      return {
        senderLabel: readSenderLabel(fromTimeline),
        quote: truncateReplyQuote(quote),
      };
    }
  }

  try {
    const fetched = await Promise.race([
      client.fetchRoomEvent(room.roomId, eventId),
      Bun.sleep(PARENT_FETCH_TIMEOUT_MS).then(() => null),
    ]);
    if (!fetched?.content || typeof fetched.content !== 'object') return null;

    const content = fetched.content as Record<string, unknown>;
    const quote = readMatrixMessagePlainText(content);
    if (!quote.trim()) return null;

    const sender = typeof fetched.sender === 'string' && fetched.sender.trim() ? fetched.sender : 'unknown';
    return {
      senderLabel: sender,
      quote: truncateReplyQuote(quote),
    };
  } catch {
    return null;
  }
}

export async function buildReplyAwareContent(
  client: MatrixClient,
  room: Room,
  event: MatrixEvent,
  userContent: string,
): Promise<{ content: string; replyToEventId?: string }> {
  const replyToEventId = readInReplyToEventId(event);
  if (!replyToEventId) {
    return { content: userContent };
  }

  const parent = await fetchParentContent(client, room, replyToEventId);
  if (!parent) {
    return { content: userContent, replyToEventId };
  }

  const prefix = `[Replying to ${parent.senderLabel}: "${parent.quote}"]`;
  return {
    content: `${prefix}\n${userContent}`,
    replyToEventId,
  };
}

export function readMatrixMentions(
  content: Record<string, unknown>,
): { user_ids?: string[]; room?: boolean } | undefined {
  const mentions = content['m.mentions'];
  if (!mentions || typeof mentions !== 'object') return undefined;
  const payload = mentions as { user_ids?: unknown; room?: unknown };
  const userIds = Array.isArray(payload.user_ids)
    ? payload.user_ids.filter((value): value is string => typeof value === 'string')
    : undefined;
  return {
    user_ids: userIds,
    room: payload.room === true ? true : undefined,
  };
}

export function readFormattedBody(content: Record<string, unknown>): string | undefined {
  const formattedBody = content.formatted_body;
  return typeof formattedBody === 'string' && formattedBody.trim() ? formattedBody : undefined;
}
