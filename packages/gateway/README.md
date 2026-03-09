# @homie/gateway

Routes inbound events from any channel to commands or the agent runner. The central dispatch layer between channels and local agent CLIs.

## Components

| Factory              | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `createGateway`      | Main event router — resolves sessions, dispatches commands or agent runs |
| `createAgentRunner`  | Manages background agent runs with interruption and progress heartbeats |
| `createCommandHandler` | Handles `/new`, `/use`, `/sessions`, `/ping`, `/status`, `/help` |

## Flow

```
InboundEvent (from any channel)
  → Gateway
    ├─ Command? → CommandHandler (pre-session or post-session)
    └─ Chat?    → interrupt existing run if busy → AgentRunner.start()
```

## Usage

```ts
import { createGateway } from '@homie/gateway';

const gateway = createGateway({ sessionManager, agent });
await gateway.handleEvent(event, reply, progress);
```
