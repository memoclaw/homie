# @homie/gateway

Routes inbound events to commands or the agent runner. The central dispatch layer between channels and the agent.

## Components

| Factory              | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `createGateway`      | Main event router — resolves sessions, dispatches commands or agent runs |
| `createAgentRunner`  | Manages background agent runs with interruption, progress heartbeats, memory saving |
| `createCommandHandler` | Handles `/new`, `/use`, `/sessions`, `/ping`, `/status`, `/help` |

## Flow

```
InboundEvent → Gateway
  ├─ Command? → CommandHandler (pre-session or post-session)
  └─ Chat?    → interrupt existing run if busy → AgentRunner.start()
```

## Usage

```ts
import { createGateway } from '@homie/gateway';

const gateway = createGateway({ sessionManager, agent, maxHistoryMessages: 20 });
await gateway.handleEvent(event, reply, progress);
```
