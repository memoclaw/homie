import type { ProviderAdapter } from '@homie/core';
import { createClaudeCodeProvider } from './claude-code';
import type { CliProviderStatus } from './cli-status';
import { checkCliStatus } from './cli-status';
import { checkCodexCli, createCodexProvider } from './codex';

export { type ClaudeCodeConfig, createClaudeCodeProvider } from './claude-code';
export type { CliProviderStatus } from './cli-status';
export { type CodexConfig, checkCodexCli, createCodexProvider } from './codex';

export type ProviderKind = 'claude-code' | 'codex';

export interface ProviderRuntimeConfig {
  model: string;
  extraArgs?: string[];
}

export interface ProviderRuntime {
  kind: ProviderKind;
  name: string;
  adapter: ProviderAdapter;
}

interface ProviderRuntimeFactory {
  name: string;
  createAdapter(config: ProviderRuntimeConfig): ProviderAdapter;
  check(): Promise<CliProviderStatus>;
}

export async function checkClaudeCode(): Promise<CliProviderStatus> {
  return checkCliStatus({
    command: 'claude',
    authArgs: ['-p', 'ping', '--output-format', 'text', '--max-turns', '1'],
    notFoundMessage: 'claude CLI not found',
  });
}

export function createProviderRuntime(
  config: ProviderRuntimeConfig & { kind: ProviderKind },
): ProviderRuntime {
  const factory = PROVIDER_FACTORIES[config.kind];
  return {
    kind: config.kind,
    name: factory.name,
    adapter: factory.createAdapter(config),
  };
}

const DETECTION_ORDER: ProviderKind[] = ['claude-code', 'codex'];

const PROVIDER_FACTORIES: Record<ProviderKind, ProviderRuntimeFactory> = {
  'claude-code': {
    name: 'Claude Code',
    createAdapter(config) {
      return createClaudeCodeProvider({ model: config.model, extraArgs: config.extraArgs });
    },
    check: checkClaudeCode,
  },
  codex: {
    name: 'Codex CLI',
    createAdapter(config) {
      return createCodexProvider({ model: config.model, extraArgs: config.extraArgs });
    },
    check: checkCodexCli,
  },
};

/**
 * Detect the first available and authenticated provider CLI.
 * Checks in order: claude-code, codex.
 */
export async function detectProvider(
  config: ProviderRuntimeConfig,
): Promise<ProviderRuntime | null> {
  for (const kind of DETECTION_ORDER) {
    const factory = PROVIDER_FACTORIES[kind];
    const status = await factory.check();
    if (status.available && status.authed) {
      return {
        kind,
        name: factory.name,
        adapter: factory.createAdapter(config),
      };
    }
  }
  return null;
}
