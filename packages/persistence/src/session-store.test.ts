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

  test('creates an active session on first access', async () => {
    const session = await store.getOrCreateActiveByChat('telegram', 'chat1');
    expect(session.id).toBeDefined();
    expect(session.channel).toBe('telegram');
    expect(session.chatId).toBe('chat1');
  });

  test('returns same active session on repeated access', async () => {
    const first = await store.getOrCreateActiveByChat('telegram', 'chat1');
    const second = await store.getOrCreateActiveByChat('telegram', 'chat1');
    expect(first.id).toBe(second.id);
  });

  test('startFreshSession replaces active session for a chat', async () => {
    const first = await store.getOrCreateActiveByChat('telegram', 'chat1');
    const second = await store.startFreshSession('telegram', 'chat1');
    const active = await store.getOrCreateActiveByChat('telegram', 'chat1');
    expect(second.id).not.toBe(first.id);
    expect(active.id).toBe(second.id);
  });

  test('stores and lists messages in chronological order', async () => {
    const session = await store.getOrCreateActiveByChat('telegram', 'chat1');
    await store.addMessage(session.id, 'in', 'hello');
    await store.addMessage(session.id, 'out', 'world');

    const messages = await store.listRecentMessages(session.id, 10);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.text).toBe('hello');
    expect(messages[1]?.text).toBe('world');
  });
});
