import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigError } from '@homie/core';
import { parse } from 'yaml';
import { type AppConfig, AppConfigSchema } from './schema';

function interpolateEnv(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
      return process.env[name] ?? '';
    });
  }
  if (Array.isArray(value)) {
    return value.map(interpolateEnv);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = interpolateEnv(v);
    }
    return result;
  }
  return value;
}

export function loadConfig(configPath?: string): AppConfig {
  const resolvedPath = resolve(configPath ?? 'config/system.yaml');

  let raw: string;
  try {
    raw = readFileSync(resolvedPath, 'utf-8');
  } catch {
    throw new ConfigError(`Cannot read config file: ${resolvedPath}`);
  }

  const parsed = parse(raw);
  const interpolated = interpolateEnv(parsed);
  const result = AppConfigSchema.safeParse(interpolated);

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid config:\n${issues}`);
  }

  return result.data;
}
