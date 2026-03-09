import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createAgent } from '@homie/agent';
import type { ProviderAdapter } from '@homie/core';
import { schema } from '@homie/persistence/src/migrations';
import { createSessionStore } from '@homie/persistence/src/session-store';
import { createUsageStore } from '@homie/persistence/src/usage-store';
import { createSessionManager } from '@homie/sessions';
import { createAgentRunner } from './agent-runner';
import { createCommandHandler } from './commands';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  return db;
}

describe('CommandHandler', () => {
  let db: Database;
  let handler: ReturnType<typeof createCommandHandler>;
  let sessionManager: ReturnType<typeof createSessionManager>;
  let replies: string[];

  const replyFn = async (text: string) => {
    replies.push(text);
  };

  beforeEach(() => {
    db = createTestDb();
    const sessionStore = createSessionStore(db);
    sessionManager = createSessionManager(sessionStore);
    const usageStore = createUsageStore(db);

    const provider: ProviderAdapter = {
      generate: async () => ({ content: 'ok', usage: undefined }),
    };
    const agent = createAgent(provider, { model: 'test' });
    const runner = createAgentRunner({
      sessionManager,
      agent,
      usageStore,
    });

    handler = createCommandHandler({
      sessionManager,
      agentRunner: runner,
      usageStore,
    });

    replies = [];
  });

  afterEach(() => {
    db.close();
  });

  describe('pre-session commands', () => {
    test('/new creates named session', async () => {
      const handled = await handler.handlePreSession(
        'telegram',
        'chat1',
        'user1',
        'new',
        'my-project',
        replyFn,
      );
      expect(handled).toBe(true);
      expect(replies[0]).toContain('my-project');
      expect(replies[0]).toContain('created');
    });

    test('/new with no name generates one', async () => {
      const handled = await handler.handlePreSession(
        'telegram',
        'chat1',
        'user1',
        'new',
        '',
        replyFn,
      );
      expect(handled).toBe(true);
      expect(replies[0]).toContain('created');
    });

    test('/use requires args', async () => {
      const handled = await handler.handlePreSession(
        'telegram',
        'chat1',
        'user1',
        'use',
        '',
        replyFn,
      );
      expect(handled).toBe(true);
      expect(replies[0]).toContain('Usage');
    });

    test('/use switches to named session', async () => {
      await sessionManager.createNamedSession('telegram', 'chat1', 'target');
      const handled = await handler.handlePreSession(
        'telegram',
        'chat1',
        'user1',
        'use',
        'target',
        replyFn,
      );
      expect(handled).toBe(true);
      expect(replies[0]).toContain('Switched');
      expect(replies[0]).toContain('target');
    });

    test('/sessions lists sessions', async () => {
      await sessionManager.resolveSession('telegram', 'chat1');
      const handled = await handler.handlePreSession(
        'telegram',
        'chat1',
        'user1',
        'sessions',
        '',
        replyFn,
      );
      expect(handled).toBe(true);
      expect(replies[0]).toContain('Sessions:');
    });

    test('unknown command returns false', async () => {
      const handled = await handler.handlePreSession(
        'telegram',
        'chat1',
        'user1',
        'unknown',
        '',
        replyFn,
      );
      expect(handled).toBe(false);
    });
  });

  describe('post-session commands', () => {
    test('/help returns help text', async () => {
      const session = await sessionManager.resolveSession('telegram', 'chat1');
      const handled = await handler.handlePostSession(
        session.id,
        'telegram',
        'chat1',
        'help',
        '',
        'user1',
        replyFn,
      );
      expect(handled).toBe(true);
      expect(replies[0]).toContain('Available commands');
    });

    test('/status returns status info', async () => {
      const session = await sessionManager.resolveSession('telegram', 'chat1');
      const handled = await handler.handlePostSession(
        session.id,
        'telegram',
        'chat1',
        'status',
        '',
        'user1',
        replyFn,
      );
      expect(handled).toBe(true);
      expect(replies[0]).toContain('Session:');
    });

    test('unknown command returns false', async () => {
      const session = await sessionManager.resolveSession('telegram', 'chat1');
      const handled = await handler.handlePostSession(
        session.id,
        'telegram',
        'chat1',
        'nope',
        '',
        'user1',
        replyFn,
      );
      expect(handled).toBe(false);
    });
  });
});
