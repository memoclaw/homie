import type {
  GitHubNotificationContext,
  GitHubWorkflowDefinition,
  GitHubWorkflowMatch,
} from './types';

export function matchGitHubWorkflow(
  workflow: GitHubWorkflowDefinition,
  notification: GitHubNotificationContext,
): GitHubWorkflowMatch {
  if (!workflow.repos.includes(notification.repo)) {
    return { matched: false, reason: `repo ${notification.repo} not in workflow scope` };
  }

  if (workflow.subjectTypes && !workflow.subjectTypes.includes(notification.subjectType)) {
    return {
      matched: false,
      reason: `subject type ${notification.subjectType} not in workflow scope`,
    };
  }

  if (notification.actor && workflow.excludeUsers?.includes(notification.actor)) {
    return { matched: false, reason: `actor ${notification.actor} is excluded` };
  }

  if (workflow.users && workflow.users.length > 0) {
    if (!notification.actor || !workflow.users.includes(notification.actor)) {
      return {
        matched: false,
        reason: notification.actor
          ? `actor ${notification.actor} not in workflow scope`
          : 'notification actor missing',
      };
    }
  }

  return { matched: true };
}
