import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ChatMessageEvent, CommandEvent, ProviderAdapter } from '@homie/core';
import { schema } from '@homie/persistence/src/migrations';
import { createSessionStore } from '@homie/persistence/src/session-store';
import { createUsageStore } from '@homie/persistence/src/usage-store';
import { createAgent } from '@homie/agent';
import { createSessionManager } from '@homie/sessions';
import { createGateway } from './gateway';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  return db;
}

function createMockProvider(response = 'test response'): ProviderAdapter {
  return {
    generate: mock(async () => ({
      content: response,
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0.001 },
    })),
  };
}

describe('Gateway', () => {
  let db: Database;
  let gateway: ReturnType<typeof createGateway>;
  let provider: ProviderAdapter;
  let replies: string[];

  beforeEach(() => {
    db = createTestDb();
    const sessionStore = createSessionStore(db);
    const sessionManager = createSessionManager(sessionStore);
    const usageStore = createUsageStore(db);
    provider = createMockProvider();
    const agent = createAgent(provider, { model: 'test' });

    gateway = createGateway({
      sessionManager,
      agent,
      maxHistoryMessages: 20,
      usageStore,
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
      userId: 'user1',
      text: 'hello',
      rawSourceId: '1',
    };

    await gateway.handleEvent(event, replyFn);

    // Agent runs async (fire-and-forget), wait a tick
    await new Promise((r) => setTimeout(r, 100));

    expect(provider.generate).toHaveBeenCalled();
    expect(replies).toContain('test response');
  });

  test('handles /help command', async () => {
    const event: CommandEvent = {
      type: 'command',
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      command: 'help',
      args: '',
      rawSourceId: '1',
    };

    await gateway.handleEvent(event, replyFn);
    expect(replies.length).toBe(1);
    expect(replies[0]).toContain('Available commands');
  });

  test('handles /new command', async () => {
    const event: CommandEvent = {
      type: 'command',
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      command: 'new',
      args: 'my-project',
      rawSourceId: '1',
    };

    await gateway.handleEvent(event, replyFn);
    expect(replies.length).toBe(1);
    expect(replies[0]).toContain('my-project');
    expect(replies[0]).toContain('created');
  });

  test('handles /sessions command', async () => {
    // First create a session
    const chatEvent: ChatMessageEvent = {
      type: 'chat',
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      text: 'hello',
      rawSourceId: '1',
    };
    await gateway.handleEvent(chatEvent, replyFn);
    await new Promise((r) => setTimeout(r, 100));

    replies = [];

    const event: CommandEvent = {
      type: 'command',
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      command: 'sessions',
      args: '',
      rawSourceId: '2',
    };

    await gateway.handleEvent(event, replyFn);
    expect(replies.length).toBe(1);
    expect(replies[0]).toContain('Sessions:');
  });

  test('handles errors gracefully', async () => {
    const badProvider = createMockProvider();
    (badProvider.generate as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error('provider exploded');
    });

    const agent = createAgent(badProvider, { model: 'test' });
    const sessionStore = createSessionStore(db);
    const sessionManager = createSessionManager(sessionStore);
    const errorGateway = createGateway({
      sessionManager,
      agent,
      maxHistoryMessages: 20,
    });

    const errorReplies: string[] = [];
    const event: ChatMessageEvent = {
      type: 'chat',
      channel: 'telegram',
      chatId: 'chat-err',
      userId: 'user1',
      text: 'hello',
      rawSourceId: '1',
    };

    await errorGateway.handleEvent(event, async (text) => {
      errorReplies.push(text);
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(errorReplies).toContain('Something went wrong. Please try again.');
  });
});
