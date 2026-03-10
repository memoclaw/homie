import type { Database } from 'bun:sqlite';
import type { UsageStats } from '@homie/core';

export interface UsageRecord {
  id: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number | null;
  model: string | null;
  createdAt: string;
}

export interface UsageSummary {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  totalCostUsd: number;
}

export interface UsageStore {
  record(sessionId: string, usage: UsageStats, model?: string, taskId?: string): void;
  getSessionSummary(sessionId: string): UsageSummary;
  getLifetimeSummary(): UsageSummary;
}

interface SummaryRow {
  runs: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  cost_usd: number;
}

const EMPTY_SUMMARY: UsageSummary = {
  runs: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  totalCostUsd: 0,
};

export function createUsageStore(db: Database): UsageStore {
  return {
    record(sessionId, usage, model, taskId) {
      db.prepare(
        `INSERT INTO usage_log
           (id, session_id, task_id, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cost_usd, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        sessionId,
        taskId ?? null,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheReadTokens,
        usage.cacheCreateTokens,
        usage.costUsd,
        model ?? null,
        new Date().toISOString(),
      );
    },

    getSessionSummary(sessionId) {
      const row = db
        .prepare(
          `SELECT
             COUNT(*) as runs,
             COALESCE(SUM(input_tokens), 0) as input_tokens,
             COALESCE(SUM(output_tokens), 0) as output_tokens,
             COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
             COALESCE(SUM(cache_create_tokens), 0) as cache_create_tokens,
             COALESCE(SUM(cost_usd), 0) as cost_usd
           FROM usage_log
           WHERE session_id = ?`,
        )
        .get(sessionId) as SummaryRow | undefined;

      return row ? rowToSummary(row) : { ...EMPTY_SUMMARY };
    },

    getLifetimeSummary() {
      const row = db
        .prepare(
          `SELECT
             COUNT(*) as runs,
             COALESCE(SUM(input_tokens), 0) as input_tokens,
             COALESCE(SUM(output_tokens), 0) as output_tokens,
             COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
             COALESCE(SUM(cache_create_tokens), 0) as cache_create_tokens,
             COALESCE(SUM(cost_usd), 0) as cost_usd
           FROM usage_log`,
        )
        .get() as SummaryRow | undefined;

      return row ? rowToSummary(row) : { ...EMPTY_SUMMARY };
    },
  };
}

function rowToSummary(row: SummaryRow): UsageSummary {
  return {
    runs: row.runs,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheCreateTokens: row.cache_create_tokens,
    totalCostUsd: row.cost_usd,
  };
}
