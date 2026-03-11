import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createAgent } from '@homie/agent';
import { AbortError, type AccountUsageProvider, type ProviderAdapter } from '@homie/core';
import { schema } from '@homie/persistence/src/migrations';
import { createSessionStore } from '@homie/persistence/src/session-store';
import { createTaskStore } from '@homie/persistence/src/task-store';
import { createUsageStore } from '@homie/persistence/src/usage-store';
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
    const msg = await sessionStore.addMessage(sessionId, 'in', text);
    return msg.id;
  }

  beforeEach(async () => {
    db = createTestDb();
    sessionStore = createSessionStore(db);
    const usageStore = createUsageStore(db);
    taskStore = createTaskStore(db);

    const session = await sessionStore.getOrCreateByChat('telegram', 'chat1', 'user1');
    sessionId = session.id;

    const provider: ProviderAdapter = {
      generate: async () => ({ content: 'ok', usage: undefined }),
    };
    const agent = createAgent(provider, { model: 'test' });
    const runner = createTaskRunner({
      sessionStore,
      agent,
      taskStore,
      usageStore,
    });

    const accountUsage: AccountUsageProvider = {
      async getAccountUsage() {
        return [
          { label: 'Current session', percentUsed: 0, resetsAt: '2026-03-12T12:00:00Z' },
          { label: 'Current week', percentUsed: 0, resetsAt: '2026-03-18T10:00:00Z' },
        ];
      },
    };

    handler = createCommandHandler({
      taskStore,
      taskRunner: runner,
      usageStore,
      accountUsage,
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

  test('/status returns usage info', async () => {
    const handled = await handler.handle(ctx('status'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('Current session 0% used Resets');
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

  test('/status shows token costs when usage exists', async () => {
    const usageStore = createUsageStore(db);
    usageStore.record(sessionId, {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      costUsd: 0.05,
    });

    const handled = await handler.handle(ctx('status'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('Token costs: $0.05');
    expect(replies[0]).toContain('Current week');
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
    const usageStore = createUsageStore(db);
    const blockingRunner = createTaskRunner({
      sessionStore: abortSessionStore,
      agent,
      taskStore,
      usageStore,
    });

    const blockingHandler = createCommandHandler({
      taskStore,
      taskRunner: blockingRunner,
      usageStore,
    });

    const session = await abortSessionStore.getOrCreateByChat('telegram', 'chat-abort', 'user1');
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
