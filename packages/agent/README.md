# @homie/agent

Orchestrates provider calls with context assembly and memory extraction.

## What it does

1. Builds a message list from system prompt, memories, history, and user input (`buildMessages`)
2. Sends to the provider and streams progress
3. Parses `<memory>` tags from the response (`parseMemoryTags`)
4. Returns cleaned text, usage stats, resume status, and extracted memories

## Usage

```ts
import { createAgent } from '@homie/agent';

const agent = createAgent(provider, { model: 'opus', memoryStore });

const result = await agent.run({
  sessionId: 'abc',
  text: 'Fix the login bug',
  history: messages,
  memories: memoryEntries,
  onProgress: (event) => console.log(event),
  signal: controller.signal,
});

// result.text, result.usage, result.memories
```
