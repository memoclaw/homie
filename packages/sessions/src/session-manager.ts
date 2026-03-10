import type { Message, Session, SessionStore } from '@homie/core';
import { createLogger } from '@homie/observability';

const log = createLogger('sessions');

export interface SessionManager {
  resolveSession(channel: string, chatId: string, userId?: string | null): Promise<Session>;
  addMessage(
    sessionId: string,
    direction: Message['direction'],
    text: string,
    rawSourceId?: string | null,
  ): Promise<Message>;
  getHistory(sessionId: string, limit: number): Promise<Message[]>;
  setProcessing(sessionId: string): Promise<void>;
  setIdle(sessionId: string): Promise<void>;
  resetStuckSessions(): Promise<number>;
}

export function createSessionManager(store: SessionStore): SessionManager {
  return {
    async resolveSession(channel, chatId, userId) {
      const session = await store.getOrCreateByChat(channel, chatId, userId);
      log.debug('Session resolved', { sessionId: session.id, chatId });
      return session;
    },

    async addMessage(sessionId, direction, text, rawSourceId) {
      const message: Message = {
        id: crypto.randomUUID(),
        sessionId,
        direction,
        text,
        createdAt: new Date().toISOString(),
        rawSourceId: rawSourceId ?? null,
      };
      await store.appendMessage(message);
      return message;
    },

    async getHistory(sessionId, limit) {
      return store.listRecentMessages(sessionId, limit);
    },

    async setProcessing(sessionId) {
      await store.setSessionStatus(sessionId, 'processing');
    },

    async setIdle(sessionId) {
      await store.setSessionStatus(sessionId, 'idle');
    },

    async resetStuckSessions() {
      return store.resetStuckSessions();
    },
  };
}
