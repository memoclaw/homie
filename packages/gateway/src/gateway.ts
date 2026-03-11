import type { Agent } from '@homie/agent';
import type {
  AccountUsageProvider,
  InboundEvent,
  ProgressHandler,
  ReplyFn,
  SessionStore,
  TaskStore,
} from '@homie/core';
import { getErrorMessage } from '@homie/core';
import { createLogger } from '@homie/observability';
import type { UsageStore } from '@homie/persistence';
import { createCommandHandler } from './commands';
import { createTaskRunner } from './task-runner';

const log = createLogger('gateway');

export interface GatewayDeps {
  sessionStore: SessionStore;
  agent: Agent;
  taskStore: TaskStore;
  usageStore?: UsageStore;
  accountUsage?: AccountUsageProvider;
  model?: string;
}

export interface Gateway {
  handleEvent(event: InboundEvent, reply: ReplyFn, progress?: ProgressHandler): Promise<void>;
}

export function createGateway(deps: GatewayDeps): Gateway {
  const { sessionStore } = deps;

  const runner = createTaskRunner({
    sessionStore,
    agent: deps.agent,
    taskStore: deps.taskStore,
    usageStore: deps.usageStore,
    model: deps.model,
  });

  const commands = createCommandHandler({
    taskStore: deps.taskStore,
    taskRunner: runner,
    usageStore: deps.usageStore,
    accountUsage: deps.accountUsage,
  });

  return {
    async handleEvent(event, reply, progress) {
      try {
        // Resolve the hidden internal session
        const session = await sessionStore.getOrCreateByChat(
          event.channel,
          event.chatId,
          event.userId,
        );

        // Try handling as a command first
        if (event.type === 'command') {
          const handled = await commands.handle({
            channel: event.channel,
            chatId: event.chatId,
            userId: event.userId,
            sessionId: session.id,
            command: event.command,
            args: event.args,
            reply,
          });
          if (handled) return;
        }

        // Submit as a task (chat messages + unrecognized commands)
        const text =
          event.type === 'command' ? `/${event.command} ${event.args}`.trim() : event.text;

        await runner.submit({
          channel: event.channel,
          chatId: event.chatId,
          userId: event.userId,
          sessionId: session.id,
          text,
          rawSourceId: event.rawSourceId,
          reply,
          progress,
          attachments: event.type === 'chat' ? event.attachments : undefined,
        });
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
