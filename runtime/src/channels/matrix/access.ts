export type MatrixAccessDecision = {
  allowed: boolean;
  reason?: string;
};

function normalizeMatrixUserId(value: string): string {
  return value.trim().toLowerCase();
}

export class MatrixAccessControl {
  private allowedSenders: Set<string>;
  private allowedRooms: Set<string>;
  private senderWildcard: boolean;
  private roomWildcard: boolean;

  constructor(allowedSenders: string[], allowedRooms: string[]) {
    const normalizedSenders = allowedSenders.map(normalizeMatrixUserId).filter(Boolean);
    this.allowedSenders = new Set(normalizedSenders);
    this.senderWildcard = this.allowedSenders.has('*');

    const normalizedRooms = allowedRooms.map((room) => room.trim()).filter(Boolean);
    this.allowedRooms = new Set(normalizedRooms);
    this.roomWildcard = this.allowedRooms.has('*') || this.allowedRooms.size === 0;
  }

  checkSender(senderId: string): MatrixAccessDecision {
    const normalized = normalizeMatrixUserId(senderId);
    if (!normalized) return { allowed: false, reason: 'missing-sender-id' };
    if (this.senderWildcard) return { allowed: true };
    if (this.allowedSenders.size === 0) return { allowed: false, reason: 'no-allowed-senders-configured' };
    if (this.allowedSenders.has(normalized)) return { allowed: true };
    return { allowed: false, reason: 'sender-not-allowed' };
  }

  checkRoom(roomId: string, isDirect: boolean): MatrixAccessDecision {
    if (isDirect) return { allowed: true };
    if (this.roomWildcard) return { allowed: true };
    const normalized = roomId.trim();
    if (!normalized) return { allowed: false, reason: 'missing-room-id' };
    if (this.allowedRooms.has(normalized)) return { allowed: true };
    return { allowed: false, reason: 'room-not-allowed' };
  }
}
