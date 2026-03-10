export { type ClaudeCodeConfig, createClaudeCodeProvider } from './claude-code';

export interface ClaudeCodeStatus {
  available: boolean;
  authed: boolean;
  version?: string;
  error?: string;
}

/**
 * Check that the `claude` CLI is installed and authenticated.
 * Runs `claude --version` to verify installation, then a minimal
 * print-mode prompt to verify auth.
 */
export async function checkClaudeCode(): Promise<ClaudeCodeStatus> {
  // 1. Check installation + version
  let version: string | undefined;
  try {
    const proc = Bun.spawn(['claude', '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) {
      return { available: false, authed: false, error: 'claude CLI not found' };
    }
    version = out.trim();
  } catch {
    return { available: false, authed: false, error: 'claude CLI not found' };
  }

  // 2. Check auth by running a minimal prompt
  try {
    const proc = Bun.spawn(
      ['claude', '-p', 'ping', '--output-format', 'text', '--max-turns', '1'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) {
      return { available: true, authed: false, version, error: stderr.trim().slice(0, 200) };
    }
    return { available: true, authed: true, version };
  } catch (err) {
    return {
      available: true,
      authed: false,
      version,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
