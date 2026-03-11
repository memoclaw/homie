import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '@homie/observability';
import { schema } from './migrations';

const log = createLogger('persistence');

export function openDatabase(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath, { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  db.exec(`
    INSERT OR IGNORE INTO active_sessions (channel, chat_id, session_id, updated_at)
    SELECT s.channel, s.chat_id, s.id, s.updated_at
    FROM sessions s
    WHERE NOT EXISTS (
      SELECT 1
      FROM sessions newer
      WHERE newer.channel = s.channel
        AND newer.chat_id = s.chat_id
        AND (
          newer.updated_at > s.updated_at
          OR (newer.updated_at = s.updated_at AND newer.created_at > s.created_at)
          OR (
            newer.updated_at = s.updated_at
            AND newer.created_at = s.created_at
            AND newer.id > s.id
          )
        )
    )
  `);

  log.info('Database opened', { path: dbPath });
  return db;
}
