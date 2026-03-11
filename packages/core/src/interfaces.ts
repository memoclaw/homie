import type { Message, Session } from './types';

// --- Channel ---

export interface ChannelTarget {
  chatId: string;
}

export interface OutboundMessage {
  text: string;
  parseMode?: 'Markdown' | 'HTML';
}

export type ReplyFn = (text: string) => Promise<void>;

export interface ProgressHandler {
  onTyping(): Promise<void>;
  onStatus(text: string): Promise<void>;
}

export type EventHandler = (
  event: import('./events').InboundEvent,
  reply: ReplyFn,
  progress?: ProgressHandler,
) => Promise<void>;

export interface ChannelAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(target: ChannelTarget, message: OutboundMessage): Promise<void>;
}

// --- Provider ---

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | null;
}

// --- Progress ---

export type ProgressEvent =
  | { type: 'tool_start'; toolName: string }
  | { type: 'text_delta'; text: string };

export type ProgressCallback = (event: ProgressEvent) => void;

export interface ProviderRequest {
  messages: ProviderMessage[];
  model: string;
  /** Session ID for CLI providers that support session continuity */
  sessionId?: string;
  /** Whether this session has prior messages (hints CLI to resume) */
  hasHistory?: boolean;
  /** Progress callback for streaming updates */
  onProgress?: ProgressCallback;
  /** Signal to abort the in-flight generation */
  signal?: AbortSignal;
}

export interface ProviderResponse {
  content: string | null;
  /** True if the provider successfully resumed a prior session */
  resumed?: boolean;
}

export interface ProviderAdapter {
  generate(input: ProviderRequest): Promise<ProviderResponse>;
}

// --- Stores ---

export interface SessionStore {
  getOrCreateActiveByChat(channel: string, chatId: string): Promise<Session>;
  startFreshSession(channel: string, chatId: string): Promise<Session>;
  addMessage(
    sessionId: string,
    direction: Message['direction'],
    text: string,
    rawSourceId?: string | null,
  ): Promise<Message>;
  listRecentMessages(sessionId: string, limit: number): Promise<Message[]>;
}
