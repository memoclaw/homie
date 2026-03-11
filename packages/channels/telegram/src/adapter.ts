import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Attachment,
  ChannelAdapter,
  ChannelTarget,
  ChatMessageEvent,
  EventHandler,
  OutboundMessage,
  ProgressHandler,
} from '@homie/core';
import { ChannelError, getErrorMessage } from '@homie/core';
import { createLogger } from '@homie/observability';
import { Bot } from 'grammy';

const log = createLogger('telegram');

/**
 * Convert standard markdown to Telegram MarkdownV2.
 *
 * Handles: **bold** → *bold*, __italic__ / _italic_ → _italic_,
 * `code`, ```pre```, and escapes all MarkdownV2 special chars
 * in normal text segments.
 */
// Compiled once at module scope to avoid re-creation on every message
const MD_TOKEN_RE = /(```[\s\S]*?```)|(`[^`]+`)|(\*\*(.+?)\*\*)|(__(.+?)__)|(\*(.+?)\*)|(_(.+?)_)/g;

function toMarkdownV2(text: string): string {
  const tokens: { raw: string }[] = [];

  // Tokenise: pull out code blocks, inline code, bold, italic — keep the rest as "text"
  const regex = new RegExp(MD_TOKEN_RE.source, MD_TOKEN_RE.flags);

  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // plain text before this match
    if (match.index > cursor) {
      tokens.push({ raw: escapeV2(text.slice(cursor, match.index)) });
    }

    if (match[1]) {
      // ```code block``` → keep triple backtick, escape inside
      const inner = match[1].slice(3, -3);
      tokens.push({ raw: `\`\`\`${escapeV2Pre(inner)}\`\`\`` });
    } else if (match[2]) {
      // `inline code`
      const inner = match[2].slice(1, -1);
      tokens.push({ raw: `\`${escapeV2Pre(inner)}\`` });
    } else if (match[3] && match[4]) {
      // **bold** → *bold*
      tokens.push({ raw: `*${escapeV2(match[4])}*` });
    } else if (match[5] && match[6]) {
      // __italic__ → _italic_
      tokens.push({ raw: `_${escapeV2(match[6])}_` });
    } else if (match[7] && match[8]) {
      // *italic* (single) — in standard markdown this is italic
      tokens.push({ raw: `_${escapeV2(match[8])}_` });
    } else if (match[9] && match[10]) {
      // _italic_
      tokens.push({ raw: `_${escapeV2(match[10])}_` });
    }

    cursor = match.index + match[0].length;
  }

  // remaining plain text
  if (cursor < text.length) {
    tokens.push({ raw: escapeV2(text.slice(cursor)) });
  }

  return tokens.map((t) => t.raw).join('');
}

