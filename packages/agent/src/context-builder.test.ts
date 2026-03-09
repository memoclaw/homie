import { describe, expect, test } from 'bun:test';
import type { Message } from '@homie/core';
import type { MemoryEntry } from '@homie/persistence';
import { buildMessages } from './context-builder';

function makeMessage(direction: 'in' | 'out', text: string): Message {
  return {
    id: crypto.randomUUID(),
    sessionId: 'test-session',
    direction,
    text,
    createdAt: new Date().toISOString(),
    rawSourceId: null,
    metadata: {},
  };
}

describe('buildMessages', () => {
  test('builds system + user message with no history', () => {
    const messages = buildMessages({
      sessionId: 'test',
      text: 'hello',
      history: [],
    });

    expect(messages.length).toBe(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('Homie');
    expect(messages[1]).toEqual({ role: 'user', content: 'hello' });
  });

  test('includes history as user/assistant messages', () => {
    const history = [
      makeMessage('in', 'first question'),
      makeMessage('out', 'first answer'),
      makeMessage('in', 'second question'),
      makeMessage('out', 'second answer'),
    ];

    const messages = buildMessages({
      sessionId: 'test',
      text: 'third question',
      history,
    });

    // system + 4 history + 1 current
    expect(messages.length).toBe(6);
    expect(messages[1]).toEqual({ role: 'user', content: 'first question' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'first answer' });
    expect(messages[3]).toEqual({ role: 'user', content: 'second question' });
    expect(messages[4]).toEqual({ role: 'assistant', content: 'second answer' });
    expect(messages[5]).toEqual({ role: 'user', content: 'third question' });
  });

  test('skips internal messages', () => {
    const history = [
      makeMessage('in', 'question'),
      { ...makeMessage('out', 'internal note'), direction: 'internal' as const },
      makeMessage('out', 'answer'),
    ];

    const messages = buildMessages({
      sessionId: 'test',
      text: 'next',
      history,
    });

    // system + 2 (in+out, skip internal) + 1 current
    expect(messages.length).toBe(4);
  });

  test('includes memories in system prompt', () => {
    const memories: MemoryEntry[] = [
      {
        id: '1',
        scope: 'global',
        content: 'User prefers TypeScript',
        tags: '',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        sourceSessionId: null,
      },
    ];

    const messages = buildMessages({
      sessionId: 'test',
      text: 'hi',
      history: [],
      memories,
    });

    expect(messages[0]?.content).toContain('User prefers TypeScript');
    expect(messages[0]?.content).toContain('Memories:');
  });
});
