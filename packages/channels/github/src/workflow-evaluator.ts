import { ChannelError } from '@homie/core';
import type { GitHubWorkflowDecision } from './types';

export function parseGitHubWorkflowDecision(raw: string): GitHubWorkflowDecision {
  const text = raw.trim();
  const jsonText = unwrapJsonBlock(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new ChannelError('GitHub workflow response was not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new ChannelError('GitHub workflow response must be a JSON object');
  }

  const decision = parsed as Record<string, unknown>;
  if (typeof decision.handle !== 'boolean') {
    throw new ChannelError('GitHub workflow response must include boolean "handle"');
  }
  if (typeof decision.reason !== 'string' || !decision.reason.trim()) {
    throw new ChannelError('GitHub workflow response must include string "reason"');
  }

  if (decision.handle) {
    if (decision.action !== undefined && decision.action !== 'reply') {
      throw new ChannelError('GitHub workflow response action must be "reply" when provided');
    }
    if (typeof decision.reply !== 'string' || !decision.reply.trim()) {
      throw new ChannelError(
        'GitHub workflow response must include non-empty "reply" when handle=true',
      );
    }
  }

  return {
    handle: decision.handle,
    reason: decision.reason.trim(),
    action: decision.action === 'reply' ? 'reply' : undefined,
    reply: typeof decision.reply === 'string' ? decision.reply.trim() : undefined,
  };
}

function unwrapJsonBlock(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return text;
}
