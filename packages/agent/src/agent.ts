import type { ProviderAdapter, UsageStats } from '@homie/core';
import { createLogger } from '@homie/observability';
import { type AgentInput, buildMessages } from './context-builder';

const log = createLogger('agent');

export interface AgentOutput {
  text: string;
  usage?: UsageStats;
  /** False when session resume failed and full history was re-sent */
  resumed?: boolean;
}

export interface AgentConfig {
  model: string;
}

export interface Agent {
  run(input: AgentInput): Promise<AgentOutput>;
}

export function createAgent(provider: ProviderAdapter, config: AgentConfig): Agent {
  return {
    async run(input) {
      const messages = buildMessages(input);

      log.info('Agent run started', { sessionId: input.sessionId });

      const response = await provider.generate({
        messages,
        model: config.model,
        sessionId: input.sessionId,
        hasHistory: input.history.length > 0 && !input.forceFullHistory,
        onProgress: input.onProgress,
        signal: input.signal,
      });

      const text = response.content ?? '(no response)';

      log.info('Agent run completed', {
        sessionId: input.sessionId,
        costUsd: response.usage?.costUsd,
      });

      return {
        text,
        usage: response.usage,
        resumed: response.resumed,
      };
    },
  };
}
