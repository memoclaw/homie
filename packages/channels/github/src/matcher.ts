import type { GitHubEventContext, GitHubWorkflowDefinition, GitHubWorkflowMatch } from './types';

export function matchGitHubWorkflow(
  workflow: GitHubWorkflowDefinition,
  event: GitHubEventContext,
): GitHubWorkflowMatch {
  if (!workflow.repos.includes(event.repo)) {
    return { matched: false, reason: `repo ${event.repo} not in workflow scope` };
  }

  if (workflow.subjectTypes && !workflow.subjectTypes.includes(event.subjectType)) {
    return {
      matched: false,
      reason: `subject type ${event.subjectType} not in workflow scope`,
    };
  }

  if (event.actor && workflow.excludeUsers?.includes(event.actor)) {
    return { matched: false, reason: `actor ${event.actor} is excluded` };
  }

  if (workflow.users && workflow.users.length > 0) {
    if (!event.actor || !workflow.users.includes(event.actor)) {
      return {
        matched: false,
        reason: event.actor ? `actor ${event.actor} not in workflow scope` : 'event actor missing',
      };
    }
  }

  return { matched: true };
}
