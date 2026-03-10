export type MessageDirection = 'in' | 'out';
export type SessionStatus = 'idle' | 'processing';

export interface Session {
  id: string;
  channel: string;
  chatId: string;
  userId: string | null;
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
}

// --- Tasks ---

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'aborted';

export interface Task {
  id: string;
  channel: string;
  chatId: string;
  userId: string | null;
  sessionId: string;
  messageId: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

/** Token usage and cost returned by a provider after a generation. */
export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number | null;
}
