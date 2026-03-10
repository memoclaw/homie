import type { Database } from 'bun:sqlite';
import type { Message, Session, SessionStatus, SessionStore } from '@homie/core';

export function createSessionStore(db: Database): SessionStore {
  return {
    async getOrCreateByChat(channel, chatId, userId) {
      const existing = db
        .query('SELECT * FROM sessions WHERE channel = ? AND chat_id = ? LIMIT 1')
        .get(channel, chatId) as SessionRow | null;
      if (existing) return rowToSession(existing);

      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const session: Session = {
        id,
        channel,
        chatId,
        userId: userId ?? null,
        status: 'idle',
        createdAt: now,
        updatedAt: now,
      };

      db.prepare(
        `INSERT INTO sessions (id, channel, chat_id, user_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        session.id,
        session.channel,
        session.chatId,
        session.userId,
        session.status,
        session.createdAt,
        session.updatedAt,
      );

      return session;
    },

    async getById(sessionId) {
      const row = db
        .query('SELECT * FROM sessions WHERE id = ?')
        .get(sessionId) as SessionRow | null;
      return row ? rowToSession(row) : null;
    },

    async setSessionStatus(sessionId, status) {
      db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?').run(
        status,
        new Date().toISOString(),
        sessionId,
      );
    },

    async resetStuckSessions() {
      const result = db
        .prepare("UPDATE sessions SET status = 'idle' WHERE status = 'processing'")
        .run();
      return result.changes;
    },

    async appendMessage(message) {
      db.prepare(
        `INSERT INTO messages (id, session_id, direction, text, created_at, raw_source_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        message.id,
        message.sessionId,
        message.direction,
        message.text,
        message.createdAt,
        message.rawSourceId,
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
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    direction: row.direction as Message['direction'],
    text: row.text,
    createdAt: row.created_at,
    rawSourceId: row.raw_source_id,
  };
}
