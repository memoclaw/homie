export type SessionKind = 'dm' | 'group' | 'system';
export type MessageDirection = 'in' | 'out' | 'internal';
export type SessionStatus = 'idle' | 'processing';

export interface Session {
  id: string;
  channel: string;
  chatId: string;
  userId: string | null;
  kind: SessionKind;
  title: string | null;
  name: string | null;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  sessionId: string;
  direction: MessageDirection;
  text: string;
  createdAt: string;
  rawSourceId: string | null;
  metadata: Record<string, unknown>;
}

/** Token usage and cost returned by a provider after a generation. */
export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number | null;
}
