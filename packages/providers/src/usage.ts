import type { AccountUsageProvider, AccountUsageWindow } from '@homie/core';
import { createLogger } from '@homie/observability';

const log = createLogger('provider:usage');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';
const CLAUDE_CREDENTIALS_SERVICE = 'Claude Code-credentials';
const CLAUDE_CREDENTIALS_PATH = '.claude/.credentials.json';

const WINDOW_LABELS = {
  fiveHour: 'Current session',
  sevenDay: 'Current week',
} as const;

// --- Factory ---

export function createClaudeUsageProvider(): AccountUsageProvider {
  return {
    async getAccountUsage(): Promise<AccountUsageWindow[] | null> {
      const token = await loadClaudeOAuthToken();
      if (!token) {
        log.debug('No OAuth token found, skipping usage fetch');
        return null;
      }

      try {
        const payload = await fetchUsagePayload(token);
        return mapUsageWindows(payload);
      } catch (err) {
        log.warn('Usage fetch error', { error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    },
  };
}

// --- Credential loading ---

async function loadClaudeOAuthToken(): Promise<string | null> {
  const sources: Array<() => Promise<string | null>> = [
    loadOAuthTokenFromCredentialsFile,
    loadOAuthTokenFromPlatformStore,
  ];

  for (const loadToken of sources) {
    const token = await loadToken();
    if (token) return token;
  }

  return null;
}

async function loadOAuthTokenFromCredentialsFile(): Promise<string | null> {
  try {
    const home = getUserHomeDir();
    if (!home) return null;

    const file = Bun.file(`${home}/${CLAUDE_CREDENTIALS_PATH}`);
    const credentials = (await file.json()) as ClaudeCredentials;
    return getAccessToken(credentials);
  } catch {
    return null;
  }
}

async function loadOAuthTokenFromPlatformStore(): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const proc = Bun.spawn(
      ['security', 'find-generic-password', '-s', CLAUDE_CREDENTIALS_SERVICE, '-w'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (exitCode !== 0) {
      return null;
    }

    const credentials = JSON.parse(stdout.trim()) as ClaudeCredentials;
    return getAccessToken(credentials);
  } catch {
    return null;
  }
}

function getUserHomeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '';
}

function getAccessToken(credentials: ClaudeCredentials | null | undefined): string | null {
  return credentials?.claudeAiOauth?.accessToken ?? null;
}

// --- API client ---

async function fetchUsagePayload(token: string): Promise<UsageApiResponse | null> {
  const response = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': OAUTH_BETA_HEADER,
    },
  });

  if (!response.ok) {
    log.warn('Usage API failed', { status: response.status });
    return null;
  }

  return (await response.json()) as UsageApiResponse;
}

// --- API parsing ---

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string;
  };
}

interface UsageWindowData {
  percentUsed: number;
  resetsAt: string;
}

interface UsageApiResponse {
  five_hour?: unknown;
  seven_day?: unknown;
}

function mapUsageWindows(payload: UsageApiResponse | null): AccountUsageWindow[] | null {
  if (!payload) {
    return null;
  }

  const session = parseWindow(payload.five_hour);
  const week = parseWindow(payload.seven_day);
  if (!session || !week) {
    return null;
  }

  return [
    { label: WINDOW_LABELS.fiveHour, ...session },
    { label: WINDOW_LABELS.sevenDay, ...week },
  ];
}

function parseWindow(raw: unknown): UsageWindowData | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  return {
    percentUsed: typeof r.percent_used === 'number' ? r.percent_used : 0,
    resetsAt: typeof r.resets_at === 'string' ? r.resets_at : '',
  };
}
