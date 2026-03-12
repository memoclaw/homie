import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigError } from '@homie/core';
import { parse } from 'yaml';
import type { GitHubWorkflowDefinition, LoadedGitHubWorkflow } from './types';

export async function loadGitHubWorkflow(workflowPath: string): Promise<LoadedGitHubWorkflow> {
  const resolvedWorkflowPath = resolve(workflowPath);
  const source = readFileSync(resolvedWorkflowPath, 'utf-8');
  const { frontmatter, body } = splitFrontmatter(source, resolvedWorkflowPath);
  const definition = readWorkflowDefinition(frontmatter, resolvedWorkflowPath);
  const workflowMarkdown = body.trim();

  if (!workflowMarkdown) {
    throw new ConfigError(`GitHub workflow markdown is empty: ${resolvedWorkflowPath}`);
  }

  return {
    definition,
    workflowMarkdown,
    definitionPath: resolvedWorkflowPath,
    workflowPath: resolvedWorkflowPath,
  };
}

function readWorkflowDefinition(
  frontmatter: string,
  workflowPath: string,
): GitHubWorkflowDefinition {
  let parsed: unknown;
  try {
    parsed = parse(frontmatter);
  } catch (err) {
    throw new ConfigError(
      `GitHub workflow frontmatter is invalid: ${workflowPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new ConfigError(`GitHub workflow frontmatter must be an object: ${workflowPath}`);
  }

  const candidate = parsed as GitHubWorkflowDefinition;
  validateWorkflowDefinition(candidate, workflowPath);
  return candidate;
}

function splitFrontmatter(
  source: string,
  workflowPath: string,
): { frontmatter: string; body: string } {
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    throw new ConfigError(`GitHub workflow frontmatter is missing: ${workflowPath}`);
  }

  return {
    frontmatter: match[1] ?? '',
    body: match[2] ?? '',
  };
}

function validateWorkflowDefinition(
  definition: GitHubWorkflowDefinition,
  workflowPath: string,
): void {
  if (!definition.id?.trim()) {
    throw new ConfigError(`GitHub workflow id is required: ${workflowPath}`);
  }
  if (!definition.name?.trim()) {
    throw new ConfigError(`GitHub workflow name is required: ${workflowPath}`);
  }
  if (!Array.isArray(definition.repos) || definition.repos.length === 0) {
    throw new ConfigError(`GitHub workflow repos must not be empty: ${workflowPath}`);
  }
}
