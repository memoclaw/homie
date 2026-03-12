import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { type Agent, createAgent } from '@homie/agent';
import { AbortError, type ProviderAdapter } from '@homie/core';
import { schema } from '@homie/persistence/src/migrations';
import { createSessionStore } from '@homie/persistence/src/session-store';
import { createRequestRunner, type RequestRunner } from './request-runner';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  return db;
}

describe('RequestRunner', () => {
  let db: Database;
  let runner: RequestRunner;
  let sessionStore: ReturnType<typeof createSessionStore>;
  let sessionId: string;
  let provider: ProviderAdapter;
  let overrideAgent: Agent;

  beforeEach(async () => {
    db = createTestDb();
    sessionStore = createSessionStore(db);
    const session = await sessionStore.getOrCreateActiveByChat('telegram', 'chat1');
    sessionId = session.id;

    provider = {
      generate: mock(async () => ({
        content: 'done',
      })),
    };
    const agent = createAgent(provider, { model: 'test' });
    overrideAgent = {
      run: mock(async () => ({
        text: 'override done',
      })),
    };

    runner = createRequestRunner({
      sessionStore,
      agent,
      resolveAgent: () => overrideAgent,
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
    test('resolves the active session internally', async () => {
      const freshDb = createTestDb();
      const freshStore = createSessionStore(freshDb);
      const isolatedRunner = createRequestRunner({
        sessionStore: freshStore,
        agent: createAgent(provider, { model: 'test' }),
      });
      const replies: string[] = [];

      await isolatedRunner.submit({
        channel: 'telegram',
        chatId: 'new-chat',
        text: 'hello',
        rawSourceId: null,
        reply: async (text) => {
          replies.push(text);
        },
      });
      await new Promise((r) => setTimeout(r, 50));

      const session = await freshStore.getOrCreateActiveByChat('telegram', 'new-chat');
      const messages = await freshStore.listRecentMessages(session.id, 10);
      expect(messages).toHaveLength(2);
      expect(replies).toContain('done');
      freshDb.close();
    });

    test('executes request and replies with result', async () => {
      const { params, replies } = submitParams('hello');
      await runner.submit(params);
      // Wait for async execution
      await new Promise((r) => setTimeout(r, 50));

      expect(provider.generate).toHaveBeenCalled();
      expect(replies).toContain('done');
    });

    test('uses resolved agent override when agent selection is provided', async () => {
      const { params, replies } = submitParams('hello');
      await runner.submit({
        ...params,
        agentType: 'claude-code',
        agentModel: 'opus 4.6',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(overrideAgent.run).toHaveBeenCalled();
      expect(provider.generate).not.toHaveBeenCalled();
      expect(replies).toContain('override done');
    });

    test('stores conversation messages in DB', async () => {
      const { params } = submitParams('build feature');
      await runner.submit(params);
      await new Promise((r) => setTimeout(r, 50));

      const messages = await sessionStore.listRecentMessages(sessionId, 10);
      expect(messages).toHaveLength(2);
      expect(messages[0]?.text).toBe('build feature');
      expect(messages[1]?.text).toBe('done');
    });

    test('replies with generic failure on provider error', async () => {
      (provider.generate as ReturnType<typeof mock>).mockImplementation(async () => {
        throw new Error('boom');
      });

      const { params, replies } = submitParams();
      await runner.submit(params);
      await new Promise((r) => setTimeout(r, 50));

      expect(replies).toContain('Something went wrong. Please try again.');
    });
  });

  describe('interrupts', () => {
    test('new message interrupts active request and starts immediately', async () => {
      let resolveFirst: (() => void) | undefined;
      const firstBlocked = new Promise<void>((r) => {
        resolveFirst = r;
      });
      (provider.generate as ReturnType<typeof mock>).mockImplementationOnce(
        async ({ signal }: { signal?: AbortSignal }) => {
          await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) {
              reject(new AbortError());
              return;
            }
            signal?.addEventListener('abort', () => reject(new AbortError()), { once: true });
            firstBlocked.then(resolve);
          });
          if (signal?.aborted) {
            throw new AbortError();
          }
          return { content: 'first done' };
        },
      );

      const { params: p1, replies: r1 } = submitParams('first');
      const { params: p2, replies: r2 } = submitParams('second');

      const firstSubmit = runner.submit(p1);
      await new Promise((r) => setTimeout(r, 10));
      await runner.submit(p2);
      resolveFirst?.();
      await firstSubmit;
      await new Promise((r) => setTimeout(r, 100));

      expect(r1).not.toContain('first done');
      expect(r2).toContain('done');
      const messages = await sessionStore.listRecentMessages(sessionId, 10);
      expect(messages).toHaveLength(3);
      expect(messages[0]?.text).toBe('first');
      expect(messages[1]?.text).toBe('second');
      expect(messages[2]?.text).toBe('done');
    });
  });

  describe('abort', () => {
    test('returns false if no active request', async () => {
      const result = await runner.abort('telegram', 'chat1');
      expect(result).toBe(false);
    });

    test('aborts active request', async () => {
      (provider.generate as ReturnType<typeof mock>).mockImplementationOnce(
        async ({ signal }: { signal?: AbortSignal }) => {
          await new Promise((_resolve, reject) => {
            if (signal?.aborted) return reject(new AbortError());
            signal?.addEventListener('abort', () => reject(new AbortError()));
          });
          return { content: '' };
        },
      );
      const { params } = submitParams();
      const firstSubmit = runner.submit(params);
      await new Promise((r) => setTimeout(r, 10));

      const result = await runner.abort('telegram', 'chat1');
      expect(result).toBe(true);
      await firstSubmit;
    });
  });

  describe('resetSession', () => {
    test('rotates the active session and clears active request state', async () => {
      (provider.generate as ReturnType<typeof mock>).mockImplementationOnce(
        async ({ signal }: { signal?: AbortSignal }) => {
          await new Promise((_resolve, reject) => {
            if (signal?.aborted) return reject(new AbortError());
            signal?.addEventListener('abort', () => reject(new AbortError()));
          });
          return { content: '' };
        },
      );

      const original = await sessionStore.getOrCreateActiveByChat('telegram', 'chat1');
      const { params } = submitParams();
      const firstSubmit = runner.submit(params);
      await new Promise((r) => setTimeout(r, 10));

      await runner.resetSession('telegram', 'chat1');

      const next = await sessionStore.getOrCreateActiveByChat('telegram', 'chat1');
      expect(next.id).not.toBe(original.id);
      expect(runner.getStatus('telegram', 'chat1')).toBeNull();
      await firstSubmit;
    });
  });

  describe('session state', () => {
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
