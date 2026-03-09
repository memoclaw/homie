# @homie/agent

Orchestrates provider calls with context assembly. Provider-agnostic — works with any `ProviderAdapter` implementation.

## What it does

1. Builds a message list from system prompt, history, and user input (`buildMessages`)
2. Sends to the provider (any local agent CLI) and streams progress
3. Returns text, usage stats, and resume status

## Usage

```ts
import { createAgent } from '@homie/agent';

const agent = createAgent(provider, { model: 'opus' });

const result = await agent.run({
  sessionId: 'abc',
  text: 'Fix the login bug',
  history: messages,
  onProgress: (event) => console.log(event),
  signal: controller.signal,
});

// result.text, result.usage
```
