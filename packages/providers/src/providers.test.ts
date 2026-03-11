import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexProvider } from './codex';
import { createCodexUsageProvider } from './codex-usage';
import { createProviderRuntime } from './index';

interface FakeSpawnResult {
  stdoutLines?: string[];
  stderrText?: string;
  exitCode?: number;
}

const originalSpawn = Bun.spawn;
const originalHome = process.env.HOME;

afterEach(() => {
  Bun.spawn = originalSpawn;
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
});

describe('createProviderRuntime', () => {
  test('creates Claude runtime with account usage', () => {
    const runtime = createProviderRuntime({
      kind: 'claude-code',
      model: 'opus',
      extraArgs: ['--verbose'],
    });

    expect(runtime.kind).toBe('claude-code');
    expect(runtime.name).toBe('Claude Code');
    expect(runtime.accountUsage).toBeDefined();
  });

  test('creates Codex runtime with account usage', () => {
    const runtime = createProviderRuntime({
      kind: 'codex',
      model: 'o3',
      extraArgs: ['--skip-git-repo-check'],
    });

    expect(runtime.kind).toBe('codex');
    expect(runtime.name).toBe('Codex CLI');
    expect(runtime.accountUsage).toBeDefined();
  });
});

describe('createCodexProvider', () => {
  test('parses final message and usage from JSONL output', async () => {
    Bun.spawn = stubSpawn([
      {
        stdoutLines: [
          'Reading prompt from stdin...',
          '{"type":"thread.started","thread_id":"thread-1"}',
          '{"type":"turn.started"}',
          '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}',
          '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":3,"output_tokens":2}}',
        ],
        exitCode: 0,
      },
    ]);

    const provider = createCodexProvider({ model: 'o3', extraArgs: [] });
    const result = await provider.generate({
      messages: [{ role: 'user', content: 'Reply with ok' }],
      model: 'o3',
    });

    expect(result.content).toBe('ok');
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheCreateTokens: 0,
      costUsd: null,
    });
  });

  test('retries with full history when resume fails', async () => {
    const calls: string[][] = [];

    Bun.spawn = stubSpawn(
      [
        {
          stderrText: 'resume failed',
          exitCode: 1,
        },
        {
          stdoutLines: [
            '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"done"}}',
            '{"type":"turn.completed","usage":{"input_tokens":20,"cached_input_tokens":4,"output_tokens":5}}',
          ],
          exitCode: 0,
        },
      ],
      calls,
    );

    const provider = createCodexProvider({ model: 'o3', extraArgs: ['--skip-git-repo-check'] });
    const result = await provider.generate({
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'assistant', content: 'Previous answer' },
        { role: 'user', content: 'Latest question' },
      ],
      model: 'o3',
      sessionId: 'session-123',
      hasHistory: true,
    });

    expect(result.content).toBe('done');
    expect(result.resumed).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([
      'codex',
      'exec',
      'resume',
      'session-123',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--model',
      'o3',
      '--skip-git-repo-check',
      'Latest question',
    ]);
    expect(calls[1]?.slice(0, 7)).toEqual([
      'codex',
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--model',
      'o3',
      '--skip-git-repo-check',
    ]);
    expect(calls[1]?.at(-1)).toContain('[System]\nBe concise.');
    expect(calls[1]?.at(-1)).toContain('[Assistant]\nPrevious answer');
    expect(calls[1]?.at(-1)).toContain('[User]\nLatest question');
  });
});

describe('createCodexUsageProvider', () => {
  test('reads current 5h and weekly limits from the latest Codex session snapshot', async () => {
    const home = mkdtempSync(join(tmpdir(), 'homie-codex-usage-'));
    process.env.HOME = home;

    try {
      const olderDir = join(home, '.codex', 'sessions', '2026', '03', '10');
      const latestDir = join(home, '.codex', 'sessions', '2026', '03', '11');
      mkdirSync(olderDir, { recursive: true });
      mkdirSync(latestDir, { recursive: true });

      writeFileSync(
        join(olderDir, 'older.jsonl'),
        `${JSON.stringify({
          payload: {
            type: 'token_count',
            rate_limits: {
              primary: { used_percent: 75, resets_at: 1773160000 },
              secondary: { used_percent: 10, resets_at: 1773740000 },
            },
          },
        })}\n`,
      );

      const latestPath = join(latestDir, 'latest.jsonl');
      writeFileSync(
        latestPath,
        [
          JSON.stringify({ payload: { type: 'agent_message', message: 'ignore me' } }),
          JSON.stringify({
            payload: {
              type: 'token_count',
              rate_limits: {
                primary: { used_percent: 8, resets_at: 1773246901 },
                secondary: { used_percent: 2, resets_at: 1773833761 },
              },
            },
          }),
        ].join('\n'),
      );

      const provider = createCodexUsageProvider();
      const usage = await provider.getAccountUsage();

      expect(usage).toEqual([
        {
          label: 'Current 5h limit',
          percentUsed: 8,
          resetsAt: '2026-03-11T16:35:01.000Z',
        },
        {
          label: 'Current week',
          percentUsed: 2,
          resetsAt: '2026-03-18T11:36:01.000Z',
        },
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

function stubSpawn(results: FakeSpawnResult[], calls?: string[][]): typeof Bun.spawn {
  let index = 0;

  return ((cmd: string[]) => {
    calls?.push(cmd);
    const result = results[index] ?? { exitCode: 0 };
    index += 1;

    return {
      stdout: streamFromLines(result.stdoutLines ?? []),
      stderr: streamFromText(result.stderrText ?? ''),
      exited: Promise.resolve(result.exitCode ?? 0),
      kill() {},
    } as ReturnType<typeof Bun.spawn>;
  }) as typeof Bun.spawn;
}

function streamFromLines(lines: string[]): ReadableStream<Uint8Array> {
  return streamFromText(lines.length > 0 ? `${lines.join('\n')}\n` : '');
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (text) {
        controller.enqueue(encoder.encode(text));
      }
      controller.close();
    },
  });
}
