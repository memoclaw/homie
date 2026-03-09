import type { Database } from 'bun:sqlite';
import type { Message, Session, SessionStatus, SessionStore } from '@homie/core';

export function createSessionStore(db: Database): SessionStore {
  async function getActiveSession(channel: string, chatId: string): Promise<Session | null> {
    const row = db
      .query(
        `SELECT s.* FROM sessions s
         JOIN active_sessions a ON s.id = a.session_id
         WHERE a.channel = ? AND a.chat_id = ?`,
      )
      .get(channel, chatId) as SessionRow | null;
    return row ? rowToSession(row) : null;
  }

  async function createSession(
    channel: string,
    chatId: string,
    name: string,
    userId?: string | null,
  ): Promise<Session> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const session: Session = {
      id,
      channel,
      chatId,
      userId: userId ?? null,
      kind: 'dm',
      title: null,
      name,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    };

    db.prepare(
      `INSERT INTO sessions (id, channel, chat_id, user_id, kind, title, name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      session.id,
      session.channel,
      session.chatId,
      session.userId,
      session.kind,
      session.title,
      session.name,
      session.status,
      session.createdAt,
      session.updatedAt,
    );

    return session;
  }

  async function setActiveSession(
    channel: string,
    chatId: string,
    sessionId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO active_sessions (channel, chat_id, session_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(channel, chat_id) DO UPDATE SET session_id = ?, updated_at = ?`,
    ).run(channel, chatId, sessionId, now, sessionId, now);
  }

  return {
    async getOrCreateByChat(channel, chatId, userId) {
      const active = await getActiveSession(channel, chatId);
      if (active) return active;

      const session = await createSession(channel, chatId, 'default', userId);
      await setActiveSession(channel, chatId, session.id);
      return session;
    },

    createSession,

    async getById(sessionId) {
      const row = db
        .query('SELECT * FROM sessions WHERE id = ?')
        .get(sessionId) as SessionRow | null;
      return row ? rowToSession(row) : null;
    },

    async listSessionsByChat(channel, chatId) {
      const rows = db
        .query('SELECT * FROM sessions WHERE channel = ? AND chat_id = ? ORDER BY updated_at DESC')
        .all(channel, chatId) as SessionRow[];
      return rows.map(rowToSession);
    },

    async getSessionByName(channel, chatId, name) {
      const row = db
        .query('SELECT * FROM sessions WHERE channel = ? AND chat_id = ? AND name = ?')
        .get(channel, chatId, name) as SessionRow | null;
      return row ? rowToSession(row) : null;
    },

    setActiveSession,
    getActiveSession,

    async setSessionStatus(sessionId, status) {
      db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?').run(
        status,
        new Date().toISOString(),
        sessionId,
      );
    },

    async setTitle(sessionId, title) {
      db.prepare(
        'UPDATE sessions SET title = ?, updated_at = ? WHERE id = ? AND title IS NULL',
      ).run(title, new Date().toISOString(), sessionId);
    },

    async resetStuckSessions() {
      const result = db
        .prepare("UPDATE sessions SET status = 'idle' WHERE status = 'processing'")
        .run();
      return result.changes;
    },

    async appendMessage(message) {
      db.prepare(
        `INSERT INTO messages (id, session_id, direction, text, created_at, raw_source_id, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        message.id,
        message.sessionId,
        message.direction,
        message.text,
        message.createdAt,
        message.rawSourceId,
        JSON.stringify(message.metadata),
      );

      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        message.sessionId,
      );
    },

    async listRecentMessages(sessionId, limit) {
      const rows = db
        .query(
          `SELECT * FROM messages WHERE session_id = ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(sessionId, limit) as MessageRow[];

      return rows.reverse().map(rowToMessage);
    },

    async resetSession(channel, chatId) {
      const active = await getActiveSession(channel, chatId);
      if (!active) return null;

      db.prepare('DELETE FROM active_sessions WHERE channel = ? AND chat_id = ?').run(
        channel,
        chatId,
      );
      db.prepare('DELETE FROM messages WHERE session_id = ?').run(active.id);
      db.prepare('DELETE FROM sessions WHERE id = ?').run(active.id);

      return active.id;
    },

    async countSessions() {
      const row = db.query('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
      return row.count;
    },
  };
}

// --- Row types ---

interface SessionRow {
  id: string;
  channel: string;
  chat_id: string;
  user_id: string | null;
  kind: string;
  title: string | null;
  name: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    channel: row.channel,
    chatId: row.chat_id,
    userId: row.user_id,
    kind: row.kind as Session['kind'],
    title: row.title,
    name: row.name,
    status: (row.status ?? 'idle') as SessionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface MessageRow {
  id: string;
  session_id: string;
  direction: string;
  text: string;
  created_at: string;
  raw_source_id: string | null;
  metadata: string;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    direction: row.direction as Message['direction'],
    text: row.text,
    createdAt: row.created_at,
    rawSourceId: row.raw_source_id,
    metadata: JSON.parse(row.metadata || '{}'),
  };
}
