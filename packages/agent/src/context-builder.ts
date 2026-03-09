import type { Message, ProgressCallback, ProviderMessage } from '@homie/core';
import type { MemoryEntry } from '@homie/persistence';
import { buildSystemPrompt } from './prompts';

export interface AgentInput {
  sessionId: string;
  text: string;
  history: Message[];
  memories?: MemoryEntry[];
  userId?: string;
  onProgress?: ProgressCallback;
  /** Signal to abort the in-flight agent run */
  signal?: AbortSignal;
}

export function buildMessages(input: AgentInput): ProviderMessage[] {
  const systemPrompt = buildSystemPrompt({
    memories: input.memories,
  });

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
