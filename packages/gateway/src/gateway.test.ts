import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createAgent } from '@homie/agent';
import type { ChatMessageEvent, CommandEvent, ProviderAdapter } from '@homie/core';
import { schema } from '@homie/persistence/src/migrations';
import { createSessionStore } from '@homie/persistence/src/session-store';
import { createTaskStore } from '@homie/persistence/src/task-store';
import { createUsageStore } from '@homie/persistence/src/usage-store';
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
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        costUsd: 0.001,
      },
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
    const usageStore = createUsageStore(db);
    const taskStore = createTaskStore(db);
    provider = createMockProvider();
    const agent = createAgent(provider, { model: 'test' });

    gateway = createGateway({
      sessionStore,
      agent,
      taskStore,
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

  test('routes chat message to agent via task runner', async () => {
    const event: ChatMessageEvent = {
      type: 'chat',
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      text: 'hello',
      rawSourceId: '1',
    };

    await gateway.handleEvent(event, replyFn);

    // Task runner executes async, wait a tick
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
    expect(replies[0]).toContain('Commands');
  });

  test('handles /list command', async () => {
    const event: CommandEvent = {
      type: 'command',
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      command: 'list',
      args: '',
      rawSourceId: '1',
    };

    await gateway.handleEvent(event, replyFn);
    expect(replies.length).toBe(1);
    expect(replies[0]).toContain('No tasks yet');
  });

  test('unknown command is treated as a task', async () => {
    const event: CommandEvent = {
      type: 'command',
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      command: 'whatever',
      args: 'do stuff',
      rawSourceId: '1',
    };

    await gateway.handleEvent(event, replyFn);
    await new Promise((r) => setTimeout(r, 100));

    expect(provider.generate).toHaveBeenCalled();
  });

  test('passes attachments through to agent', async () => {
    const event: ChatMessageEvent = {
      type: 'chat',
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      text: 'analyze this file',
      rawSourceId: '1',
      attachments: [{ filePath: '/tmp/test.png', mimeType: 'image/png', fileName: 'test.png' }],
    };

    await gateway.handleEvent(event, replyFn);
    await new Promise((r) => setTimeout(r, 100));

    expect(provider.generate).toHaveBeenCalled();
    // The generate call should include attachment references in the prompt
    const call = (provider.generate as ReturnType<typeof mock>).mock.calls[0];
    const messages = call?.[0]?.messages;
    const lastMsg = messages?.[messages.length - 1];
    expect(lastMsg?.content).toContain('test.png');
  });

  test('routes /status command without calling agent', async () => {
    const event: CommandEvent = {
      type: 'command',
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      command: 'status',
      args: '',
      rawSourceId: '1',
    };

    await gateway.handleEvent(event, replyFn);
    expect(replies.length).toBe(1);
    expect(replies[0]).toContain('No usage data yet.');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  test('routes /abort command without calling agent', async () => {
    const event: CommandEvent = {
      type: 'command',
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      command: 'abort',
      args: '',
      rawSourceId: '1',
    };

    await gateway.handleEvent(event, replyFn);
    expect(replies.length).toBe(1);
    expect(replies[0]).toContain('No running task');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  test('unknown command text is passed as task text', async () => {
    const event: CommandEvent = {
      type: 'command',
      channel: 'telegram',
      chatId: 'chat1',
      userId: 'user1',
      command: 'whatever',
      args: 'do stuff',
      rawSourceId: '1',
    };

    await gateway.handleEvent(event, replyFn);
    await new Promise((r) => setTimeout(r, 100));

    const call = (provider.generate as ReturnType<typeof mock>).mock.calls[0];
    const messages = call?.[0]?.messages;
    const lastMsg = messages?.[messages.length - 1];
    expect(lastMsg?.content).toContain('/whatever do stuff');
  });

  test('handles errors gracefully', async () => {
    const badProvider = createMockProvider();
    (badProvider.generate as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error('provider exploded');
    });

    const agent = createAgent(badProvider, { model: 'test' });
    const sessionStore = createSessionStore(db);
    const taskStore = createTaskStore(db);
    const errorGateway = createGateway({
      sessionStore,
      agent,
      taskStore,
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
