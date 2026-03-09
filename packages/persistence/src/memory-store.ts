import type { Database } from 'bun:sqlite';

export interface MemoryEntry {
  id: string;
  scope: string;
  content: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
  sourceSessionId: string | null;
}

export interface MemoryStore {
  save(entry: MemoryEntry): void;
  search(query: string, scopes: string[], limit?: number): MemoryEntry[];
  list(scopes: string[], limit?: number): MemoryEntry[];
  get(id: string): MemoryEntry | null;
  update(id: string, content: string): boolean;
  delete(id: string): boolean;
  count(): number;
}

interface MemoryRow {
  id: string;
  scope: string;
  content: string;
  tags: string;
  created_at: string;
  updated_at: string;
  source_session_id: string | null;
}

interface CountRow {
  c: number;
}

export function createMemoryStore(db: Database): MemoryStore {
  return {
    save(entry) {
      db.prepare(
        `INSERT INTO memories (id, scope, content, tags, created_at, updated_at, source_session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        entry.id,
        entry.scope,
        entry.content,
        entry.tags,
        entry.createdAt,
        entry.updatedAt,
        entry.sourceSessionId,
      );
    },

    search(query, scopes, limit = 20) {
      const words = query.split(/\s+/).filter(Boolean);
      if (words.length === 0 || scopes.length === 0) return [];

      const scopePlaceholders = scopes.map(() => '?').join(', ');
      const wordClauses = words.map(() => '(content LIKE ? OR tags LIKE ?)');

      const sql = `
        SELECT * FROM memories
        WHERE scope IN (${scopePlaceholders})
          AND ${wordClauses.join(' AND ')}
        ORDER BY updated_at DESC
        LIMIT ?
      `;

      const params: (string | number)[] = [...scopes];
      for (const w of words) {
        const pattern = `%${w}%`;
        params.push(pattern, pattern);
      }
      params.push(limit);

      return (db.prepare(sql).all(...(params as string[])) as MemoryRow[]).map(rowToEntry);
    },

    list(scopes, limit = 50) {
      if (scopes.length === 0) return [];

      const placeholders = scopes.map(() => '?').join(', ');
      return (
        db
          .prepare(
            `SELECT * FROM memories
             WHERE scope IN (${placeholders})
             ORDER BY updated_at DESC
             LIMIT ?`,
          )
          .all(...scopes, limit) as MemoryRow[]
      ).map(rowToEntry);
    },

    get(id) {
      const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as
        | MemoryRow
        | undefined;
      return row ? rowToEntry(row) : null;
    },

    update(id, content) {
      const now = new Date().toISOString();
      const result = db
        .prepare('UPDATE memories SET content = ?, updated_at = ? WHERE id = ?')
        .run(content, now, id);
      return result.changes > 0;
    },

    delete(id) {
      const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
      return result.changes > 0;
    },

    count() {
      return (db.prepare('SELECT COUNT(*) as c FROM memories').get() as CountRow).c;
    },
  };
}

function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    scope: row.scope,
    content: row.content,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceSessionId: row.source_session_id,
  };
}
