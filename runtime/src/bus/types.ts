export type Attachment = {
  type: string;
  mimeType?: string;
  data?: string;
  name?: string;
  size?: number;
  workspaceRelativePath?: string;
};

export type InboundEvent = {
  id: number;
  sessionKey: string;
  channel: string;
  accountId: string;
  chatId: string;
  senderId: string;
  content: string;
  attachments: Attachment[];
  metadata: Record<string, unknown>;
  status: 'pending' | 'processing' | 'done' | 'failed';
  createdAt: Date;
  processedAt: Date | null;
  error: string | null;
};

export type NewInboundEvent = {
  sessionKey: string;
  channel: string;
  accountId: string;
  chatId: string;
  senderId: string;
  content: string;
  attachments?: Attachment[];
  metadata?: Record<string, unknown>;
};

export type OutboundDelivery = {
  id: number;
  inboundId: number | null;
  sessionKey: string;
  channel: string;
  accountId: string;
  chatId: string;
  type: 'message' | 'typing_on' | 'typing_off';
  content: string | null;
  media: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  attempts: number;
  createdAt: Date;
  sentAt: Date | null;
  error: string | null;
};

export type NewOutboundDelivery = {
  inboundId?: number | null;
  sessionKey: string;
  channel: string;
  accountId: string;
  chatId: string;
  type?: 'message' | 'typing_on' | 'typing_off';
  content?: string | null;
  media?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};
