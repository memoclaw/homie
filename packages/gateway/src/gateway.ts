import type { Agent } from '@homie/agent';
import type { InboundEvent, ProgressHandler, ReplyFn } from '@homie/core';
import { getErrorMessage } from '@homie/core';
import { createLogger } from '@homie/observability';
import type { MemoryStore, UsageStore } from '@homie/persistence';
import type { SessionManager } from '@homie/sessions';
import { createAgentRunner } from './agent-runner';
import { createCommandHandler } from './commands';

const log = createLogger('gateway');

export interface GatewayDeps {
  sessionManager: SessionManager;
  agent: Agent;
  maxHistoryMessages: number;
  memoryStore?: MemoryStore;
  maxContextMemories?: number;
  usageStore?: UsageStore;
  model?: string;
  startedAt?: Date;
}

export interface Gateway {
  handleEvent(event: InboundEvent, reply: ReplyFn, progress?: ProgressHandler): Promise<void>;
}

export function createGateway(deps: GatewayDeps): Gateway {
  const { sessionManager } = deps;

  const runner = createAgentRunner({
    sessionManager: deps.sessionManager,
    agent: deps.agent,
    maxHistoryMessages: deps.maxHistoryMessages,
    memoryStore: deps.memoryStore,
    maxContextMemories: deps.maxContextMemories,
    usageStore: deps.usageStore,
    model: deps.model,
  });

  const commands = createCommandHandler({
    sessionManager: deps.sessionManager,
    agentRunner: runner,
    memoryStore: deps.memoryStore,
    usageStore: deps.usageStore,
    startedAt: deps.startedAt,
  });

  async function interruptIfBusy(
    sessionId: string,
    status: string,
    reply: ReplyFn,
  ): Promise<void> {
    if (status === 'processing') {
      const interrupted = await runner.interrupt(sessionId);
      if (interrupted) {
        await reply('Interrupted. Processing your new message...');
      }
    }
  }

  return {
    async handleEvent(event, reply, progress) {
      try {
        if (event.type === 'command') {
          const handled = await commands.handlePreSession(
            event.channel,
            event.chatId,
            event.userId,
            event.command,
            event.args,
            reply,
          );
          if (handled) return;
        }

        const session = await sessionManager.resolveSession(
          event.channel,
          event.chatId,
          event.userId,
        );

        if (event.type === 'command') {
          const handled = await commands.handlePostSession(
            session.id,
            event.channel,
            event.chatId,
            event.command,
            event.args,
            event.userId,
            reply,
            progress,
          );
          if (handled) return;

          await interruptIfBusy(session.id, session.status, reply);
          runner.start(
            session.id,
            `/${event.command} ${event.args}`.trim(),
            null,
            event.userId,
            reply,
            progress,
          );
        } else {
          await interruptIfBusy(session.id, session.status, reply);
          runner.start(
            session.id,
            event.text,
            event.rawSourceId,
            event.userId,
            reply,
            progress,
            event.attachments,
          );
        }
      } catch (err) {
        const message = getErrorMessage(err);
        log.error('Error handling event', { error: message });
        try {
          await reply('Something went wrong. Please try again.');
        } catch {
          // ignore send failure
        }
      }
    },
  };
}
