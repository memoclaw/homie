export interface CliProviderStatus {
  available: boolean;
  authed: boolean;
  version?: string;
  error?: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface CliStatusCheckOptions {
  command: string;
  versionArgs?: string[];
  authArgs: string[];
  notFoundMessage: string;
}

export async function checkCliStatus(options: CliStatusCheckOptions): Promise<CliProviderStatus> {
  const version = await getCliVersion(
    options.command,
    options.versionArgs,
    options.notFoundMessage,
  );
  if (!version.available) {
    return version;
  }

  return getCliAuthStatus(options.command, options.authArgs, version.version);
}

async function getCliVersion(
  command: string,
  versionArgs: string[] | undefined,
  notFoundMessage: string,
): Promise<CliProviderStatus> {
  try {
    const result = await runCommand(command, versionArgs ?? ['--version']);
    if (result.exitCode !== 0) {
      return { available: false, authed: false, error: notFoundMessage };
    }

    return {
      available: true,
      authed: false,
      version: result.stdout.trim(),
    };
  } catch {
    return { available: false, authed: false, error: notFoundMessage };
  }
}

async function getCliAuthStatus(
  command: string,
  authArgs: string[],
  version: string | undefined,
): Promise<CliProviderStatus> {
  try {
    const result = await runCommand(command, authArgs);
    if (result.exitCode !== 0) {
      return {
        available: true,
        authed: false,
        version,
        error: getStatusError(result),
      };
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

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  const proc = Bun.spawn([command, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

function getStatusError(result: CommandResult): string {
  return result.stderr.trim().slice(0, 200) || result.stdout.trim().slice(0, 200);
}
