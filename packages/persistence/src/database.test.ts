import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database';

describe('openDatabase', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('backfills active session with the latest session per chat', () => {
    const dir = mkdtempSync(join(tmpdir(), 'homie-db-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'homie.db');

    const seed = new Database(dbPath, { create: true });
    seed.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    seed
      .prepare(
        `INSERT INTO sessions (id, channel, chat_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('older', 'telegram', 'chat1', '2026-03-11T10:00:00.000Z', '2026-03-11T10:00:00.000Z');
    seed
      .prepare(
        `INSERT INTO sessions (id, channel, chat_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('newer', 'telegram', 'chat1', '2026-03-11T11:00:00.000Z', '2026-03-11T11:00:00.000Z');
    seed.close();

    const db = openDatabase(dbPath);
    const active = db
      .query('SELECT session_id FROM active_sessions WHERE channel = ? AND chat_id = ?')
      .get('telegram', 'chat1') as { session_id: string };

    expect(active.session_id).toBe('newer');
    db.close();
  });
});
