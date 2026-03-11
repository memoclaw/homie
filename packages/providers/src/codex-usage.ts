import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountUsageProvider, AccountUsageWindow } from '@homie/core';
import { createLogger } from '@homie/observability';

const log = createLogger('provider:codex-usage');

const WINDOW_SPECS = [
  { key: 'primary', label: 'Current 5h limit' },
  { key: 'secondary', label: 'Current week' },
] as const;

export function createCodexUsageProvider(): AccountUsageProvider {
  return {
    async getAccountUsage(): Promise<AccountUsageWindow[] | null> {
      try {
        const snapshot = await loadLatestRateLimitSnapshot();
        if (!snapshot) {
          return null;
        }

        const windows: AccountUsageWindow[] = [];
        for (const { key, label } of WINDOW_SPECS) {
          const w = parseRateLimitWindow(snapshot[key], label);
          if (!w) return null;
          windows.push(w);
        }

        return windows;
      } catch (err) {
        log.warn('Codex usage load failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
  };
}

interface RateLimitWindow {
  used_percent?: unknown;
  resets_at?: unknown;
}

interface RateLimitSnapshot {
  primary?: RateLimitWindow;
  secondary?: RateLimitWindow;
}

async function loadLatestRateLimitSnapshot(): Promise<RateLimitSnapshot | null> {
  for (const filePath of walkRecentSessionFiles()) {
    const file = Bun.file(filePath);
    const text = await file.text();
    const snapshot = parseLatestRateLimitSnapshot(text);
    if (snapshot) {
      return snapshot;
    }
  }

  return null;
}

/**
 * Walk session files in reverse-chronological order by directory name,
 * so the caller can short-circuit as soon as a match is found without
 * touching older directories.
 */
function* walkRecentSessionFiles(): Generator<string> {
  const root = getCodexSessionsDir();
  if (!root) return;

  for (const year of reverseSortedDir(root)) {
    const yearPath = join(root, year);
    for (const month of reverseSortedDir(yearPath)) {
      const monthPath = join(yearPath, month);
      for (const day of reverseSortedDir(monthPath)) {
        const dayPath = join(monthPath, day);
        const files = reverseSortedDir(dayPath)
          .filter((name) => name.endsWith('.jsonl'))
          .map((name) => {
            const p = join(dayPath, name);
            return { path: p, mtimeMs: safeStatMtime(p) };
          })
          .sort((a, b) => b.mtimeMs - a.mtimeMs);

        for (const file of files) {
          yield file.path;
        }
      }
    }
  }
}

function reverseSortedDir(dir: string): string[] {
  try {
    const entries = readdirSync(dir);
    return entries.sort().reverse();
  } catch {
    return [];
  }
}

function safeStatMtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function getCodexSessionsDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return home ? join(home, '.codex', 'sessions') : '';
}

function parseLatestRateLimitSnapshot(text: string): RateLimitSnapshot | null {
  const lines = text.split('\n');

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const payload = parsed.payload as Record<string, unknown> | undefined;
      if (payload?.type !== 'token_count') continue;

      const rateLimits = payload.rate_limits;
      if (!rateLimits || typeof rateLimits !== 'object') continue;

      return rateLimits as RateLimitSnapshot;
    } catch {
      // ignore malformed lines
    }
  }

  return null;
}

function parseRateLimitWindow(
  raw: RateLimitWindow | undefined,
  label: string,
): AccountUsageWindow | null {
  if (!raw) return null;
  if (typeof raw.used_percent !== 'number' || typeof raw.resets_at !== 'number') {
    return null;
  }

  return {
    label,
    percentUsed: raw.used_percent,
    resetsAt: new Date(raw.resets_at * 1000).toISOString(),
  };
}
