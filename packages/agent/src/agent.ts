import type { ProviderAdapter, UsageStats } from '@homie/core';
import { createLogger } from '@homie/observability';
import type { MemoryStore } from '@homie/persistence';
import { type AgentInput, buildMessages } from './context-builder';
import { type ExtractedMemory, parseMemoryTags } from './memory';

const log = createLogger('agent');

export interface AgentOutput {
  text: string;
  usage?: UsageStats;
  /** False when session resume failed and full history was re-sent */
  resumed?: boolean;
  /** Memories extracted from the agent's response */
  memories?: ExtractedMemory[];
}

export interface AgentConfig {
  model: string;
  memoryStore?: MemoryStore;
}

export interface Agent {
  generateTitle(userMsg: string, assistantMsg: string): Promise<string | null>;
  run(input: AgentInput): Promise<AgentOutput>;
}

export function createAgent(provider: ProviderAdapter, config: AgentConfig): Agent {
  return {
    async generateTitle(userMsg, assistantMsg) {
      if (provider.generateTitle) {
        return provider.generateTitle(userMsg, assistantMsg);
      }
      return null;
    },

    async run(input) {
      const messages = buildMessages(input);

      log.info('Agent run started', { sessionId: input.sessionId });

      const response = await provider.generate({
        messages,
        model: config.model,
        sessionId: input.sessionId,
        hasHistory: input.history.length > 0,
        onProgress: input.onProgress,
        signal: input.signal,
      });

      const raw = response.content ?? '(no response)';
      const parsed = parseMemoryTags(raw);

      log.info('Agent run completed', {
        sessionId: input.sessionId,
        costUsd: response.usage?.costUsd,
        memoriesExtracted: parsed.memories.length,
      });

      return {
        text: parsed.text,
        usage: response.usage,
        resumed: response.resumed,
        memories: parsed.memories.length > 0 ? parsed.memories : undefined,
      };
    },
  };
}
