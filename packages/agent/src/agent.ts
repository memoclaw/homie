import type { Message, ProgressCallback, ProviderAdapter, ProviderMessage } from '@homie/core';
import { createLogger } from '@homie/observability';

const log = createLogger('agent');

const SYSTEM_PROMPT = 'You are Homie. Keep responses concise (Telegram chat).';

export interface AgentInput {
  sessionId: string;
  text: string;
  history: Message[];
  /** When true, skip resume and send full history (e.g. after an interrupted run) */
  forceFullHistory?: boolean;
  onProgress?: ProgressCallback;
  /** Signal to abort the in-flight agent run */
  signal?: AbortSignal;
}

export interface AgentOutput {
  text: string;
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
      });

      return {
        text,
        resumed: response.resumed,
      };
    },
  };
}

function buildMessages(input: AgentInput): ProviderMessage[] {
  const messages: ProviderMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

  for (const msg of input.history) {
    if (msg.direction === 'in') {
      messages.push({ role: 'user', content: msg.text });
    } else if (msg.direction === 'out') {
      messages.push({ role: 'assistant', content: msg.text });
    }
  }

  messages.push({ role: 'user', content: input.text });

  return messages;
}
