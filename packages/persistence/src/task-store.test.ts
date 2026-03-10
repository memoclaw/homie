import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { schema } from './migrations';
import { createSessionStore } from './session-store';
import { createTaskStore } from './task-store';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  return db;
}

describe('TaskStore', () => {
  let db: Database;
  let store: ReturnType<typeof createTaskStore>;
  let sessionStore: ReturnType<typeof createSessionStore>;
  let sessionId: string;

  beforeEach(async () => {
    db = createTestDb();
    store = createTaskStore(db);
    sessionStore = createSessionStore(db);
    const session = await sessionStore.getOrCreateByChat('telegram', 'chat1');
    sessionId = session.id;
  });

  afterEach(() => {
    db.close();
  });

  /** Helper: create a message and return its ID */
  async function addMessage(text: string): Promise<string> {
    const msg = await sessionStore.addMessage(sessionId, 'in', text);
    return msg.id;
  }

  const params = () => ({
    channel: 'telegram',
    chatId: 'chat1',
    userId: 'user1' as string | null,
    sessionId: '',
    messageId: null as string | null,
  });

  describe('createTask', () => {
    test('creates task with queued status', async () => {
      const msgId = await addMessage('fix the bug');
      const task = await store.createTask({ ...params(), sessionId, messageId: msgId });
      expect(task.id).toBeDefined();
      expect(task.status).toBe('queued');
      expect(task.messageId).toBe(msgId);
      expect(task.channel).toBe('telegram');
      expect(task.chatId).toBe('chat1');
      expect(task.userId).toBe('user1');
      expect(task.sessionId).toBe(sessionId);
    });
  });

  describe('getTask', () => {
    test('returns task by ID', async () => {
      const msgId = await addMessage('fix the bug');
      const created = await store.createTask({ ...params(), sessionId, messageId: msgId });
      const found = await store.getTask(created.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.messageId).toBe(msgId);
    });

    test('returns null for non-existent ID', async () => {
      const found = await store.getTask('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('getRunningTask', () => {
    test('returns running task with text', async () => {
      const msgId = await addMessage('deploy feature');
      const task = await store.createTask({ ...params(), sessionId, messageId: msgId });
      await store.updateTaskStatus(task.id, 'running');

      const running = await store.getRunningTask('telegram', 'chat1');
      expect(running).not.toBeNull();
      expect(running?.id).toBe(task.id);
      expect(running?.text).toBe('deploy feature');
    });

    test('returns null if no running task', async () => {
      const msgId = await addMessage('test');
      await store.createTask({ ...params(), sessionId, messageId: msgId });
      const running = await store.getRunningTask('telegram', 'chat1');
      expect(running).toBeNull();
    });

    test('returns null for different chat', async () => {
      const msgId = await addMessage('test');
      const task = await store.createTask({ ...params(), sessionId, messageId: msgId });
      await store.updateTaskStatus(task.id, 'running');

      const running = await store.getRunningTask('telegram', 'other-chat');
      expect(running).toBeNull();
    });
  });

  describe('getQueuedTasks', () => {
    test('returns queued tasks in FIFO order', async () => {
      const t1 = await store.createTask({ ...params(), sessionId, messageId: null });
      const t2 = await store.createTask({ ...params(), sessionId, messageId: null });

      const queued = await store.getQueuedTasks('telegram', 'chat1');
      expect(queued.length).toBe(2);
      expect(queued[0]?.id).toBe(t1.id);
      expect(queued[1]?.id).toBe(t2.id);
    });

    test('returns empty array if no queued tasks', async () => {
      const task = await store.createTask({ ...params(), sessionId, messageId: null });
      await store.updateTaskStatus(task.id, 'running');

      const queued = await store.getQueuedTasks('telegram', 'chat1');
      expect(queued.length).toBe(0);
    });
  });

  describe('listTasks', () => {
    test('returns tasks newest first with text', async () => {
      const msg1 = await addMessage('first');
      await store.createTask({ ...params(), sessionId, messageId: msg1 });
      await new Promise((r) => setTimeout(r, 10));
      const msg2 = await addMessage('second');
      await store.createTask({ ...params(), sessionId, messageId: msg2 });

      const tasks = await store.listTasks('telegram', 'chat1');
      expect(tasks.length).toBe(2);
      expect(tasks[0]?.text).toBe('second');
      expect(tasks[1]?.text).toBe('first');
    });

    test('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await store.createTask({ ...params(), sessionId, messageId: null });
      }
      const tasks = await store.listTasks('telegram', 'chat1', 3);
      expect(tasks.length).toBe(3);
    });

    test('scoped to channel and chatId', async () => {
      await store.createTask({ ...params(), sessionId, messageId: null });

      const tasks = await store.listTasks('telegram', 'other-chat');
      expect(tasks.length).toBe(0);
    });

    test('returns null text when no message linked', async () => {
      await store.createTask({ ...params(), sessionId, messageId: null });
      const tasks = await store.listTasks('telegram', 'chat1');
      expect(tasks[0]?.text).toBeNull();
    });
  });

  describe('updateTaskStatus', () => {
    test('changes status', async () => {
      const task = await store.createTask({ ...params(), sessionId, messageId: null });
      await store.updateTaskStatus(task.id, 'running');

      const updated = await store.getTask(task.id);
      expect(updated?.status).toBe('running');
    });

    test('updates updatedAt timestamp', async () => {
      const task = await store.createTask({ ...params(), sessionId, messageId: null });
      const originalUpdatedAt = task.updatedAt;

      await new Promise((r) => setTimeout(r, 10));
      await store.updateTaskStatus(task.id, 'done');

      const updated = await store.getTask(task.id);
      expect(updated?.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe('resetStuckTasks', () => {
    test('sets running tasks to failed', async () => {
      const t1 = await store.createTask({ ...params(), sessionId, messageId: null });
      await store.updateTaskStatus(t1.id, 'running');

      const count = await store.resetStuckTasks();
      expect(count).toBe(1);

      const updated = await store.getTask(t1.id);
      expect(updated?.status).toBe('failed');
    });

    test('also resets queued tasks to failed', async () => {
      const t1 = await store.createTask({ ...params(), sessionId, messageId: null });
      // t1 stays queued (default)

      const count = await store.resetStuckTasks();
      expect(count).toBe(1);

      const updated = await store.getTask(t1.id);
      expect(updated?.status).toBe('failed');
    });

    test('does not affect completed tasks', async () => {
      const done = await store.createTask({ ...params(), sessionId, messageId: null });
      await store.updateTaskStatus(done.id, 'done');

      const count = await store.resetStuckTasks();
      expect(count).toBe(0);

      expect((await store.getTask(done.id))?.status).toBe('done');
    });

    test('returns count of affected tasks', async () => {
      const t1 = await store.createTask({ ...params(), sessionId, messageId: null });
      const t2 = await store.createTask({ ...params(), sessionId, messageId: null });
      await store.updateTaskStatus(t1.id, 'running');
      await store.updateTaskStatus(t2.id, 'running');

      const count = await store.resetStuckTasks();
      expect(count).toBe(2);
    });
  });
});
