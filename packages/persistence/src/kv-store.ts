import type { Database } from 'bun:sqlite';

export interface KvStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function createKvStore(db: Database): KvStore {
  return {
    get(key) {
      const row = db.query('SELECT value FROM kv WHERE key = ?').get(key) as {
        value: string;
      } | null;
      return row?.value ?? null;
    },

    set(key, value) {
      db.prepare(
        `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(key, value, new Date().toISOString());
    },
  };
}
