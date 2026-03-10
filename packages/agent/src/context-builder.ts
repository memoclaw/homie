import type { Message, ProgressCallback, ProviderMessage } from '@homie/core';
import { buildSystemPrompt } from './prompts';

export interface AgentInput {
  sessionId: string;
  text: string;
  history: Message[];
  /** When true, skip resume and send full history (e.g. after an interrupted run) */
  forceFullHistory?: boolean;
  userId?: string;
  onProgress?: ProgressCallback;
  /** Signal to abort the in-flight agent run */
  signal?: AbortSignal;
}

export function buildMessages(input: AgentInput): ProviderMessage[] {
  const systemPrompt = buildSystemPrompt();

  const messages: ProviderMessage[] = [{ role: 'system', content: systemPrompt }];

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
