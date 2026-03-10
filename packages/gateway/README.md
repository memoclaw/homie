# @homie/gateway

Routes inbound events from any channel to commands or the task runner. The central dispatch layer between channels and local agent CLIs.

## Components

| Factory                | Purpose                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `createGateway`        | Main event router — resolves sessions, dispatches commands or tasks |
| `createTaskRunner`     | Queues tasks, executes one at a time per chat, with progress heartbeats |
| `createCommandHandler` | Handles `/list`, `/status`, `/abort`, `/delete`, `/help`     |

## Flow

```
InboundEvent (from any channel)
  → Gateway
    ├─ Command? → CommandHandler
    └─ Chat?    → TaskRunner.submit() (queued, runs in background)
```

## Usage

```ts
import { createGateway } from '@homie/gateway';

const gateway = createGateway({ sessionManager, agent, taskStore, usageStore });
await gateway.handleEvent(event, reply, progress);
```
