import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createAgent } from '@homie/agent';
import type { ChatMessageEvent, CommandEvent, ProviderAdapter } from '@homie/core';
import { schema } from '@homie/persistence/src/migrations';
import { createSessionStore } from '@homie/persistence/src/session-store';
import { createGateway } from './gateway';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  return db;
}

function createMockProvider(response = 'test response'): ProviderAdapter {
  return {
    generate: mock(async () => ({ content: response })),
  };
}

describe('Gateway', () => {
  let db: Database;
  let gateway: ReturnType<typeof createGateway>;
  let provider: ProviderAdapter;
  let overrideProvider: ProviderAdapter;
  let replies: string[];

  beforeEach(() => {
    db = createTestDb();
    const sessionStore = createSessionStore(db);
    provider = createMockProvider();
    overrideProvider = createMockProvider('override response');
    const agent = createAgent(provider, { model: 'test' });
    const overrideAgent = createAgent(overrideProvider, { model: 'opus 4.6' });

    gateway = createGateway({
      sessionStore,
      agent,
      resolveAgent: () => overrideAgent,
    });

    replies = [];
  });

  afterEach(() => {
    db.close();
  });

  const replyFn = async (text: string) => {
    replies.push(text);
  };

  test('routes chat message to agent', async () => {
    const event: ChatMessageEvent = {
      type: 'chat',
      channel: 'telegram',
      chatId: 'chat1',
      text: 'hello',
      rawSourceId: '1',
    };

    await gateway.handleEvent(event, replyFn);
    await new Promise((r) => setTimeout(r, 100));

    expect(provider.generate).toHaveBeenCalled();
    expect(replies).toContain('test response');
  });

  test('uses override agent when chat event includes agent model selection', async () => {
    const event: ChatMessageEvent = {
      type: 'chat',
      channel: 'telegram',
      chatId: 'chat1',
      text: 'hello',
      rawSourceId: '1',
      agentModel: 'claude opus 4.6',
    };

    await gateway.handleEvent(event, replyFn);
    await new Promise((r) => setTimeout(r, 100));

    expect(overrideProvider.generate).toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
    expect(replies).toContain('override response');
  });

  test('handles /help command', async () => {
    const event: CommandEvent = {
      type: 'command',
      channel: 'telegram',
      chatId: 'chat1',
      command: 'help',
      args: '',
      rawSourceId: '1',
    };

    await gateway.handleEvent(event, replyFn);
    expect(replies[0]).toContain('Commands');
  });

  test('handled commands do not create a session', async () => {
    const event: CommandEvent = {
      type: 'command',
      channel: 'telegram',
      chatId: 'chat1',
      command: 'help',
      args: '',
      rawSourceId: '1',
    };

    await gateway.handleEvent(event, replyFn);
    const rows = db
      .query('SELECT COUNT(*) as count FROM sessions WHERE channel = ? AND chat_id = ?')
      .get('telegram', 'chat1') as { count: number };

    expect(rows.count).toBe(0);
  });

  test('routes /status without calling agent', async () => {
    const event: CommandEvent = {
      type: 'command',
      channel: 'telegram',
      chatId: 'chat1',
      command: 'status',
      args: '',
      rawSourceId: '1',
    };

    await gateway.handleEvent(event, replyFn);
    expect(replies[0]).toContain('No active request.');
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
