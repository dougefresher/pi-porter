const API_KEY_PATTERN = /(?:sk-[a-zA-Z0-9_-]{10,}|api[_-]?key[=:\s]+[a-zA-Z0-9._-]{10,})/gi;

export function sanitizeAgentErrorText(raw: string, maxLen = 500): string {
  let text = raw.trim().replace(API_KEY_PATTERN, '[redacted]');
  if (text.length > maxLen) {
    text = `${text.slice(0, maxLen)}…`;
  }
  return text;
}

type AssistantLikeMessage = {
  role?: string;
  stopReason?: string;
  errorMessage?: string;
};

export function assistantErrorText(messages: readonly AssistantLikeMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'assistant') continue;
    if (message.stopReason === 'error' && message.errorMessage) {
      return sanitizeAgentErrorText(message.errorMessage);
    }
    if (message.stopReason && message.stopReason !== 'error') break;
  }
  return null;
}
