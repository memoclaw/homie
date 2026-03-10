import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { schema } from './migrations';
import { createSessionStore } from './session-store';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  return db;
}

describe('SessionStore', () => {
  let db: Database;
  let store: ReturnType<typeof createSessionStore>;

  beforeEach(() => {
    db = createTestDb();
    store = createSessionStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('getOrCreateByChat', () => {
    test('creates a new session on first call', async () => {
      const session = await store.getOrCreateByChat('telegram', 'chat1');
      expect(session.id).toBeDefined();
      expect(session.channel).toBe('telegram');
      expect(session.chatId).toBe('chat1');
      expect(session.status).toBe('idle');
    });

    test('returns same session on subsequent calls', async () => {
      const s1 = await store.getOrCreateByChat('telegram', 'chat1');
      const s2 = await store.getOrCreateByChat('telegram', 'chat1');
      expect(s1.id).toBe(s2.id);
    });

    test('different chats get different sessions', async () => {
      const s1 = await store.getOrCreateByChat('telegram', 'chat1');
      const s2 = await store.getOrCreateByChat('telegram', 'chat2');
      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe('messages', () => {
    test('addMessage creates and returns message', async () => {
      const session = await store.getOrCreateByChat('telegram', 'chat1');

      const msg = await store.addMessage(session.id, 'in', 'hello');
      expect(msg.id).toBeTruthy();
      expect(msg.sessionId).toBe(session.id);
      expect(msg.direction).toBe('in');
      expect(msg.text).toBe('hello');

      const messages = await store.listRecentMessages(session.id, 10);
      expect(messages.length).toBe(1);
      expect(messages[0]?.text).toBe('hello');
      expect(messages[0]?.direction).toBe('in');
    });

    test('listRecentMessages respects limit and order', async () => {
      const session = await store.getOrCreateByChat('telegram', 'chat1');

      for (let i = 0; i < 5; i++) {
        await store.addMessage(session.id, 'in', `msg-${i}`);
      }

      const messages = await store.listRecentMessages(session.id, 3);
      expect(messages.length).toBe(3);
      // Should be the most recent 3, in chronological order
      expect(messages[0]?.text).toBe('msg-2');
      expect(messages[1]?.text).toBe('msg-3');
      expect(messages[2]?.text).toBe('msg-4');
    });
  });

  describe('session status', () => {
    test('setSessionStatus changes status', async () => {
      const session = await store.getOrCreateByChat('telegram', 'chat1');
      expect(session.status).toBe('idle');

      await store.setSessionStatus(session.id, 'processing');
      const updated = await store.getById(session.id);
      expect(updated?.status).toBe('processing');
    });

    test('resetStuckSessions resets processing to idle', async () => {
      const s1 = await store.getOrCreateByChat('telegram', 'chat1');
      const s2 = await store.getOrCreateByChat('telegram', 'chat2');

      await store.setSessionStatus(s1.id, 'processing');
      await store.setSessionStatus(s2.id, 'processing');

      const count = await store.resetStuckSessions();
      expect(count).toBe(2);

      const updated = await store.getById(s1.id);
      expect(updated?.status).toBe('idle');
    });
  });

  describe('countSessions', () => {
    test('counts all sessions', async () => {
      expect(await store.countSessions()).toBe(0);

      await store.getOrCreateByChat('telegram', 'chat1');
      await store.getOrCreateByChat('telegram', 'chat2');
      expect(await store.countSessions()).toBe(2);
    });
  });
});
