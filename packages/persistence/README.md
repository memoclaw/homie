# @homie/persistence

SQLite-backed stores for sessions, messages, key-value data, and usage tracking.

Uses `bun:sqlite` with WAL mode and inline migrations.

## Stores

| Factory              | Purpose                                      |
| -------------------- | -------------------------------------------- |
| `createSessionStore` | Sessions and messages (implements `SessionStore` from core) |
| `createKvStore`      | Simple string key-value store                 |
| `createUsageStore`   | Token usage recording and summaries           |

## Usage

```ts
import { openDatabase, createSessionStore, createKvStore } from '@homie/persistence';

const db = openDatabase('./data/homie.db'); // runs migrations automatically
const sessions = createSessionStore(db);
const kv = createKvStore(db);
```
