import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { schema } from '@homie/persistence/src/migrations';
import { createSessionStore } from '@homie/persistence/src/session-store';
import { createSessionManager } from './session-manager';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  return db;
}

describe('SessionManager', () => {
  let db: Database;
  let manager: ReturnType<typeof createSessionManager>;

  beforeEach(() => {
    db = createTestDb();
    const store = createSessionStore(db);
    manager = createSessionManager(store);
  });

  afterEach(() => {
    db.close();
  });

  describe('resolveSession', () => {
    test('creates default session on first resolve', async () => {
      const session = await manager.resolveSession('telegram', 'chat1');
      expect(session.channel).toBe('telegram');
    });

    test('returns same session on re-resolve', async () => {
      const s1 = await manager.resolveSession('telegram', 'chat1');
      const s2 = await manager.resolveSession('telegram', 'chat1');
      expect(s1.id).toBe(s2.id);
    });
  });

  describe('messages', () => {
    test('addMessage and getHistory', async () => {
      const session = await manager.resolveSession('telegram', 'chat1');

      await manager.addMessage(session.id, 'in', 'hello');
      await manager.addMessage(session.id, 'out', 'hi there');

      const history = await manager.getHistory(session.id, 10);
      expect(history.length).toBe(2);
      expect(history[0]?.text).toBe('hello');
      expect(history[1]?.text).toBe('hi there');
    });
  });

  describe('status management', () => {
    test('setProcessing and setIdle', async () => {
      const session = await manager.resolveSession('telegram', 'chat1');

      await manager.setProcessing(session.id);

      // Re-resolve to check updated status
      const s2 = await manager.resolveSession('telegram', 'chat1');
      expect(s2.status).toBe('processing');

      await manager.setIdle(session.id);
      const s3 = await manager.resolveSession('telegram', 'chat1');
      expect(s3.status).toBe('idle');
    });
  });

  describe('resetStuckSessions', () => {
    test('resets processing sessions', async () => {
      const s1 = await manager.resolveSession('telegram', 'chat1');
      await manager.setProcessing(s1.id);

      const count = await manager.resetStuckSessions();
      expect(count).toBe(1);

      const s2 = await manager.resolveSession('telegram', 'chat1');
      expect(s2.status).toBe('idle');
    });
  });
});
