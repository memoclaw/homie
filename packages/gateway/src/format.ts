/** Human-readable elapsed time (e.g. "2m 30s") */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Human-readable time since an ISO timestamp (e.g. "3h") */
export function timeSince(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Format USD cost (e.g. "$0.12", "$0.0042") */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Format token count (e.g. "45.2k", "1.2M") */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return `${count}`;
}

/** Truncate a UUID to a short prefix (e.g. "a1b2c3d4") */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Truncate a string with ellipsis if it exceeds maxLen */
export function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? `${str.slice(0, maxLen - 3)}...` : str;
}

/** Seconds elapsed since an ISO timestamp, formatted human-readable */
export function elapsedSince(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  return formatElapsed(seconds);
}

/** Map a tool name to a human-readable hint */
const TOOL_HINTS: Record<string, string> = {
  Read: 'Reading files',
  Write: 'Writing code',
  Edit: 'Editing code',
  Bash: 'Running command',
  Glob: 'Scanning files',
  Grep: 'Searching code',
  Agent: 'Delegating task',
  WebFetch: 'Fetching web content',
  WebSearch: 'Searching the web',
};

export function toolHint(name: string): string {
  return TOOL_HINTS[name] ?? `Using ${name}`;
}
