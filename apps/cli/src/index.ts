import type { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { loadConfig } from '@homie/config';
import { createKvStore, createSessionStore, openDatabase } from '@homie/persistence';

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === 'help') {
  console.log(`Homie CLI

Usage:
  bun run cli status    — Show system status
  bun run cli sessions  — List all sessions
  bun run cli help      — Show this help`);
  process.exit(0);
}

const config = loadConfig();
const dbPath = resolve(config.app.dataDir, 'homie.db');

let db: Database;
try {
  db = openDatabase(dbPath);
} catch (err) {
  console.error('Cannot open database. Is the data directory initialized?');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const sessionStore = createSessionStore(db);
const kvStore = createKvStore(db);

switch (command) {
  case 'status': {
    const sessionCount = await sessionStore.countSessions();
    const lastStartup = kvStore.get('lastStartup') ?? 'unknown';

    console.log('Homie Status');
    console.log('============');
    console.log(`Sessions:      ${sessionCount}`);
    console.log(`Last startup:  ${lastStartup}`);
    break;
  }

  case 'sessions': {
    const sessions = db.query('SELECT * FROM sessions ORDER BY updated_at DESC').all() as Array<{
      id: string;
      channel: string;
      chat_id: string;
      kind: string;
      updated_at: string;
    }>;

    if (sessions.length === 0) {
      console.log('No sessions.');
    } else {
      for (const s of sessions) {
        console.log(
          `[${s.id.slice(0, 8)}] ${s.channel} chat:${s.chat_id} (${s.kind}) updated:${s.updated_at}`,
        );
      }
    }
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run "bun run cli help" for usage.');
    process.exit(1);
}

db.close();
