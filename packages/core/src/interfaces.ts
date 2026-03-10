import type { Message, Session, UsageStats } from './types';

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
  usage?: UsageStats;
  /** True if the provider successfully resumed a prior session */
  resumed?: boolean;
}

export interface ProviderAdapter {
  generate(input: ProviderRequest): Promise<ProviderResponse>;
  /** Lightweight call to generate a session title from first exchange */
  generateTitle?(userMsg: string, assistantMsg: string): Promise<string | null>;
}

// --- Stores ---

export interface SessionStore {
  getOrCreateByChat(channel: string, chatId: string, userId?: string | null): Promise<Session>;
  getById(sessionId: string): Promise<Session | null>;
  appendMessage(message: Message): Promise<void>;
  listRecentMessages(sessionId: string, limit: number): Promise<Message[]>;
  resetSession(channel: string, chatId: string): Promise<string | null>;
  countSessions(): Promise<number>;

  // Multi-session support
  createSession(
    channel: string,
    chatId: string,
    name: string,
    userId?: string | null,
  ): Promise<Session>;
  listSessionsByChat(channel: string, chatId: string): Promise<Session[]>;
  getSessionByName(channel: string, chatId: string, name: string): Promise<Session | null>;
  setActiveSession(channel: string, chatId: string, sessionId: string): Promise<void>;
  getActiveSession(channel: string, chatId: string): Promise<Session | null>;
  setSessionStatus(sessionId: string, status: import('./types').SessionStatus): Promise<void>;
  setTitle(sessionId: string, title: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  resetStuckSessions(): Promise<number>;
}
