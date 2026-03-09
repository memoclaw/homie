import { rmSync } from 'node:fs';
import type { Agent } from '@homie/agent';
import type { Attachment, ProgressCallback } from '@homie/core';
import { AbortError, getErrorMessage } from '@homie/core';
import { createLogger } from '@homie/observability';
import type { MemoryEntry, MemoryStore, UsageStore } from '@homie/persistence';
import type { SessionManager } from '@homie/sessions';
import { formatElapsed, toolHint } from './format';
import type { ProgressHandler, ReplyFn } from '@homie/core';

const log = createLogger('agent-runner');

interface RunHandle {
  abort: AbortController;
  done: Promise<void>;
}

export interface AgentRunnerDeps {
  sessionManager: SessionManager;
  agent: Agent;
  maxHistoryMessages: number;
  memoryStore?: MemoryStore;
  maxContextMemories?: number;
  usageStore?: UsageStore;
  model?: string;
}

export interface AgentRunner {
  interrupt(sessionId: string): Promise<boolean>;
  start(
    sessionId: string,
    text: string,
    rawSourceId: string | null,
    userId: string | null,
    reply: ReplyFn,
    progress?: ProgressHandler,
    attachments?: Attachment[],
  ): void;
}

export function createAgentRunner(deps: AgentRunnerDeps): AgentRunner {
  const activeRuns = new Map<string, RunHandle>();
  const { sessionManager, agent } = deps;

  return {
    async interrupt(sessionId) {
      const handle = activeRuns.get(sessionId);
      if (!handle) return false;

      log.info('Interrupting session', { sessionId });
      handle.abort.abort();
      await handle.done;
      return true;
    },

    start(sessionId, text, rawSourceId, userId, reply, progress, attachments) {
      const controller = new AbortController();

      const done = (async () => {
        let typingInterval: ReturnType<typeof setInterval> | undefined;
        let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
        const startTime = Date.now();
        let lastToolHint = '';

        try {
          if (progress) {
            progress.onTyping().catch(() => {});

            typingInterval = setInterval(() => {
              progress.onTyping().catch(() => {});
            }, 4000);

            heartbeatInterval = setInterval(() => {
              const elapsed = Math.round((Date.now() - startTime) / 1000);
              const hint = lastToolHint ? ` — ${lastToolHint}` : '';
              progress
                .onStatus(`Still working${hint}... (${formatElapsed(elapsed)})`)
                .catch(() => {});
            }, 30000);
          }

          await sessionManager.setProcessing(sessionId);

          const historyPromise = sessionManager.getHistory(sessionId, deps.maxHistoryMessages);

          let memoriesPromise: Promise<MemoryEntry[] | undefined> = Promise.resolve(undefined);
          if (deps.memoryStore) {
            const scopes = ['global'];
            if (userId) scopes.push(`user:${userId}`);
            const store = deps.memoryStore;
            memoriesPromise = Promise.resolve(store.list(scopes, deps.maxContextMemories ?? 50));
          }

          const [history, memories] = await Promise.all([historyPromise, memoriesPromise]);

          // Prepend attachment file paths so Claude Code can read them
          let promptText = text;
          if (attachments && attachments.length > 0) {
            const refs = attachments.map((a) => {
              const label = a.fileName ? `${a.fileName} (${a.mimeType})` : a.mimeType;
              return `[Attached file: ${a.filePath}] (${label})`;
            });
            promptText = `${refs.join('\n')}\n\n${text}`;
          }

          await sessionManager.addMessage(sessionId, 'in', text, rawSourceId);

          const onProgress: ProgressCallback | undefined = progress
            ? (event) => {
                if (event.type === 'tool_start') {
                  lastToolHint = toolHint(event.toolName);
                  progress.onStatus(`${lastToolHint}...`).catch(() => {});
                }
              }
            : undefined;

          const result = await agent.run({
            sessionId,
            text: promptText,
            history,
            memories,
            userId: userId ?? undefined,
            onProgress,
            signal: controller.signal,
          });

          if (controller.signal.aborted) {
            throw new AbortError();
          }

          if (result.resumed === false) {
            log.warn('Session context was refreshed (resume failed)', { sessionId });
            await reply('(Session context was refreshed)');
          }

          await sessionManager.addMessage(sessionId, 'out', result.text);
          await reply(result.text);

          if (result.usage && deps.usageStore) {
            deps.usageStore.record(sessionId, result.usage, deps.model);
          }

          // Save extracted memories
          if (result.memories && deps.memoryStore) {
            for (const m of result.memories) {
              const now = new Date().toISOString();
              deps.memoryStore.save({
                id: crypto.randomUUID(),
                scope: 'global',
                content: m.content,
                tags: '',
                createdAt: now,
                updatedAt: now,
                sourceSessionId: sessionId,
              });
              log.info('Memory saved', { sessionId, content: m.content.slice(0, 100) });
            }
          }

          // Generate title for untitled sessions (fire-and-forget)
          agent
            .generateTitle(text, result.text)
            .then((title) => {
              if (title) {
                sessionManager.setTitle(sessionId, title).catch(() => {});
                log.debug('Session title generated', { sessionId, title });
              }
            })
            .catch(() => {});
        } catch (err) {
          if (err instanceof AbortError) {
            log.info('Agent run interrupted', { sessionId });
            return;
          }

          const message = getErrorMessage(err);
          log.error('Background agent run failed', {
            sessionId,
            error: message,
          });
          try {
            await reply('Something went wrong. Please try again.');
          } catch {
            // ignore
          }
        } finally {
          if (typingInterval) clearInterval(typingInterval);
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          activeRuns.delete(sessionId);
          await sessionManager.setIdle(sessionId);

          // Clean up temp attachment files
          if (attachments) {
            for (const a of attachments) {
              try {
                rmSync(a.filePath, { force: true });
              } catch {
                // ignore cleanup errors
              }
            }
          }
        }
      })();

      activeRuns.set(sessionId, { abort: controller, done });
    },
  };
}
