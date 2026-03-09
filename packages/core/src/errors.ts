export class HomieError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'HomieError';
  }
}

export class ConfigError extends HomieError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class PersistenceError extends HomieError {
  constructor(message: string) {
    super(message, 'PERSISTENCE_ERROR');
    this.name = 'PersistenceError';
  }
}

export class ProviderError extends HomieError {
  constructor(message: string) {
    super(message, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
  }
}

export class ChannelError extends HomieError {
  constructor(message: string) {
    super(message, 'CHANNEL_ERROR');
    this.name = 'ChannelError';
  }
}

export class AbortError extends HomieError {
  constructor(message = 'Operation was interrupted') {
    super(message, 'ABORT_ERROR');
    this.name = 'AbortError';
  }
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
