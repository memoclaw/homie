import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadGitHubWorkflow } from './loader';
import type { LoadedGitHubWorkflow } from './types';

export async function discoverGitHubWorkflows(
  workflowsDir: string,
): Promise<LoadedGitHubWorkflow[]> {
  const paths = listWorkflowPaths(resolve(workflowsDir));
  const workflows = await Promise.all(paths.map((path) => loadGitHubWorkflow(path)));
  return workflows.sort((left, right) => left.definition.id.localeCompare(right.definition.id));
}

function listWorkflowPaths(rootDir: string): string[] {
  const result: string[] = [];

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const path = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listWorkflowPaths(path));
    } else if (entry.isFile() && entry.name === 'WORKFLOW.md') {
      result.push(path);
    }
  }

  return result;
}