/** Escape MarkdownV2 special chars in normal text. */
function escapeV2(s: string): string {
  return s.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/** Escape only backtick and backslash inside pre/code blocks. */
function escapeV2Pre(s: string): string {
  return s.replace(/([`\\])/g, '\\$1');
}

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  json: 'application/json',
  csv: 'text/csv',
};

function mimeFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

export function createTelegramAdapter(opts: {
  botToken: string;
  onEvent: EventHandler;
  dataDir: string;
}): ChannelAdapter {
  const bot = new Bot(opts.botToken);
  const handler = opts.onEvent;
  const attachDir = join(opts.dataDir, 'attachments');
  let authorizedUserId: string | null = null;
  mkdirSync(attachDir, { recursive: true });

  // --- Internal helpers (not exposed on the public interface) ---

  async function sendTyping(chatId: string): Promise<void> {
    try {
      await bot.api.sendChatAction(chatId, 'typing');
    } catch {
      // ignore typing errors
    }
  }

  function buildProgress(chatId: string): ProgressHandler {
    let statusMsgId: number | null = null;

    return {
      async onTyping() {
        await sendTyping(chatId);
      },
      async onStatus(text: string) {
        try {
          if (statusMsgId) {
            await bot.api.editMessageText(chatId, statusMsgId, text).catch(() => {});
          } else {
            const msg = await bot.api.sendMessage(chatId, text);
            statusMsgId = msg.message_id;
          }
        } catch {
          // ignore status errors
        }
      },
    };
  }

  async function sendMessage(target: ChannelTarget, message: OutboundMessage): Promise<void> {
    let text = message.text;
    if (text.length > 4000) {
      text = `${text.slice(0, 4000)}\n...(truncated)`;
    }

    if (message.parseMode) {
      try {
        await bot.api.sendMessage(target.chatId, text, {
          parse_mode: message.parseMode,
        });
        return;
      } catch (err) {
        throw new ChannelError(`Failed to send Telegram message: ${getErrorMessage(err)}`);
      }
    }

    try {
      const mdv2 = toMarkdownV2(text);
      await bot.api.sendMessage(target.chatId, mdv2, {
        parse_mode: 'MarkdownV2',
      });
    } catch {
      try {
        await bot.api.sendMessage(target.chatId, text);
      } catch (err) {
        throw new ChannelError(`Failed to send Telegram message: ${getErrorMessage(err)}`);
      }
    }
  }

  // --- File download ---

  async function downloadFile(fileId: string, fileName?: string): Promise<Attachment | null> {
    try {
      const file = await bot.api.getFile(fileId);
      if (!file.file_path) return null;

      const ext = file.file_path.split('.').pop() ?? 'bin';
      const localName = fileName ?? `${fileId}.${ext}`;
      const localPath = join(attachDir, `${Date.now()}-${localName}`);

      const url = `https://api.telegram.org/file/bot${opts.botToken}/${file.file_path}`;
      const resp = await fetch(url);
      if (!resp.ok) return null;

      await Bun.write(localPath, resp);
      log.debug('Downloaded attachment', { fileId, path: localPath });

      return {
        filePath: localPath,
        mimeType: mimeFromPath(file.file_path),
        fileName: localName,
      };
    } catch (err) {
      log.error('Failed to download file', { fileId, error: getErrorMessage(err) });
      return null;
    }
  }

  // --- Shared message dispatch ---

  function authorizeUser(userId: string | null, chatId: string): boolean {
    if (!userId) {
      log.warn('Rejected Telegram update without sender', { chatId });
      return false;
    }

    if (!authorizedUserId) {
      authorizedUserId = userId;
      log.info('Authorized first Telegram user', { chatId, userId });
      return true;
    }

    if (authorizedUserId !== userId) {
      log.warn('Rejected message from unauthorized Telegram user', { chatId, userId });
      return false;
    }

    return true;
  }

  function buildReplyAndProgress(chatId: string) {
    const reply = async (replyText: string) => {
      await sendMessage({ chatId }, { text: replyText });
    };
    const progress = buildProgress(chatId);
    return { reply, progress };
  }

  async function dispatch(event: ChatMessageEvent, chatId: string): Promise<void> {
    const { reply, progress } = buildReplyAndProgress(chatId);
    await handler(event, reply, progress);
  }

  // --- Message handlers ---

  bot.on('message:text', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const userId = ctx.from ? String(ctx.from.id) : null;
    const text = ctx.message.text;
    const messageId = String(ctx.message.message_id);

    if (!authorizeUser(userId, chatId)) {
      return;
    }

    const cmdMatch = text.match(/^\/(\w+)(?:\s+(.*))?$/s);

    if (cmdMatch) {
      const { reply, progress } = buildReplyAndProgress(chatId);
      await handler(
        {
          type: 'command',
          channel: 'telegram',
          chatId,
          command: cmdMatch[1] ?? '',
          args: (cmdMatch[2] ?? '').trim(),
          rawSourceId: messageId,
        },
        reply,
        progress,
      );
      return;
    }

    await dispatch(
      { type: 'chat', channel: 'telegram', chatId, text, rawSourceId: messageId },
      chatId,
    );
  });

  bot.on('message:photo', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const userId = ctx.from ? String(ctx.from.id) : null;
    const messageId = String(ctx.message.message_id);
    const caption = ctx.message.caption ?? '';

    if (!authorizeUser(userId, chatId)) return;

    // Telegram sends multiple sizes — pick the largest
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    if (!largest) return;

    const attachment = await downloadFile(largest.file_id);
    if (!attachment) {
      await sendMessage({ chatId }, { text: 'Failed to download the image.' });
      return;
    }

    await dispatch(
      {
        type: 'chat',
        channel: 'telegram',
        chatId,
        text: caption || 'Analyze this image',
        rawSourceId: messageId,
        attachments: [attachment],
      },
      chatId,
    );
  });

  bot.on('message:document', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const userId = ctx.from ? String(ctx.from.id) : null;
    const messageId = String(ctx.message.message_id);
    const caption = ctx.message.caption ?? '';
    const doc = ctx.message.document;

    if (!authorizeUser(userId, chatId)) return;

    const attachment = await downloadFile(doc.file_id, doc.file_name ?? undefined);
    if (!attachment) {
      await sendMessage({ chatId }, { text: 'Failed to download the file.' });
      return;
    }

    await dispatch(
      {
        type: 'chat',
        channel: 'telegram',
        chatId,
        text: caption || `Review this file: ${doc.file_name ?? 'document'}`,
        rawSourceId: messageId,
        attachments: [attachment],
      },
      chatId,
    );
  });

  bot.catch((err) => {
    log.error('Bot error', {
      error: err.message,
    });
  });

  return {
    async start() {
      log.info('Starting Telegram adapter (polling)');

      try {
        await bot.api.setMyCommands([
          { command: 'status', description: 'Current request status' },
          { command: 'abort', description: 'Interrupt active request' },
          { command: 'clear', description: 'Start a new session' },
          { command: 'help', description: 'Show help' },
        ]);
      } catch (err) {
        log.warn('Failed to register Telegram commands (will retry on next start)', {
          error: getErrorMessage(err),
        });
      }

      bot.start({
        onStart: () => log.info('Telegram polling started'),
      });
    },

    async stop() {
      log.info('Stopping Telegram adapter');
      bot.stop();
    },

    sendMessage,
  };
}
