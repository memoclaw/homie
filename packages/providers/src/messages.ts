import type { ProviderMessage } from '@homie/core';

export function extractSystemPrompt(messages: ProviderMessage[]): string | null {
  for (const msg of messages) {
    if (msg.role === 'system' && msg.content) return msg.content;
  }
  return null;
}

export function extractLastUserMessage(messages: ProviderMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === 'user' && msg.content) return msg.content;
  }
  return '';
}

export function flattenMessages(messages: ProviderMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (!msg.content) continue;
    switch (msg.role) {
      case 'system':
        parts.push(`[System]\n${msg.content}`);
        break;
      case 'user':
        parts.push(`[User]\n${msg.content}`);
        break;
      case 'assistant':
        parts.push(`[Assistant]\n${msg.content}`);
        break;
    }
  }
  return parts.join('\n\n');
}
