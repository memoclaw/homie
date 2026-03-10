import { rmSync } from 'node:fs';
import type { Agent } from '@homie/agent';
import type {
  Attachment,
  ProgressCallback,
  ProgressHandler,
  ReplyFn,
  Task,
  TaskStore,
} from '@homie/core';
import { AbortError, getErrorMessage } from '@homie/core';
import { createLogger } from '@homie/observability';
import type { UsageStore } from '@homie/persistence';
import type { SessionManager } from '@homie/sessions';
import { formatElapsed, toolHint } from './format';

const log = createLogger('task-runner');

const MAX_HISTORY_MESSAGES = 50;
const MAX_QUEUE_DEPTH = 10;

interface RunHandle {
  abort: AbortController;
  done: Promise<void>;
  taskId: string;
}

interface QueueEntry {
  task: Task;
  text: string;
  reply: ReplyFn;
  progress?: ProgressHandler;
  attachments?: Attachment[];
}

export interface TaskRunnerDeps {
  sessionManager: SessionManager;
  agent: Agent;
  taskStore: TaskStore;
  usageStore?: UsageStore;
  model?: string;
}

export interface TaskRunner {
  submit(params: {
    channel: string;
    chatId: string;
    userId: string | null;
    sessionId: string;
    text: string;
    rawSourceId: string | null;
    reply: ReplyFn;
    progress?: ProgressHandler;
    attachments?: Attachment[];
  }): Promise<void>;
  abort(channel: string, chatId: string): Promise<boolean>;
}

export function createTaskRunner(deps: TaskRunnerDeps): TaskRunner {
  const { sessionManager, agent, taskStore } = deps;
  const activeRuns = new Map<string, RunHandle>();
  const queues = new Map<string, QueueEntry[]>();
  /** Sessions whose last run was interrupted — next run must replay full history */
  const staleResume = new Set<string>();

  function chatKey(channel: string, chatId: string): string {
    return `${channel}:${chatId}`;
  }

  async function executeTask(entry: QueueEntry, sessionId: string): Promise<void> {
    const { task, text, reply, progress, attachments } = entry;
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

        const [history] = await Promise.all([
          sessionManager.getHistory(sessionId, MAX_HISTORY_MESSAGES),
          taskStore.updateTaskStatus(task.id, 'running'),
          sessionManager.setProcessing(sessionId),
        ]);
        const forceFullHistory = staleResume.delete(chatKey(task.channel, task.chatId));

        // Prepend attachment file paths so Claude Code can read them
        let promptText = text;
        if (attachments && attachments.length > 0) {
          const refs = attachments.map((a) => {
            const label = a.fileName ? `${a.fileName} (${a.mimeType})` : a.mimeType;
            return `[Attached file: ${a.filePath}] (${label})`;
          });
          promptText = `${refs.join('\n')}\n\n${text}`;
        }

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
          forceFullHistory,
          userId: task.userId ?? undefined,
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
        await taskStore.updateTaskStatus(task.id, 'done');

        if (result.usage && deps.usageStore) {
          deps.usageStore.record(sessionId, result.usage, deps.model, task.id);
        }
      } catch (err) {
        if (err instanceof AbortError) {
          log.info('Task aborted', { taskId: task.id });
          await taskStore.updateTaskStatus(task.id, 'aborted');
          return;
        }

        const message = getErrorMessage(err);
        log.error('Task execution failed', { taskId: task.id, error: message });
        await taskStore.updateTaskStatus(task.id, 'failed');
        try {
          await reply('Something went wrong. Please try again.');
        } catch {
          // ignore
        }
      } finally {
        if (typingInterval) clearInterval(typingInterval);
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        activeRuns.delete(chatKey(task.channel, task.chatId));
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

        // Drain queue: start next task if any
        await drainQueue(task.channel, task.chatId, sessionId);
      }
    })();

    const key = chatKey(task.channel, task.chatId);
    activeRuns.set(key, { abort: controller, done, taskId: task.id });
  }

  async function drainQueue(channel: string, chatId: string, sessionId: string): Promise<void> {
    const key = chatKey(channel, chatId);
    const queue = queues.get(key);
    if (!queue || queue.length === 0) return;

    const next = queue.shift();
    if (queue.length === 0) queues.delete(key);

    if (next) {
      await executeTask(next, sessionId);
    }
  }

  return {
    async submit(params) {
      const {
        channel,
        chatId,
        userId,
        sessionId,
        text,
        rawSourceId,
        reply,
        progress,
        attachments,
      } = params;
      const key = chatKey(channel, chatId);

      // Store the inbound message first — this is the source of truth
      const message = await sessionManager.addMessage(sessionId, 'in', text, rawSourceId);

      const task = await taskStore.createTask({
        channel,
        chatId,
        userId,
        sessionId,
        messageId: message.id,
      });

      if (activeRuns.has(key)) {
        const queue = queues.get(key) ?? [];
        if (queue.length >= MAX_QUEUE_DEPTH) {
          await taskStore.updateTaskStatus(task.id, 'failed');
          await reply(`Queue full (max ${MAX_QUEUE_DEPTH}). Try again later.`);
          return;
        }
        queue.push({ task, text, reply, progress, attachments });
        queues.set(key, queue);

        const position = queue.length;
        await reply(`Queued (position ${position}). Will start when the current task finishes.`);
        return;
      }

      await executeTask({ task, text, reply, progress, attachments }, sessionId);
    },

    async abort(channel, chatId) {
      const key = chatKey(channel, chatId);
      const handle = activeRuns.get(key);
      if (!handle) return false;

      log.info('Aborting task', { taskId: handle.taskId });
      handle.abort.abort();
      staleResume.add(key);

      // Also clear the queue
      const queue = queues.get(key);
      if (queue) {
        queues.delete(key);
        await Promise.all(
          queue.map((entry) =>
            taskStore.updateTaskStatus(entry.task.id, 'aborted').catch(() => {}),
          ),
        );
      }

      await handle.done;
      return true;
    },
  };
}
