export type TelegramAccessDecision = {
  allowed: boolean;
  reason?: string;
};

export class TelegramAccessControl {
  private allowed: Set<string>;
  private wildcard: boolean;

  constructor(allowedSenders: string[]) {
    const normalized = allowedSenders.map((sender) => sender.trim().toLowerCase()).filter(Boolean);
    this.allowed = new Set(normalized);
    this.wildcard = this.allowed.has('*');
  }

  check(senderId: string): TelegramAccessDecision {
    const normalized = senderId.trim().toLowerCase();
    if (!normalized) return { allowed: false, reason: 'missing-sender-id' };
    if (this.wildcard) return { allowed: true };
    if (this.allowed.size === 0) return { allowed: false, reason: 'no-allowed-senders-configured' };
    if (this.allowed.has(normalized)) return { allowed: true };
    return { allowed: false, reason: 'sender-not-allowed' };
  }
}
