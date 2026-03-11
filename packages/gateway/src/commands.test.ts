import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createAgent } from '@homie/agent';
import { AbortError, type ProviderAdapter } from '@homie/core';
import { schema } from '@homie/persistence/src/migrations';
import { createSessionStore } from '@homie/persistence/src/session-store';
import { type CommandContext, createCommandHandler } from './commands';
import { createRequestRunner } from './request-runner';

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
  let sessionStore: ReturnType<typeof createSessionStore>;
  let sessionId: string;

  const replyFn = async (text: string) => {
    replies.push(text);
  };

  function ctx(command: string, args = ''): CommandContext {
    return {
      channel: 'telegram',
      chatId: 'chat1',
      command,
      args,
      reply: replyFn,
    };
  }

  beforeEach(async () => {
    db = createTestDb();
    sessionStore = createSessionStore(db);
    const session = await sessionStore.getOrCreateActiveByChat('telegram', 'chat1');
    sessionId = session.id;

    const provider: ProviderAdapter = {
      generate: async () => ({ content: 'ok' }),
    };
    const agent = createAgent(provider, { model: 'test' });
    const runner = createRequestRunner({ sessionStore, agent });

    handler = createCommandHandler({
      requestRunner: runner,
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

  test('/status reports no active request when idle', async () => {
    const handled = await handler.handle(ctx('status'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('No active request.');
  });

  test('/abort with no active request', async () => {
    const handled = await handler.handle(ctx('abort'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('No active request');
  });

  test('/clear starts a new session', async () => {
    const before = sessionId;
    const handled = await handler.handle(ctx('clear'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('Started a new session.');

    const current = await sessionStore.getOrCreateActiveByChat('telegram', 'chat1');
    expect(current.id).not.toBe(before);
  });

  test('/abort interrupts active request', async () => {
    const blockingProvider: ProviderAdapter = {
      generate: async ({ signal }: { signal?: AbortSignal }) => {
        await new Promise((_resolve, reject) => {
          if (signal?.aborted) return reject(new AbortError());
          signal?.addEventListener('abort', () => reject(new AbortError()));
        });
        return { content: '' };
      },
    };
    const agent = createAgent(blockingProvider, { model: 'test' });
    const runner = createRequestRunner({ sessionStore, agent });
    const activeHandler = createCommandHandler({ requestRunner: runner });

    const submitPromise = runner.submit({
      channel: 'telegram',
      chatId: 'chat1',
      text: 'do something',
      rawSourceId: null,
      reply: async () => {},
    });
    await new Promise((r) => setTimeout(r, 10));

    const handled = await activeHandler.handle(ctx('abort'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('Request interrupted');
    await submitPromise;
  });

  test('unknown command returns false', async () => {
    const handled = await handler.handle(ctx('unknown'));
    expect(handled).toBe(false);
  });

  test('/clear interrupts active request and rotates the session', async () => {
    const blockingProvider: ProviderAdapter = {
      generate: async ({ signal }: { signal?: AbortSignal }) => {
        await new Promise((_resolve, reject) => {
          if (signal?.aborted) return reject(new AbortError());
          signal?.addEventListener('abort', () => reject(new AbortError()));
        });
        return { content: '' };
      },
    };
    const agent = createAgent(blockingProvider, { model: 'test' });
    const runner = createRequestRunner({ sessionStore, agent });
    const activeHandler = createCommandHandler({ requestRunner: runner });

    const before = await sessionStore.getOrCreateActiveByChat('telegram', 'chat1');
    const submitPromise = runner.submit({
      channel: 'telegram',
      chatId: 'chat1',
      text: 'do something',
      rawSourceId: null,
      reply: async () => {},
    });
    await new Promise((r) => setTimeout(r, 10));

    const handled = await activeHandler.handle(ctx('clear'));
    expect(handled).toBe(true);
    expect(replies[0]).toContain('Started a new session.');

    const after = await sessionStore.getOrCreateActiveByChat('telegram', 'chat1');
    expect(after.id).not.toBe(before.id);
    await submitPromise;
  });
});
