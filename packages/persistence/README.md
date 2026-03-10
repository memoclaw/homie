# @homie/persistence

SQLite-backed stores for sessions, tasks, messages, key-value data, and usage tracking.

Uses `bun:sqlite` with WAL mode and inline migrations.

## Stores

| Factory              | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `createSessionStore` | Sessions and messages (implements `SessionStore`)     |
| `createTaskStore`    | Task queue and history (implements `TaskStore`)       |
| `createKvStore`      | Simple string key-value store                         |
| `createUsageStore`   | Token usage recording and summaries                   |

## Usage

```ts
import { openDatabase, createSessionStore, createTaskStore, createKvStore } from '@homie/persistence';

const db = openDatabase('./data/homie.db'); // runs migrations automatically
const sessions = createSessionStore(db);
const tasks = createTaskStore(db);
const kv = createKvStore(db);
```
