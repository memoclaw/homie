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
      expect(session.name).toBe('default');
      expect(session.channel).toBe('telegram');
    });

    test('returns same session on re-resolve', async () => {
      const s1 = await manager.resolveSession('telegram', 'chat1');
      const s2 = await manager.resolveSession('telegram', 'chat1');
      expect(s1.id).toBe(s2.id);
    });
  });

  describe('createNamedSession', () => {
    test('creates and activates named session', async () => {
      const session = await manager.createNamedSession('telegram', 'chat1', 'my-project');
      expect(session.name).toBe('my-project');

      const active = await manager.getActiveSession('telegram', 'chat1');
      expect(active!.id).toBe(session.id);
    });

    test('rejects duplicate name', async () => {
      await manager.createNamedSession('telegram', 'chat1', 'dupe');
      expect(
        manager.createNamedSession('telegram', 'chat1', 'dupe'),
      ).rejects.toThrow('already exists');
    });
  });

  describe('switchSession', () => {
    test('switch by name', async () => {
      await manager.resolveSession('telegram', 'chat1');
      const s2 = await manager.createNamedSession('telegram', 'chat1', 'other');

      // Currently active is 'other' (createNamedSession sets active)
      // Switch back to default
      const switched = await manager.switchSession('telegram', 'chat1', 'default');
      expect(switched.name).toBe('default');
    });

    test('switch by id prefix', async () => {
      const session = await manager.createNamedSession('telegram', 'chat1', 'test');
      const prefix = session.id.slice(0, 8);

      // Create another session to make it non-trivial
      await manager.createNamedSession('telegram', 'chat1', 'other');

      const switched = await manager.switchSession('telegram', 'chat1', prefix);
      expect(switched.id).toBe(session.id);
    });

    test('throws for unknown session', async () => {
      expect(
        manager.switchSession('telegram', 'chat1', 'nonexistent'),
      ).rejects.toThrow('No session');
    });
  });

  describe('messages', () => {
    test('addMessage and getHistory', async () => {
      const session = await manager.resolveSession('telegram', 'chat1');

      await manager.addMessage(session.id, 'in', 'hello');
      await manager.addMessage(session.id, 'out', 'hi there');

      const history = await manager.getHistory(session.id, 10);
      expect(history.length).toBe(2);
      expect(history[0]!.text).toBe('hello');
      expect(history[1]!.text).toBe('hi there');
    });
  });

  describe('status management', () => {
    test('setProcessing and setIdle', async () => {
      const session = await manager.resolveSession('telegram', 'chat1');

      await manager.setProcessing(session.id);
      let updated = await manager.getSession(session.id);
      expect(updated!.status).toBe('processing');

      await manager.setIdle(session.id);
      updated = await manager.getSession(session.id);
      expect(updated!.status).toBe('idle');
    });
  });

  describe('resetSession', () => {
    test('resets and returns old id', async () => {
      const session = await manager.resolveSession('telegram', 'chat1');
      await manager.addMessage(session.id, 'in', 'test');

      const oldId = await manager.resetSession('telegram', 'chat1');
      expect(oldId).toBe(session.id);

      // New resolve should create fresh session
      const fresh = await manager.resolveSession('telegram', 'chat1');
      expect(fresh.id).not.toBe(session.id);
    });
  });

  describe('resetStuckSessions', () => {
    test('resets processing sessions', async () => {
      const s1 = await manager.resolveSession('telegram', 'chat1');
      await manager.setProcessing(s1.id);

      const count = await manager.resetStuckSessions();
      expect(count).toBe(1);

      const updated = await manager.getSession(s1.id);
      expect(updated!.status).toBe('idle');
    });
  });

  describe('listSessions', () => {
    test('lists all sessions for a chat', async () => {
      await manager.resolveSession('telegram', 'chat1');
      await manager.createNamedSession('telegram', 'chat1', 'project-a');
      await manager.createNamedSession('telegram', 'chat1', 'project-b');

      const sessions = await manager.listSessions('telegram', 'chat1');
      expect(sessions.length).toBe(3);
    });
  });
});
