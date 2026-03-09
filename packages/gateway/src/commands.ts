import { getErrorMessage } from '@homie/core';
import type { MemoryStore, UsageStore } from '@homie/persistence';
import type { SessionManager } from '@homie/sessions';
import type { AgentRunner } from './agent-runner';
import { formatElapsed, formatTokens, timeSince } from './format';
import type { ProgressHandler, ReplyFn } from '@homie/core';

export interface CommandDeps {
  sessionManager: SessionManager;
  agentRunner: AgentRunner;
  memoryStore?: MemoryStore;
  usageStore?: UsageStore;
  startedAt?: Date;
}

export interface CommandHandler {
  handlePreSession(
    channel: string,
    chatId: string,
    userId: string | null,
    command: string,
    args: string,
    reply: ReplyFn,
  ): Promise<boolean>;
  handlePostSession(
    sessionId: string,
    channel: string,
    chatId: string,
    command: string,
    args: string,
    userId: string | null,
    reply: ReplyFn,
    progress?: ProgressHandler,
  ): Promise<boolean>;
}

function sessionLabel(s: { name: string | null; id: string }): string {
  return s.name ?? s.id.slice(0, 8);
}

export function createCommandHandler(deps: CommandDeps): CommandHandler {
  const { sessionManager, memoryStore, usageStore } = deps;

  async function cmdNew(
    channel: string,
    chatId: string,
    userId: string | null,
    args: string,
    reply: ReplyFn,
  ): Promise<true> {
    const name = args.trim() || `session-${Date.now().toString(36)}`;
    try {
      const session = await sessionManager.createNamedSession(channel, chatId, name, userId);
      await reply(`New session "${name}" created (${session.id.slice(0, 8)})`);
    } catch (err) {
      await reply(getErrorMessage(err));
    }
    return true;
  }

  async function cmdUse(
    channel: string,
    chatId: string,
    args: string,
    reply: ReplyFn,
  ): Promise<true> {
    const nameOrId = args.trim();
    if (!nameOrId) {
      await reply('Usage: /use <session-name>');
      return true;
    }
    try {
      const session = await sessionManager.switchSession(channel, chatId, nameOrId);
      const statusMark = session.status === 'processing' ? ' (busy)' : '';
      await reply(`Switched to "${sessionLabel(session)}"${statusMark}`);
    } catch (err) {
      await reply(getErrorMessage(err));
    }
    return true;
  }

  async function cmdSessions(channel: string, chatId: string, reply: ReplyFn): Promise<true> {
    const sessions = await sessionManager.listSessions(channel, chatId);
    const active = await sessionManager.getActiveSession(channel, chatId);

    if (sessions.length === 0) {
      await reply('No sessions yet. Send a message to start one.');
      return true;
    }

    const lines = sessions.map((s) => {
      const isActive = s.id === active?.id;
      const label = sessionLabel(s);
      const title = s.title ? ` - ${s.title}` : '';
      const status = s.status === 'processing' ? ' [busy]' : '';
      const tag = isActive ? ' [active]' : '';
      const age = timeSince(s.updatedAt);
      return `${label}${title}${status}${tag} (${age} ago)`;
    });

    await reply(`Sessions:\n${lines.join('\n')}`);
    return true;
  }

  async function cmdPing(reply: ReplyFn): Promise<true> {
    const uptime = deps.startedAt
      ? formatElapsed(Math.floor((Date.now() - deps.startedAt.getTime()) / 1000))
      : 'unknown';
    await reply(`Pong! Uptime: ${uptime}`);
    return true;
  }

  async function cmdHelp(reply: ReplyFn): Promise<true> {
    const help = [
      'Available commands:',
      '',
      '/new [name] — Start a new session',
      '/use <name> — Switch to a session',
      '/sessions — List all sessions',
      '/ping — Check if Homie is alive',
      '/status — Show system status',
      '/help — Show this help',
      '',
      'Any other message is treated as a chat with the agent.',
    ].join('\n');
    await reply(help);
    return true;
  }

  async function cmdStatus(
    sessionId: string,
    channel: string,
    chatId: string,
    reply: ReplyFn,
  ): Promise<true> {
    const memoryCount = memoryStore?.count() ?? 0;
    const active = await sessionManager.getActiveSession(channel, chatId);
    const label = active ? sessionLabel(active) : 'none';
    const lines = [`Session: ${label}`, `Memories: ${memoryCount}`];

    if (usageStore) {
      const sessionSummary = usageStore.getSessionSummary(sessionId);
      const lifetime = usageStore.getLifetimeSummary();

      if (sessionSummary.runs > 0) {
        const sessionTokens = sessionSummary.inputTokens + sessionSummary.outputTokens;
        lines.push(
          '',
          `Session (${sessionSummary.runs} runs):`,
          `  Input: ${formatTokens(sessionSummary.inputTokens)}`,
          `  Output: ${formatTokens(sessionSummary.outputTokens)}`,
          `  Cache: ${formatTokens(sessionSummary.cacheReadTokens)} read, ${formatTokens(sessionSummary.cacheCreateTokens)} created`,
          `  Total: ${formatTokens(sessionTokens)}`,
        );
      }
      if (lifetime.runs > 0) {
        const lifetimeTokens = lifetime.inputTokens + lifetime.outputTokens;
        lines.push('', `Lifetime (${lifetime.runs} runs):`, `  Tokens: ${formatTokens(lifetimeTokens)}`);
      }
    }

    await reply(lines.join('\n'));
    return true;
  }

  return {
    async handlePreSession(channel, chatId, userId, command, args, reply) {
      switch (command) {
        case 'new':
          return cmdNew(channel, chatId, userId, args, reply);
        case 'use':
          return cmdUse(channel, chatId, args, reply);
        case 'sessions':
          return cmdSessions(channel, chatId, reply);
        case 'ping':
          return cmdPing(reply);
        default:
          return false;
      }
    },

    async handlePostSession(sessionId, channel, chatId, command, args, userId, reply, progress) {
      switch (command) {
        case 'help':
          return cmdHelp(reply);
        case 'status':
          return cmdStatus(sessionId, channel, chatId, reply);
        default:
          return false;
      }
    },
  };
}
