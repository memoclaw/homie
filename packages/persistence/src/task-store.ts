import type { Database } from 'bun:sqlite';
import type { Task, TaskStore, TaskWithText } from '@homie/core';

export function createTaskStore(db: Database): TaskStore {
  return {
    async createTask({ channel, chatId, userId, sessionId, messageId }) {
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO tasks (id, channel, chat_id, user_id, session_id, message_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
      ).run(id, channel, chatId, userId, sessionId, messageId, now, now);
      return {
        id,
        channel,
        chatId,
        userId,
        sessionId,
        messageId,
        status: 'queued' as const,
        createdAt: now,
        updatedAt: now,
      };
    },

    async getTask(taskId) {
      const row = db.query('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | null;
      return row ? rowToTask(row) : null;
    },

    async getRunningTask(channel, chatId) {
      const row = db
        .query(
          `SELECT t.*, m.text AS message_text FROM tasks t
           LEFT JOIN messages m ON t.message_id = m.id
           WHERE t.channel = ? AND t.chat_id = ? AND t.status = 'running'
           ORDER BY t.created_at DESC LIMIT 1`,
        )
        .get(channel, chatId) as TaskWithTextRow | null;
      return row ? rowToTaskWithText(row) : null;
    },

    async getQueuedTasks(channel, chatId) {
      const rows = db
        .query(
          `SELECT * FROM tasks WHERE channel = ? AND chat_id = ? AND status = 'queued'
           ORDER BY created_at ASC`,
        )
        .all(channel, chatId) as TaskRow[];
      return rows.map(rowToTask);
    },

    async listTasks(channel, chatId, limit = 10) {
      const rows = db
        .query(
          `SELECT t.*, m.text AS message_text FROM tasks t
           LEFT JOIN messages m ON t.message_id = m.id
           WHERE t.channel = ? AND t.chat_id = ?
           ORDER BY t.created_at DESC LIMIT ?`,
        )
        .all(channel, chatId, limit) as TaskWithTextRow[];
      return rows.map(rowToTaskWithText);
    },

    async updateTaskStatus(taskId, status) {
      db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(
        status,
        new Date().toISOString(),
        taskId,
      );
    },

    async resetStuckTasks() {
      const result = db
        .prepare(
          "UPDATE tasks SET status = 'failed', updated_at = ? WHERE status IN ('running', 'queued')",
        )
        .run(new Date().toISOString());
      return result.changes;
    },
  };
}

// --- Row types ---

interface TaskRow {
  id: string;
  channel: string;
  chat_id: string;
  user_id: string | null;
  session_id: string;
  message_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface TaskWithTextRow extends TaskRow {
  message_text: string | null;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    channel: row.channel,
    chatId: row.chat_id,
    userId: row.user_id,
    sessionId: row.session_id,
    messageId: row.message_id,
    status: row.status as Task['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTaskWithText(row: TaskWithTextRow): TaskWithText {
  return {
    ...rowToTask(row),
    text: row.message_text ?? null,
  };
}
