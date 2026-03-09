import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Message } from '@homie/core';
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
      expect(session.name).toBe('default');
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

  describe('createSession + multi-session', () => {
    test('creates named session', async () => {
      const session = await store.createSession('telegram', 'chat1', 'my-project');
      expect(session.name).toBe('my-project');
      expect(session.status).toBe('idle');
    });

    test('listSessionsByChat returns all sessions', async () => {
      await store.createSession('telegram', 'chat1', 'project-a');
      await store.createSession('telegram', 'chat1', 'project-b');

      const sessions = await store.listSessionsByChat('telegram', 'chat1');
      expect(sessions.length).toBe(2);
    });

    test('getSessionByName finds by name', async () => {
      await store.createSession('telegram', 'chat1', 'my-project');
      const found = await store.getSessionByName('telegram', 'chat1', 'my-project');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('my-project');
    });

    test('getSessionByName returns null for unknown', async () => {
      const found = await store.getSessionByName('telegram', 'chat1', 'nope');
      expect(found).toBeNull();
    });
  });

  describe('active sessions', () => {
    test('setActiveSession + getActiveSession', async () => {
      const session = await store.createSession('telegram', 'chat1', 'test');
      await store.setActiveSession('telegram', 'chat1', session.id);

      const active = await store.getActiveSession('telegram', 'chat1');
      expect(active).not.toBeNull();
      expect(active!.id).toBe(session.id);
    });

    test('switching active session', async () => {
      const s1 = await store.createSession('telegram', 'chat1', 'first');
      const s2 = await store.createSession('telegram', 'chat1', 'second');

      await store.setActiveSession('telegram', 'chat1', s1.id);
      await store.setActiveSession('telegram', 'chat1', s2.id);

      const active = await store.getActiveSession('telegram', 'chat1');
      expect(active!.id).toBe(s2.id);
    });
  });

  describe('messages', () => {
    test('append and list messages', async () => {
      const session = await store.getOrCreateByChat('telegram', 'chat1');

      const msg: Message = {
        id: crypto.randomUUID(),
        sessionId: session.id,
        direction: 'in',
        text: 'hello',
        createdAt: new Date().toISOString(),
        rawSourceId: null,
        metadata: { foo: 'bar' },
      };

      await store.appendMessage(msg);
      const messages = await store.listRecentMessages(session.id, 10);

      expect(messages.length).toBe(1);
      expect(messages[0]!.text).toBe('hello');
      expect(messages[0]!.direction).toBe('in');
      expect(messages[0]!.metadata).toEqual({ foo: 'bar' });
    });

    test('listRecentMessages respects limit and order', async () => {
      const session = await store.getOrCreateByChat('telegram', 'chat1');

      for (let i = 0; i < 5; i++) {
        await store.appendMessage({
          id: crypto.randomUUID(),
          sessionId: session.id,
          direction: 'in',
          text: `msg-${i}`,
          createdAt: new Date(Date.now() + i * 1000).toISOString(),
          rawSourceId: null,
          metadata: {},
        });
      }

      const messages = await store.listRecentMessages(session.id, 3);
      expect(messages.length).toBe(3);
      // Should be the most recent 3, in chronological order
      expect(messages[0]!.text).toBe('msg-2');
      expect(messages[1]!.text).toBe('msg-3');
      expect(messages[2]!.text).toBe('msg-4');
    });
  });

  describe('session status', () => {
    test('setSessionStatus changes status', async () => {
      const session = await store.getOrCreateByChat('telegram', 'chat1');
      expect(session.status).toBe('idle');

      await store.setSessionStatus(session.id, 'processing');
      const updated = await store.getById(session.id);
      expect(updated!.status).toBe('processing');
    });

    test('resetStuckSessions resets processing to idle', async () => {
      const s1 = await store.getOrCreateByChat('telegram', 'chat1');
      const s2 = await store.getOrCreateByChat('telegram', 'chat2');

      await store.setSessionStatus(s1.id, 'processing');
      await store.setSessionStatus(s2.id, 'processing');

      const count = await store.resetStuckSessions();
      expect(count).toBe(2);

      const updated = await store.getById(s1.id);
      expect(updated!.status).toBe('idle');
    });
  });

  describe('resetSession', () => {
    test('deletes session and its messages', async () => {
      const session = await store.getOrCreateByChat('telegram', 'chat1');
      await store.appendMessage({
        id: crypto.randomUUID(),
        sessionId: session.id,
        direction: 'in',
        text: 'test',
        createdAt: new Date().toISOString(),
        rawSourceId: null,
        metadata: {},
      });

      const oldId = await store.resetSession('telegram', 'chat1');
      expect(oldId).toBe(session.id);

      const deleted = await store.getById(session.id);
      expect(deleted).toBeNull();
    });

    test('returns null if no active session', async () => {
      const result = await store.resetSession('telegram', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('setTitle', () => {
    test('updates session title', async () => {
      const session = await store.getOrCreateByChat('telegram', 'chat1');
      expect(session.title).toBeNull();

      await store.setTitle(session.id, 'My Chat');
      const updated = await store.getById(session.id);
      expect(updated!.title).toBe('My Chat');
    });
  });

  describe('countSessions', () => {
    test('counts all sessions', async () => {
      expect(await store.countSessions()).toBe(0);

      await store.createSession('telegram', 'chat1', 'a');
      await store.createSession('telegram', 'chat1', 'b');
      expect(await store.countSessions()).toBe(2);
    });
  });
});
