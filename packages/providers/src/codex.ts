import type {
  ProgressCallback,
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
  UsageStats,
} from '@homie/core';
import { AbortError, ProviderError } from '@homie/core';
import { createLogger } from '@homie/observability';
import type { CliProviderStatus } from './cli-status';
import { checkCliStatus } from './cli-status';
import { extractLastUserMessage, flattenMessages } from './messages';
import { asNumber } from './parse';

const log = createLogger('provider:codex');

export interface CodexConfig {
  model: string;
  extraArgs?: string[];
}

export type { CliProviderStatus } from './cli-status';

export function createCodexProvider(config: CodexConfig): ProviderAdapter {
  const cmd = 'codex';
  const extraArgs = config.extraArgs ?? [];

  return {
    async generate(input: ProviderRequest): Promise<ProviderResponse> {
      const prompt =
        input.sessionId && input.hasHistory
          ? extractLastUserMessage(input.messages)
          : flattenMessages(input.messages);

      const args = buildArgs({
        prompt,
        model: config.model,
        extra: extraArgs,
        sessionId: input.sessionId,
        hasHistory: input.hasHistory ?? false,
      });

      let result = await spawnJson(cmd, args, input.onProgress, input.signal);
      let resumed = true;

      const tryResume = Boolean(input.sessionId && input.hasHistory);
      if (result.content === null && tryResume) {
        log.info('Resume failed, retrying with full history', {
          sessionId: input.sessionId,
          exitCode: result.exitCode,
        });
        resumed = false;
        const retryArgs = buildArgs({
          prompt: flattenMessages(input.messages),
          model: config.model,
          extra: extraArgs,
          sessionId: input.sessionId,
          hasHistory: false,
        });
        result = await spawnJson(cmd, retryArgs, input.onProgress, input.signal);
      }

      if (result.content === null) {
        if (input.signal?.aborted) {
          throw new AbortError();
        }
        log.error('Codex failed', {
          exitCode: result.exitCode,
          stderr: result.stderr.slice(0, 500),
        });
        throw new ProviderError(
          `Codex exited with code ${result.exitCode}: ${result.stderr.slice(0, 300)}`,
        );
      }

      return {
        content: result.content,
        usage: result.usage,
        resumed: tryResume ? resumed : undefined,
      };
    },
  };
}

export async function checkCodexCli(): Promise<CliProviderStatus> {
  return checkCliStatus({
    command: 'codex',
    authArgs: ['login', 'status'],
    notFoundMessage: 'codex CLI not found',
  });
}

interface BuildArgsInput {
  prompt: string;
  model: string;
  extra: string[];
  sessionId: string | undefined;
  hasHistory: boolean;
}

function buildArgs(input: BuildArgsInput): string[] {
  const args = ['exec'];

  if (input.sessionId && input.hasHistory) {
    args.push('resume', input.sessionId);
  }

  args.push('--json', '--dangerously-bypass-approvals-and-sandbox');

  if (input.model) {
    args.push('--model', input.model);
  }

  args.push(...input.extra, input.prompt);
  return args;
}

interface SpawnResult {
  exitCode: number;
  stderr: string;
  content: string | null;
  usage?: UsageStats;
}

async function spawnJson(
  cmd: string,
  args: string[],
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<SpawnResult> {
  const prompt = args.at(-1) ?? '';
  log.debug('Spawning Codex', { promptLength: prompt.length });

  const proc = Bun.spawn([cmd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const onAbort = () => proc.kill();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    let finalResult: string | null = null;
    let usage: UsageStats | undefined;
    const stderrPromise = new Response(proc.stderr).text();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line) as Record<string, unknown>;

          if (event.type === 'item.completed') {
            const item = event.item as Record<string, unknown> | undefined;
            if (item?.type === 'agent_message' && typeof item.text === 'string') {
              finalResult = item.text;
              onProgress?.({ type: 'text_delta', text: item.text });
            }
          }

          if (event.type === 'turn.completed') {
            usage = parseUsage(event.usage);
          }
        } catch {
          // Ignore non-JSON lines such as "Reading prompt from stdin..."
        }
      }
    }

    if (signal?.aborted) {
      await proc.exited;
      return { exitCode: 1, stderr: 'aborted', content: null };
    }

    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer) as Record<string, unknown>;
        if (event.type === 'turn.completed') {
          usage = parseUsage(event.usage);
        }
      } catch {
        // ignore trailing non-JSON output
      }
    }

    const [stderr, exitCode] = await Promise.all([stderrPromise, proc.exited]);
    if (exitCode !== 0 && !finalResult) {
      return { exitCode, stderr, content: null };
    }

    return {
      exitCode: 0,
      stderr: '',
      content: finalResult,
      usage,
    };
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

function parseUsage(raw: unknown): UsageStats | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const usage = raw as Record<string, unknown>;

  return {
    inputTokens: asNumber(usage.input_tokens),
    outputTokens: asNumber(usage.output_tokens),
    cacheReadTokens: asNumber(usage.cached_input_tokens),
    cacheCreateTokens: 0,
    costUsd: null,
  };
}
