import { rmSync } from 'node:fs';
import type { Agent } from '@homie/agent';
import type {
  Attachment,
  ProgressCallback,
  ProgressHandler,
  ReplyFn,
  SessionStore,
} from '@homie/core';
import { AbortError, getErrorMessage } from '@homie/core';
import { createLogger } from '@homie/observability';
import { formatElapsed, toolHint } from './format';

const log = createLogger('request-runner');

const MAX_HISTORY_MESSAGES = 50;

interface ActiveRequest {
  abort: AbortController;
  done: Promise<void>;
  text: string;
  startedAt: number;
  lastToolHint: string;
}

interface SubmitRequest {
  channel: string;
  chatId: string;
  text: string;
  rawSourceId: string | null;
  agentType?: string | null;
  agentModel?: string | null;
  reply: ReplyFn;
  progress?: ProgressHandler;
  attachments?: Attachment[];
}

export interface AgentSelectionOverride {
  agentType?: string | null;
  agentModel?: string | null;
}

interface ExecutionContext {
  active: ActiveRequest;
  forceFullHistory: boolean;
  key: string;
  sessionId: string;
}

export interface RequestRunnerDeps {
  sessionStore: SessionStore;
  agent: Agent;
  resolveAgent?: (selection: AgentSelectionOverride) => Agent;
}

export interface RequestRunner {
  submit(params: SubmitRequest): Promise<void>;
  abort(channel: string, chatId: string): Promise<boolean>;
  resetSession(channel: string, chatId: string): Promise<void>;
  getStatus(
    channel: string,
    chatId: string,
  ): { text: string; startedAt: number; lastToolHint: string } | null;
}

