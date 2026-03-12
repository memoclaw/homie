import type { Agent } from '@homie/agent';
import type { InboundEvent, ProgressHandler, ReplyFn, SessionStore } from '@homie/core';
import { getErrorMessage } from '@homie/core';
import { createLogger } from '@homie/observability';
import { createCommandHandler } from './commands';
import { type AgentSelectionOverride, createRequestRunner } from './request-runner';

const log = createLogger('gateway');

export interface GatewayDeps {
  sessionStore: SessionStore;
  agent: Agent;
  resolveAgent?: (selection: AgentSelectionOverride) => Agent;
}

export interface Gateway {
  handleEvent(event: InboundEvent, reply: ReplyFn, progress?: ProgressHandler): Promise<void>;
}

export function createGateway(deps: GatewayDeps): Gateway {
  const runner = createRequestRunner({
    sessionStore: deps.sessionStore,
    agent: deps.agent,
    resolveAgent: deps.resolveAgent,
  });

  const commands = createCommandHandler({
    requestRunner: runner,
  });

  return {
    async handleEvent(event, reply, progress) {
      try {
        // Try handling as a command first
        if (event.type === 'command') {
          const handled = await commands.handle({
            channel: event.channel,
            chatId: event.chatId,
            command: event.command,
            args: event.args,
            reply,
          });
          if (handled) return;
        }

        // Submit as a run (chat messages + unrecognized commands)
        const text =
          event.type === 'command' ? `/${event.command} ${event.args}`.trim() : event.text;
        const agentSelection = event.type === 'chat' ? parseAgentSelection(event.agentModel) : null;

        await runner.submit({
          channel: event.channel,
          chatId: event.chatId,
          text,
          rawSourceId: event.rawSourceId,
          agentType: agentSelection?.agentType,
          agentModel: agentSelection?.agentModel,
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

const AGENT_TYPE_ALIASES: Record<string, string> = {
  claude: 'claude-code',
  'claude-code': 'claude-code',
  codex: 'codex',
};

function parseAgentSelection(agentModel?: string | null): AgentSelectionOverride | null {
  const value = agentModel?.trim();
  if (!value) {
    return null;
  }

  const [head, ...rest] = value.split(/\s+/);
  const agentType = AGENT_TYPE_ALIASES[head?.toLowerCase() ?? ''];
  if (!agentType) {
    return { agentModel: value };
  }

  return {
    agentType,
    agentModel: rest.join(' ').trim() || null,
  };
}
