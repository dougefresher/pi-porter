import { MsgType, RelationType } from 'matrix-js-sdk/lib/@types/event.js';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events.js';

const MARKDOWN_OPTS = {
  tables: false,
  strikethrough: true,
  tasklists: false,
  autolinks: true,
  tagFilter: true,
  headings: false,
  noHtmlBlocks: true,
  noHtmlSpans: true,
} as const;

const BLOCK_BREAK_TAGS = 'p, div, li, tr, h1, h2, h3, blockquote, pre';

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function decodeBasicHtmlEntities(text: string): string {
  return text
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

export function sanitizeMatrixHtml(html: string): string {
  if (!html.trim()) return '';

  return new HTMLRewriter()
    .on('script, style, iframe, object, embed, img', {
      element(element) {
        element.remove();
      },
    })
    .on('h4, h5, h6', {
      element(element) {
        element.removeAndKeepContent();
      },
    })
    .on('table', {
      element(element) {
        element.removeAndKeepContent();
      },
    })
    .on('a', {
      element(element) {
        element.setAttribute('rel', 'noopener noreferrer');
        element.setAttribute('target', '_blank');
      },
    })
    .transform(html);
}

export function htmlToPlainText(html: string): string {
  if (!html.trim()) return '';

  const sanitized = sanitizeMatrixHtml(html);
  const withBreaks = new HTMLRewriter()
    .on('br', {
      element(element) {
        element.replace('\n', { html: false });
      },
    })
    .on(BLOCK_BREAK_TAGS, {
      element(element) {
        element.after('\n', { html: false });
      },
    })
    .transform(sanitized);

  const plain = decodeBasicHtmlEntities(withBreaks.replace(/<[^>]+>/g, ''))
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return plain;
}

export function readMatrixMessagePlainText(content: Record<string, unknown>): string {
  const body = typeof content.body === 'string' ? content.body : '';
  if (body.trim()) return body;
  const formattedBody = typeof content.formatted_body === 'string' ? content.formatted_body : '';
  if (formattedBody.trim()) return htmlToPlainText(formattedBody);
  return '';
}

export function textAlreadyPrefixed(text: string, prefix: string): boolean {
  const normalizedPrefix = prefix.trim();
  if (!normalizedPrefix) return false;
  return new RegExp(`^${escapeRegExp(normalizedPrefix)}\\s*:`, 'i').test(text.trim());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function markdownToMatrixHtml(
  agentText: string,
  options?: { prefix?: string; isDirect?: boolean },
): { body: string; formatted_body: string } {
  const prefix = options?.isDirect ? '' : (options?.prefix ?? '').trim();
  let markdown = agentText.trim();
  if (prefix && textAlreadyPrefixed(markdown, prefix)) {
    markdown = markdown.replace(new RegExp(`^${escapeRegExp(prefix)}\\s*:\\s*`, 'i'), '').trim();
  }

  const rawHtml = Bun.markdown.html(markdown, MARKDOWN_OPTS);
  const sanitized = sanitizeMatrixHtml(rawHtml);
  const plainFromHtml = htmlToPlainText(sanitized) || markdown;

  if (!prefix) {
    return { body: plainFromHtml, formatted_body: sanitized };
  }

  return {
    body: `${prefix}: ${plainFromHtml}`,
    formatted_body: `<strong>${escapeHtml(prefix)}:</strong> ${sanitized}`,
  };
}

export type BuildMatrixMessageOptions = {
  text: string;
  prefix?: string;
  isDirect?: boolean;
  formatHtml?: boolean;
  replyToEventId?: string;
  threadEventId?: string;
};

export function buildMatrixMessageContent(options: BuildMatrixMessageOptions): RoomMessageEventContent {
  const formatHtml = options.formatHtml !== false;
  let content: RoomMessageEventContent;

  if (formatHtml) {
    const formatted = markdownToMatrixHtml(options.text, {
      prefix: options.prefix,
      isDirect: options.isDirect,
    });
    content = {
      msgtype: MsgType.Text,
      body: formatted.body,
      format: 'org.matrix.custom.html',
      formatted_body: formatted.formatted_body,
    };
  } else {
    const prefix = options.isDirect ? '' : (options.prefix ?? '').trim();
    let body = options.text.trim();
    if (prefix && !textAlreadyPrefixed(body, prefix)) {
      body = `${prefix}: ${body}`;
    }
    content = { msgtype: MsgType.Text, body };
  }

  if (options.replyToEventId) {
    content = {
      ...content,
      'm.relates_to': {
        'm.in_reply_to': { event_id: options.replyToEventId },
      },
    } as RoomMessageEventContent;
  } else if (options.threadEventId) {
    content = {
      ...content,
      'm.relates_to': {
        rel_type: RelationType.Thread,
        event_id: options.threadEventId,
        is_falling_back: true,
      },
    } as unknown as RoomMessageEventContent;
  }

  return content;
}
