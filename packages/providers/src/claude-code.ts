import type {
  ProgressCallback,
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
} from '@homie/core';
import { AbortError, ProviderError } from '@homie/core';
import { createLogger } from '@homie/observability';
import { extractLastUserMessage, extractSystemPrompt, flattenMessages } from './messages';

const log = createLogger('provider:claude-code');

// --- Config ---

export interface ClaudeCodeConfig {
  model: string;
  extraArgs?: string[];
}

// --- Factory ---

/**
 * Create a ProviderAdapter that spawns the local `claude` CLI.
 *
 * This is the only built-in provider. The ProviderAdapter interface
 * in @homie/core is the extension point — any ACP-compatible agent
 * can implement it to plug into Homie.
 */
export function createClaudeCodeProvider(config: ClaudeCodeConfig): ProviderAdapter {
  const cmd = 'claude';
  const extraArgs = config.extraArgs ?? [];

  async function generate(input: ProviderRequest): Promise<ProviderResponse> {
    const systemPrompt = input.sessionId ? extractSystemPrompt(input.messages) : null;
    const prompt = input.sessionId
      ? extractLastUserMessage(input.messages)
      : flattenMessages(input.messages);

    const args = buildArgs({
      prompt,
      systemPrompt,
      model: config.model,
      extra: extraArgs,
      sessionId: input.sessionId,
      hasHistory: input.hasHistory ?? false,
    });

    let result = await spawnStreaming(cmd, args, input.onProgress, input.signal);
    let resumed = true;

    // If resume failed, retry with full history as a fresh session
    const tryResume = input.sessionId && input.hasHistory;
    if (result.exitCode !== 0 && tryResume) {
      log.info('Resume failed, retrying with full history', {
        sessionId: input.sessionId,
        exitCode: result.exitCode,
      });
      resumed = false;
      const fullPrompt = flattenMessages(input.messages);
      const retryArgs = buildArgs({
        prompt: fullPrompt,
        systemPrompt: null,
        model: config.model,
        extra: extraArgs,
        sessionId: input.sessionId,
        hasHistory: false,
      });
      result = await spawnStreaming(cmd, retryArgs, input.onProgress, input.signal);
    }

    // Retry once on crash (non-resume failures)
    if (result.content === null && !input.signal?.aborted) {
      log.warn('Claude Code failed, retrying in 3s', {
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 500),
      });
      await new Promise((r) => {
        const timer = setTimeout(r, 3000);
        input.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            r(undefined);
          },
          { once: true },
        );
      });

      if (input.signal?.aborted) {
        throw new AbortError();
      }

      result = await spawnStreaming(cmd, args, input.onProgress, input.signal);
    }

    if (result.content === null) {
      if (input.signal?.aborted) {
        throw new AbortError();
      }
      log.error('Claude Code failed after all retries', {
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 500),
      });
      throw new ProviderError(
        `Claude Code exited with code ${result.exitCode}: ${result.stderr.slice(0, 300)}`,
      );
    }

    return {
      content: result.content,
      resumed: tryResume ? resumed : undefined,
    };
  }

  return { generate };
}

// --- Arg building ---

interface ArgsInput {
  prompt: string;
  systemPrompt: string | null;
  model: string;
  extra: string[];
  sessionId: string | undefined;
  hasHistory: boolean;
}

function buildArgs(input: ArgsInput): string[] {
  const args = [
    '-p',
    input.prompt,
    '--dangerously-skip-permissions',
    '--output-format',
    'stream-json',
    '--verbose',
  ];

  if (input.sessionId && input.hasHistory) {
    args.push('--resume', input.sessionId);
  } else if (input.sessionId) {
    args.push('--session-id', input.sessionId);
  }

  if (input.systemPrompt) {
    args.push('--append-system-prompt', input.systemPrompt);
  }
  if (input.model) {
    args.push('--model', input.model);
  }

  args.push(...input.extra);
  return args;
}

// --- Process spawning ---

interface SpawnResult {
  exitCode: number;
  stderr: string;
  content: string | null;
}

async function spawnStreaming(
  cmd: string,
  args: string[],
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<SpawnResult> {
  log.debug('Spawning Claude Code', { promptLength: args[1]?.length ?? 0 });

  const proc = Bun.spawn([cmd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const onAbort = () => proc.kill();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    let finalResult: string | null = null;
    let accumulatedText = '';
    const toolsSeen = new Set<string>();

    function handleResultEvent(event: Record<string, unknown>): void {
      if (event.type === 'result') {
        if (typeof event.result === 'string') {
          finalResult = event.result;
        }
      }
    }

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
          const event = JSON.parse(line);
          processStreamEvent(event, onProgress, toolsSeen, (t) => {
            accumulatedText += t;
          });
          handleResultEvent(event);
        } catch {
          // Not valid JSON — ignore
        }
      }
    }

    if (signal?.aborted) {
      await proc.exited;
      return { exitCode: 1, stderr: 'aborted', content: null };
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        handleResultEvent(JSON.parse(buffer));
      } catch {
        // ignore
      }
    }

    const [stderr, exitCode] = await Promise.all([stderrPromise, proc.exited]);
    const content = finalResult ?? (accumulatedText.trim() || null);

    if (exitCode !== 0 && !content) {
      return { exitCode, stderr, content: null };
    }

    log.debug('Claude Code responded', {
      outputLength: content?.length ?? 0,
    });

    return { exitCode: 0, stderr: '', content };
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

// --- Stream event parsing ---

function processStreamEvent(
  event: Record<string, unknown>,
  onProgress: ProgressCallback | undefined,
  toolsSeen: Set<string>,
  onText: (text: string) => void,
): void {
  if (!event || typeof event !== 'object') return;

  if (event.type === 'content_block_start') {
    const block = event.content_block as Record<string, unknown> | undefined;
    if (block?.type === 'tool_use' && typeof block.name === 'string') {
      if (!toolsSeen.has(block.name)) {
        toolsSeen.add(block.name);
        onProgress?.({ type: 'tool_start', toolName: block.name });
      }
    }
  }

  if (event.type === 'assistant') {
    const msg = event.message as Record<string, unknown> | undefined;
    const content = msg?.content as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_use' && typeof block.name === 'string') {
          if (!toolsSeen.has(block.name)) {
            toolsSeen.add(block.name);
            onProgress?.({ type: 'tool_start', toolName: block.name });
          }
        }
        if (block.type === 'text' && typeof block.text === 'string') {
          onText(block.text);
        }
      }
    }
  }

  if (event.type === 'content_block_delta') {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      onText(delta.text);
    }
  }
}
