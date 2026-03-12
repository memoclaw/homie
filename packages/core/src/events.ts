export interface Attachment {
  /** Absolute path to the downloaded file on disk */
  filePath: string;
  /** MIME type (e.g. "image/png", "application/pdf") */
  mimeType: string;
  /** Original filename if available */
  fileName?: string;
}

export interface ChatMessageEvent {
  type: 'chat';
  channel: string;
  chatId: string;
  text: string;
  rawSourceId: string | null;
  agentModel?: string | null;
  attachments?: Attachment[];
}

export interface CommandEvent {
  type: 'command';
  channel: string;
  chatId: string;
  command: string;
  args: string;
  rawSourceId: string | null;
}

export type InboundEvent = ChatMessageEvent | CommandEvent;
