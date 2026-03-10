import type { Message, Session, SessionStore } from '@homie/core';
import { createLogger } from '@homie/observability';

const log = createLogger('sessions');

export interface SessionManager {
  resolveSession(channel: string, chatId: string, userId?: string | null): Promise<Session>;
  createNamedSession(
    channel: string,
    chatId: string,
    name: string,
    userId?: string | null,
  ): Promise<Session>;
  switchSession(channel: string, chatId: string, nameOrId: string): Promise<Session>;
  listSessions(channel: string, chatId: string): Promise<Session[]>;
  getActiveSession(channel: string, chatId: string): Promise<Session | null>;
  addMessage(
    sessionId: string,
    direction: Message['direction'],
    text: string,
    rawSourceId?: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<Message>;
  getHistory(sessionId: string, limit: number): Promise<Message[]>;
  getSession(sessionId: string): Promise<Session | null>;
  resetSession(channel: string, chatId: string): Promise<string | null>;
  deleteSession(
    channel: string,
    chatId: string,
    nameOrId: string,
  ): Promise<{ deletedId: string; wasActive: boolean }>;
  setProcessing(sessionId: string): Promise<void>;
  setIdle(sessionId: string): Promise<void>;
  setTitle(sessionId: string, title: string): Promise<void>;
  resetStuckSessions(): Promise<number>;
}

export function createSessionManager(store: SessionStore): SessionManager {
  return {
    async resolveSession(channel, chatId, userId) {
      const session = await store.getOrCreateByChat(channel, chatId, userId);
      log.debug('Session resolved', {
        sessionId: session.id,
        name: session.name,
        chatId,
      });
      return session;
    },

    async createNamedSession(channel, chatId, name, userId) {
      const existing = await store.getSessionByName(channel, chatId, name);
      if (existing) throw new Error(`Session "${name}" already exists`);

      const session = await store.createSession(channel, chatId, name, userId);
      await store.setActiveSession(channel, chatId, session.id);
      log.info('Named session created', {
        sessionId: session.id,
        name,
        chatId,
      });
      return session;
    },

    async switchSession(channel, chatId, nameOrId) {
      let session = await store.getSessionByName(channel, chatId, nameOrId);
      if (!session) {
        const all = await store.listSessionsByChat(channel, chatId);
        session = all.find((s) => s.id.startsWith(nameOrId)) ?? null;
      }
      if (!session) throw new Error(`No session "${nameOrId}" found`);

      await store.setActiveSession(channel, chatId, session.id);
      log.info('Session switched', {
        sessionId: session.id,
        name: session.name,
        chatId,
      });
      return session;
    },

    async listSessions(channel, chatId) {
      return store.listSessionsByChat(channel, chatId);
    },

    async getActiveSession(channel, chatId) {
      return store.getActiveSession(channel, chatId);
    },

    async addMessage(sessionId, direction, text, rawSourceId, metadata) {
      const message: Message = {
        id: crypto.randomUUID(),
        sessionId,
        direction,
        text,
        createdAt: new Date().toISOString(),
        rawSourceId: rawSourceId ?? null,
        metadata: metadata ?? {},
      };
      await store.appendMessage(message);
      return message;
    },

    async getHistory(sessionId, limit) {
      return store.listRecentMessages(sessionId, limit);
    },

    async getSession(sessionId) {
      return store.getById(sessionId);
    },

    async deleteSession(channel, chatId, nameOrId) {
      let session = await store.getSessionByName(channel, chatId, nameOrId);
      if (!session) {
        const all = await store.listSessionsByChat(channel, chatId);
        session = all.find((s) => s.id.startsWith(nameOrId)) ?? null;
      }
      if (!session) throw new Error(`No session "${nameOrId}" found`);

      const active = await store.getActiveSession(channel, chatId);
      const wasActive = active?.id === session.id;

      await store.deleteSession(session.id);

      if (wasActive) {
        // Switch to the most recent remaining session
        const remaining = await store.listSessionsByChat(channel, chatId);
        if (remaining.length > 0) {
          await store.setActiveSession(channel, chatId, remaining[0]!.id);
        }
      }

      log.info('Session deleted', { sessionId: session.id, name: session.name, chatId });
      return { deletedId: session.id, wasActive };
    },

    async resetSession(channel, chatId) {
      const oldId = await store.resetSession(channel, chatId);
      if (oldId) {
        log.info('Session reset', { channel, chatId, oldSessionId: oldId });
      }
      return oldId;
    },

    async setProcessing(sessionId) {
      await store.setSessionStatus(sessionId, 'processing');
    },

    async setIdle(sessionId) {
      await store.setSessionStatus(sessionId, 'idle');
    },

    async setTitle(sessionId, title) {
      await store.setTitle(sessionId, title);
    },

    async resetStuckSessions() {
      return store.resetStuckSessions();
    },
  };
}
