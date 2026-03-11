export type MessageDirection = 'in' | 'out';

export interface Session {
  id: string;
  channel: string;
  chatId: string;
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
