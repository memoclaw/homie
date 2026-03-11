import type { ReplyFn } from '@homie/core';
import { formatElapsed, truncate } from './format';
import type { RequestRunner } from './request-runner';

export interface CommandDeps {
  requestRunner: RequestRunner;
}

export interface CommandContext {
  channel: string;
  chatId: string;
  command: string;
  args: string;
  reply: ReplyFn;
}

export interface CommandHandler {
  handle(ctx: CommandContext): Promise<boolean>;
}

export function createCommandHandler(deps: CommandDeps): CommandHandler {
  const { requestRunner } = deps;

  async function cmdStatus(ctx: CommandContext): Promise<true> {
    const active = requestRunner.getStatus(ctx.channel, ctx.chatId);
    if (!active) {
      await ctx.reply('No active request.');
      return true;
    }

    const elapsed = Math.round((Date.now() - active.startedAt) / 1000);
    const hint = active.lastToolHint ? `\n${active.lastToolHint}` : '';
    await ctx.reply(`Working for ${formatElapsed(elapsed)}${hint}\n${truncate(active.text, 80)}`);
    return true;
  }

  async function cmdAbort(ctx: CommandContext): Promise<true> {
    const aborted = await requestRunner.abort(ctx.channel, ctx.chatId);
    await ctx.reply(aborted ? 'Request interrupted.' : 'No active request to interrupt.');
    return true;
  }

  async function cmdClear(ctx: CommandContext): Promise<true> {
    await requestRunner.resetSession(ctx.channel, ctx.chatId);
    await ctx.reply('Started a new session.');
    return true;
  }

  async function cmdHelp(ctx: CommandContext): Promise<true> {
    const help = [
      'Send any message and Homie will work on it.',
      '',
      'Commands:',
      '/status — Current request',
      '/abort — Interrupt active request',
      '/clear — Start a new session',
      '/help — Show this help',
    ].join('\n');
    await ctx.reply(help);
    return true;
  }

  return {
    async handle(ctx) {
      switch (ctx.command) {
        case 'status':
          return cmdStatus(ctx);
        case 'abort':
          return cmdAbort(ctx);
        case 'clear':
          return cmdClear(ctx);
        case 'help':
        case 'start':
          return cmdHelp(ctx);
        default:
          return false;
      }
    },
  };
}