export function createRequestRunner(deps: RequestRunnerDeps): RequestRunner {
  const { sessionStore, agent, resolveAgent } = deps;
  const activeRequests = new Map<string, ActiveRequest>();
  const staleResume = new Set<string>();

  function chatKey(channel: string, chatId: string): string {
    return `${channel}:${chatId}`;
  }

  function createActiveRequest(text: string): ActiveRequest {
    const controller = new AbortController();
    return {
      abort: controller,
      done: Promise.resolve(),
      text,
      startedAt: Date.now(),
      lastToolHint: '',
    };
  }

  function buildPromptText(text: string, attachments?: Attachment[]): string {
    if (!attachments || attachments.length === 0) {
      return text;
    }

    const refs = attachments.map((attachment) => {
      const label = attachment.fileName
        ? `${attachment.fileName} (${attachment.mimeType})`
        : attachment.mimeType;
      return `[Attached file: ${attachment.filePath}] (${label})`;
    });

    return `${refs.join('\n')}\n\n${text}`;
  }

  function createProgressCallback(
    active: ActiveRequest,
    progress?: ProgressHandler,
  ): ProgressCallback | undefined {
    if (!progress) {
      return undefined;
    }

    return (event) => {
      if (event.type === 'tool_start') {
        active.lastToolHint = toolHint(event.toolName);
        progress.onStatus(`${active.lastToolHint}...`).catch(() => {});
      }
    };
  }

  function cleanupAttachments(attachments?: Attachment[]): void {
    if (!attachments) {
      return;
    }

    for (const attachment of attachments) {
      try {
        rmSync(attachment.filePath, { force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  async function interruptActiveRequest(
    key: string,
    options: { channel: string; chatId: string; logMessage: string; markResumeStale: boolean },
  ): Promise<boolean> {
    const active = activeRequests.get(key);
    if (!active) {
      return false;
    }

    log.info(options.logMessage, { channel: options.channel, chatId: options.chatId });
    active.abort.abort();
    if (options.markResumeStale) {
      staleResume.add(key);
    }
    await active.done;
    return true;
  }

  async function prepareExecution(
    channel: string,
    chatId: string,
    text: string,
  ): Promise<ExecutionContext> {
    const key = chatKey(channel, chatId);
    await interruptActiveRequest(key, {
      channel,
      chatId,
      logMessage: 'Superseding active request',
      markResumeStale: true,
    });

    const session = await sessionStore.getOrCreateActiveByChat(channel, chatId);
    const active = createActiveRequest(text);
    const forceFullHistory = staleResume.delete(key);

    activeRequests.set(key, active);

    return {
      active,
      forceFullHistory,
      key,
      sessionId: session.id,
    };
  }

  async function execute(
    context: ExecutionContext,
    params: Omit<SubmitRequest, 'channel' | 'chatId'>,
  ): Promise<void> {
    const { active, forceFullHistory, key, sessionId } = context;
    const { channel, text, rawSourceId, agentType, agentModel, reply, progress, attachments } =
      params;
    const signal = active.abort.signal;
    const selectedAgent =
      agentType || agentModel ? (resolveAgent?.({ agentType, agentModel }) ?? agent) : agent;

    const done = (async () => {
      let typingInterval: ReturnType<typeof setInterval> | undefined;
      let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

      try {
        if (progress) {
          progress.onTyping().catch(() => {});
          typingInterval = setInterval(() => {
            progress.onTyping().catch(() => {});
          }, 4000);
          heartbeatInterval = setInterval(() => {
            const elapsed = Math.round((Date.now() - active.startedAt) / 1000);
            const hint = active.lastToolHint ? ` — ${active.lastToolHint}` : '';
            progress
              .onStatus(`Still working${hint}... (${formatElapsed(elapsed)})`)
              .catch(() => {});
          }, 30000);
        }

        if (signal.aborted) throw new AbortError();
        await sessionStore.addMessage(sessionId, 'in', text, rawSourceId);
        const history = await sessionStore.listRecentMessages(sessionId, MAX_HISTORY_MESSAGES);

        const result = await selectedAgent.run({
          sessionId,
          text: buildPromptText(text, attachments),
          history,
          forceFullHistory,
          onProgress: createProgressCallback(active, progress),
          signal,
        });

        if (signal.aborted) {
          throw new AbortError();
        }

        if (result.resumed === false) {
          log.warn('Session context was refreshed (resume failed)', { sessionId });
          if (channel !== 'github') {
            await reply('(Session context was refreshed)');
          }
        }

        await sessionStore.addMessage(sessionId, 'out', result.text);
        await reply(result.text);
      } catch (err) {
        if (err instanceof AbortError) {
          log.info('Request interrupted', { key });
          return;
        }

        const message = getErrorMessage(err);
        log.error('Request execution failed', { key, error: message });
        try {
          await reply('Something went wrong. Please try again.');
        } catch {
          // ignore
        }
      } finally {
        if (typingInterval) clearInterval(typingInterval);
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        if (activeRequests.get(key) === active) {
          activeRequests.delete(key);
        }

        cleanupAttachments(attachments);
      }
    })();

    active.done = done;
  }

  return {
    async submit(params) {
      const { channel, chatId, text, reply, progress, attachments, rawSourceId } = params;
      const context = await prepareExecution(channel, chatId, text);
      await execute(context, {
        channel,
        text,
        rawSourceId,
        agentType: params.agentType,
        agentModel: params.agentModel,
        reply,
        progress,
        attachments,
      });
    },

    async abort(channel, chatId) {
      return interruptActiveRequest(chatKey(channel, chatId), {
        channel,
        chatId,
        logMessage: 'Aborting request',
        markResumeStale: true,
      });
    },

    async resetSession(channel, chatId) {
      const key = chatKey(channel, chatId);
      await interruptActiveRequest(key, {
        channel,
        chatId,
        logMessage: 'Resetting session while request is active',
        markResumeStale: false,
      });
      staleResume.delete(key);
      await sessionStore.startFreshSession(channel, chatId);
    },

    getStatus(channel, chatId) {
      const active = activeRequests.get(chatKey(channel, chatId));
      if (!active) return null;
      return {
        text: active.text,
        startedAt: active.startedAt,
        lastToolHint: active.lastToolHint,
      };
    },
  };
}
