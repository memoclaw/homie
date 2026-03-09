import type { MemoryEntry } from '@homie/persistence';

const MEMORY_INSTRUCTIONS = `
When you learn something important that should persist across sessions, include a memory tag in your response:
<memory>content to remember</memory>

Use this for: user preferences, project context, key technical decisions, recurring patterns.
Do NOT use this for: transient information, things already in your memories, or trivial details.
The tag will be extracted and saved automatically — the user won't see it.`.trim();

export function buildSystemPrompt(opts: { memories?: MemoryEntry[] }): string {
  const parts: string[] = ['You are Homie. Keep responses concise (Telegram chat).'];

  parts.push(`\n${MEMORY_INSTRUCTIONS}`);

  if (opts.memories && opts.memories.length > 0) {
    const lines = opts.memories.map((m) => `- [${m.updatedAt.slice(0, 10)}] ${m.content}`);
    parts.push(`\nMemories:\n${lines.join('\n')}`);
  }

  return parts.join('\n');
}
