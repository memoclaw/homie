import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createAgent } from '@homie/agent';
import { AbortError, type Message, type ProviderAdapter } from '@homie/core';
import { schema } from '@homie/persistence/src/migrations';
import { createSessionStore } from '@homie/persistence/src/session-store';
import { createTaskStore } from '@homie/persistence/src/task-store';
import { createUsageStore } from '@homie/persistence/src/usage-store';
import { createSessionManager } from '@homie/sessions';
import { type CommandContext, createCommandHandler } from './commands';
import { createTaskRunner } from './task-runner';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  return db;
}

describe('CommandHandler', () => {
  let db: Database;
  let handler: ReturnType<typeof createCommandHandler>;
  let replies: string[];
  let taskStore: ReturnType<typeof createTaskStore>;
  let sessionStore: ReturnType<typeof createSessionStore>;
  let sessionId: string;

  const replyFn = async (text: string) => {
    replies.push(text);
  };

  function ctx(command: string, args = ''): CommandContext {
    return {
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      sessionId,
      command,
      args,
      reply: replyFn,
    };
  }

  /** Helper: create a message and return its ID */
  async function addMessage(text: string): Promise<string> {
    const msg: Message = {
      id: crypto.randomUUID(),
      sessionId,
      direction: 'in',
      text,
      createdAt: new Date().toISOString(),
      rawSourceId: null,
    };
    await sessionStore.appendMessage(msg);
    return msg.id;
  }

  beforeEach(async () => {
    db = createTestDb();
    sessionStore = createSessionStore(db);
    const sessionManager = createSessionManager(sessionStore);
    const usageStore = createUsageStore(db);
    taskStore = createTaskStore(db);

    const session = await sessionManager.resolveSession('telegram', 'chat1', 'user1');
    sessionId = session.id;

    const provider: ProviderAdapter = {
      generate: async () => ({ content: 'ok', usage: undefined }),
    };
    const agent = createAgent(provider, { model: 'test' });
    const runner = createTaskRunner({
      sessionManager,
      agent,
      taskStore,
      usageStore,
    });

    handler = createCommandHandler({
      taskStore,
      taskRunner: runner,
      usageStore,
    });

    replies = [];
  });

  afterEach(() => {
    db.close();
  });

  test('/help returns help text', async () => {
    const handled = await handler.handle(ctx('help'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('Commands');
  });

  test('/list with no tasks', async () => {
    const handled = await handler.handle(ctx('list'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('No tasks yet');
  });

  test('/list shows tasks', async () => {
    const msgId = await addMessage('fix the bug');
    await taskStore.createTask({
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      sessionId,
      messageId: msgId,
    });
    const handled = await handler.handle(ctx('list'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('fix the bug');
  });

  test('/status returns uptime', async () => {
    const handled = await handler.handle(ctx('status'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('Uptime');
  });

  test('/abort with no running task', async () => {
    const handled = await handler.handle(ctx('abort'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('No running task');
  });

  test('/start is aliased to /help', async () => {
    const handled = await handler.handle(ctx('start'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('Commands');
  });

  test('/status shows running task details', async () => {
    const msgId = await addMessage('deploy feature');
    const task = await taskStore.createTask({
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      sessionId,
      messageId: msgId,
    });
    await taskStore.updateTaskStatus(task.id, 'running');

    const handled = await handler.handle(ctx('status'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('Running task');
    expect(replies[0]).toContain('deploy feature');
  });

  test('/status shows queued task count', async () => {
    const t1 = await taskStore.createTask({
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      sessionId,
      messageId: null,
    });
    await taskStore.updateTaskStatus(t1.id, 'running');

    await taskStore.createTask({
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      sessionId,
      messageId: null,
    });
    await taskStore.createTask({
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      sessionId,
      messageId: null,
    });

    const handled = await handler.handle(ctx('status'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('Queued: 2 task(s)');
  });

  test('/list shows status icons', async () => {
    const msgId = await addMessage('completed task');
    const task = await taskStore.createTask({
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      sessionId,
      messageId: msgId,
    });
    await taskStore.updateTaskStatus(task.id, 'done');

    const handled = await handler.handle(ctx('list'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('✅');
    expect(replies[0]).toContain('completed task');
  });

  test('/abort with running task', async () => {
    const blockingProvider: ProviderAdapter = {
      generate: async ({ signal }: { signal?: AbortSignal }) => {
        await new Promise((_resolve, reject) => {
          if (signal?.aborted) return reject(new AbortError());
          signal?.addEventListener('abort', () => reject(new AbortError()));
        });
        return { content: '', usage: undefined };
      },
    };
    const agent = createAgent(blockingProvider, { model: 'test' });
    const abortSessionStore = createSessionStore(db);
    const sessionManager = createSessionManager(abortSessionStore);
    const usageStore = createUsageStore(db);
    const blockingRunner = createTaskRunner({
      sessionManager,
      agent,
      taskStore,
      usageStore,
    });

    const blockingHandler = createCommandHandler({
      taskStore,
      taskRunner: blockingRunner,
      usageStore,
    });

    const session = await sessionManager.resolveSession('telegram', 'chat-abort', 'user1');
    await blockingRunner.submit({
      channel: 'telegram',
      chatId: 'chat-abort',
      userId: 'user1',
      sessionId: session.id,
      text: 'do something',
      rawSourceId: null,
      reply: async () => {},
    });

    const handled = await blockingHandler.handle({
      channel: 'telegram',
      chatId: 'chat-abort',
      userId: 'user1',
      sessionId: session.id,
      command: 'abort',
      args: '',
      reply: replyFn,
    });
    expect(handled).toBe(true);
    expect(replies[0]).toContain('Task aborted');
  });

  test('unknown command returns false', async () => {
    const handled = await handler.handle(ctx('unknown'));
    expect(handled).toBe(false);
  });
});
