import { describe, expect, test } from 'bun:test';
import { loadGitHubWorkflow } from './loader';
import { matchGitHubWorkflow } from './matcher';

describe('loadGitHubWorkflow', () => {
  test('loads workflow definition and markdown from workflow directory', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/pr-review-mentions/WORKFLOW.md');

    expect(workflow.definition.id).toBe('pr-review-mentions');
    expect(workflow.definition.repos.length).toBeGreaterThan(0);
    expect(workflow.workflowMarkdown).toContain('Decision contract');
  });
});

describe('matchGitHubWorkflow', () => {
  test('matches notification within workflow scope', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/pr-review-mentions/WORKFLOW.md');
    const repo = workflow.definition.repos[0] ?? 'unknown/repo';
    const actor = workflow.definition.users?.[0] ?? 'someone';

    const result = matchGitHubWorkflow(workflow.definition, {
      repo,
      actor,
      subjectType: 'PullRequest',
    });

    expect(result).toEqual({ matched: true });
  });

  test('rejects notification outside workflow scope', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/pr-review-mentions/WORKFLOW.md');

    const result = matchGitHubWorkflow(workflow.definition, {
      repo: 'acme/web',
      actor: 'mallory',
      subjectType: 'Issue',
    });

    expect(result.matched).toBe(false);
    expect(result.reason).toContain('repo');
  });
});
