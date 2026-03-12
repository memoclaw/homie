import { afterEach, describe, expect, test } from 'bun:test';
import { createCodexProvider } from './codex';
import { detectProvider } from './index';

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

describe('detectProvider', () => {
  test('returns claude-code when claude CLI is available', async () => {
    Bun.spawn = stubSpawn([
      { stdoutLines: ['claude 1.0.0'], exitCode: 0 },
      { stdoutLines: ['pong'], exitCode: 0 },
    ]);

    const runtime = await detectProvider({ model: 'opus' });
    expect(runtime).not.toBeNull();
    expect(runtime?.kind).toBe('claude-code');
    expect(runtime?.name).toBe('Claude Code');
  });

  test('falls back to codex when claude CLI is unavailable', async () => {
    const fakeProc = (stdout: string, exitCode: number) =>
      ({
        stdout: streamFromText(stdout),
        stderr: streamFromText(exitCode ? 'command not found' : ''),
        exited: Promise.resolve(exitCode),
        kill() {},
      }) as ReturnType<typeof Bun.spawn>;

    Bun.spawn = ((cmd: string[]) => {
      if (cmd[0] === 'claude') return fakeProc('', 1);
      return fakeProc('codex 1.0.0\n', 0);
    }) as typeof Bun.spawn;

    const runtime = await detectProvider({ model: 'o3' });
    expect(runtime).not.toBeNull();
    expect(runtime?.kind).toBe('codex');
    expect(runtime?.name).toBe('Codex CLI');
  });

  test('returns null when no provider is available', async () => {
    Bun.spawn = stubSpawn([
      { stderrText: 'not found', exitCode: 1 },
      { stderrText: 'not found', exitCode: 1 },
      { stderrText: 'not found', exitCode: 1 },
      { stderrText: 'not found', exitCode: 1 },
    ]);

    const runtime = await detectProvider({ model: '' });
    expect(runtime).toBeNull();
  });
});

describe('createCodexProvider', () => {
  test('parses final message from JSONL output', async () => {
    Bun.spawn = stubSpawn([
      {
        stdoutLines: [
          'Reading prompt from stdin...',
          '{"type":"thread.started","thread_id":"thread-1"}',
          '{"type":"turn.started"}',
          '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}',
          '{"type":"turn.completed"}',
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
            '{"type":"turn.completed"}',
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
