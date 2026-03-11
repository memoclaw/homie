/** Human-readable elapsed time (e.g. "2m 30s") */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Truncate a string with ellipsis if it exceeds maxLen */
export function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? `${str.slice(0, maxLen - 3)}...` : str;
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
