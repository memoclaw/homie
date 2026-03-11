import type { Database } from 'bun:sqlite';
import type { Message, Session, SessionStore } from '@homie/core';

export function createSessionStore(db: Database): SessionStore {
  return {
    async getOrCreateActiveByChat(channel, chatId) {
      const existing = db
        .query(
          `SELECT s.* FROM active_sessions a
           JOIN sessions s ON s.id = a.session_id
           WHERE a.channel = ? AND a.chat_id = ? LIMIT 1`,
        )
        .get(channel, chatId) as SessionRow | null;
      if (existing) return rowToSession(existing);
      return createSession(db, channel, chatId);
    },

    async startFreshSession(channel, chatId) {
      return createSession(db, channel, chatId);
    },

    async addMessage(sessionId, direction, text, rawSourceId) {
      const message: Message = {
        id: crypto.randomUUID(),
        sessionId,
        direction,
        text,
        createdAt: new Date().toISOString(),
        rawSourceId: rawSourceId ?? null,
      };

      db.transaction(() => {
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
          message.createdAt,
          message.sessionId,
        );
      })();

      return message;
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
  };
}

// --- Row types ---

interface SessionRow {
  id: string;
  channel: string;
  chat_id: string;
  created_at: string;
  updated_at: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    channel: row.channel,
    chatId: row.chat_id,
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

function createSession(db: Database, channel: string, chatId: string): Session {
  const now = new Date().toISOString();
  const session: Session = {
    id: crypto.randomUUID(),
    channel,
    chatId,
    createdAt: now,
    updatedAt: now,
  };

  db.transaction(() => {
    db.prepare(
      `INSERT INTO sessions (id, channel, chat_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(session.id, session.channel, session.chatId, session.createdAt, session.updatedAt);

    db.prepare(
      `INSERT INTO active_sessions (channel, chat_id, session_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(channel, chat_id)
       DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`,
    ).run(channel, chatId, session.id, now);
  })();

  return session;
}
