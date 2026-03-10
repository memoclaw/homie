import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createAgent } from '@homie/agent';
import { AbortError, type ProviderAdapter } from '@homie/core';
import { schema } from '@homie/persistence/src/migrations';
import { createSessionStore } from '@homie/persistence/src/session-store';
import { createTaskStore } from '@homie/persistence/src/task-store';
import { createUsageStore } from '@homie/persistence/src/usage-store';
import { createSessionManager } from '@homie/sessions';
import { createTaskRunner, type TaskRunner } from './task-runner';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  return db;
}

describe('TaskRunner', () => {
  let db: Database;
  let runner: TaskRunner;
  let taskStore: ReturnType<typeof createTaskStore>;
  let sessionId: string;
  let provider: ProviderAdapter;

  beforeEach(async () => {
    db = createTestDb();
    const sessionStore = createSessionStore(db);
    const sessionManager = createSessionManager(sessionStore);
    const usageStore = createUsageStore(db);
    taskStore = createTaskStore(db);

    const session = await sessionManager.resolveSession('telegram', 'chat1', 'user1');
    sessionId = session.id;

    provider = {
      generate: mock(async () => ({
        content: 'done',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
          costUsd: 0.001,
        },
      })),
    };
    const agent = createAgent(provider, { model: 'test' });

    runner = createTaskRunner({
      sessionManager,
      agent,
      taskStore,
      usageStore,
    });
  });

  afterEach(() => {
    db.close();
  });

  function submitParams(text = 'do something') {
    const replies: string[] = [];
    return {
      params: {
        channel: 'telegram',
        chatId: 'chat1',
        userId: 'user1' as string | null,
        sessionId,
        text,
        rawSourceId: null as string | null,
        reply: async (t: string) => {
          replies.push(t);
        },
      },
      replies,
    };
  }

  describe('submit', () => {
    test('executes task and replies with result', async () => {
      const { params, replies } = submitParams('hello');
      await runner.submit(params);
      // Wait for async execution
      await new Promise((r) => setTimeout(r, 50));

      expect(provider.generate).toHaveBeenCalled();
      expect(replies).toContain('done');
    });

    test('creates task record in DB', async () => {
      const { params } = submitParams('build feature');
      await runner.submit(params);
      await new Promise((r) => setTimeout(r, 50));

      const tasks = await taskStore.listTasks('telegram', 'chat1');
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.text).toBe('build feature');
      expect(tasks[0]?.status).toBe('done');
    });

    test('sets task to failed on provider error', async () => {
      (provider.generate as ReturnType<typeof mock>).mockImplementation(async () => {
        throw new Error('boom');
      });

      const { params, replies } = submitParams();
      await runner.submit(params);
      await new Promise((r) => setTimeout(r, 50));

      const tasks = await taskStore.listTasks('telegram', 'chat1');
      expect(tasks[0]?.status).toBe('failed');
      expect(replies).toContain('Something went wrong. Please try again.');
    });
  });

  describe('queue', () => {
    test('queues second task while first is running', async () => {
      // Make first task slow
      let resolveFirst: (() => void) | undefined;
      const firstDone = new Promise<void>((r) => {
        resolveFirst = r;
      });
      (provider.generate as ReturnType<typeof mock>).mockImplementationOnce(async () => {
        await firstDone;
        return { content: 'first done', usage: undefined };
      });

      const { params: p1, replies: r1 } = submitParams('first');
      const { params: p2, replies: r2 } = submitParams('second');

      await runner.submit(p1);
      await runner.submit(p2);

      // Second should be queued
      expect(r2).toContain('Queued (position 1). Will start when the current task finishes.');

      // Resolve first
      resolveFirst?.();
      await new Promise((r) => setTimeout(r, 100));

      // First should have completed
      expect(r1).toContain('first done');
      // Second should also complete after drain
      expect(r2).toContain('done');
    });

    test('shows correct queue position', async () => {
      // Block first task
      (provider.generate as ReturnType<typeof mock>).mockImplementationOnce(
        () => new Promise(() => {}), // never resolves
      );

      const { params: p1 } = submitParams('first');
      await runner.submit(p1);

      const { params: p2, replies: r2 } = submitParams('second');
      const { params: p3, replies: r3 } = submitParams('third');

      await runner.submit(p2);
      await runner.submit(p3);

      expect(r2[0]).toContain('position 1');
      expect(r3[0]).toContain('position 2');
    });
  });

  describe('abort', () => {
    test('returns false if no running task', async () => {
      const result = await runner.abort('telegram', 'chat1');
      expect(result).toBe(false);
    });

    test('aborts running task', async () => {
      // Block task
      (provider.generate as ReturnType<typeof mock>).mockImplementationOnce(
        async ({ signal }: { signal?: AbortSignal }) => {
          await new Promise((_resolve, reject) => {
            if (signal?.aborted) return reject(new AbortError());
            signal?.addEventListener('abort', () => reject(new AbortError()));
          });
          return { content: '', usage: undefined };
        },
      );

      const { params } = submitParams();
      await runner.submit(params);

      const result = await runner.abort('telegram', 'chat1');
      expect(result).toBe(true);

      await new Promise((r) => setTimeout(r, 50));

      const tasks = await taskStore.listTasks('telegram', 'chat1');
      expect(tasks[0]?.status).toBe('aborted');
    });

    test('clears queued tasks on abort', async () => {
      // Block first task
      (provider.generate as ReturnType<typeof mock>).mockImplementationOnce(
        async ({ signal }: { signal?: AbortSignal }) => {
          await new Promise((_resolve, reject) => {
            if (signal?.aborted) return reject(new AbortError());
            signal?.addEventListener('abort', () => reject(new AbortError()));
          });
          return { content: '', usage: undefined };
        },
      );

      const { params: p1 } = submitParams('first');
      const { params: p2 } = submitParams('second');
      const { params: p3 } = submitParams('third');

      await runner.submit(p1);
      await runner.submit(p2);
      await runner.submit(p3);

      await runner.abort('telegram', 'chat1');
      await new Promise((r) => setTimeout(r, 50));

      // All tasks should be aborted
      const tasks = await taskStore.listTasks('telegram', 'chat1');
      for (const task of tasks) {
        expect(task.status).toBe('aborted');
      }
    });
  });

  describe('session state', () => {
    test('session returns to idle after task completes', async () => {
      const { params } = submitParams();
      await runner.submit(params);
      await new Promise((r) => setTimeout(r, 50));

      const sessionStore = createSessionStore(db);
      const session = await sessionStore.getById(sessionId);
      expect(session?.status).toBe('idle');
    });

    test('messages saved to session history', async () => {
      const { params } = submitParams('hello agent');
      await runner.submit(params);
      await new Promise((r) => setTimeout(r, 50));

      const sessionStore = createSessionStore(db);
      const messages = await sessionStore.listRecentMessages(sessionId, 10);
      // Input + output messages
      expect(messages.length).toBe(2);
      expect(messages[0]?.direction).toBe('in');
      expect(messages[0]?.text).toBe('hello agent');
      expect(messages[1]?.direction).toBe('out');
      expect(messages[1]?.text).toBe('done');
    });
  });
});
