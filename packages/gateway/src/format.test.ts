import { describe, expect, test } from 'bun:test';
import {
  elapsedSince,
  formatCost,
  formatElapsed,
  formatTokens,
  shortId,
  timeSince,
  toolHint,
  truncate,
} from './format';

describe('formatElapsed', () => {
  test('seconds only', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(30)).toBe('30s');
    expect(formatElapsed(59)).toBe('59s');
  });

  test('minutes and seconds', () => {
    expect(formatElapsed(60)).toBe('1m');
    expect(formatElapsed(90)).toBe('1m 30s');
    expect(formatElapsed(150)).toBe('2m 30s');
  });

  test('exact minutes', () => {
    expect(formatElapsed(120)).toBe('2m');
    expect(formatElapsed(300)).toBe('5m');
  });
});

describe('timeSince', () => {
  test('seconds ago', () => {
    const iso = new Date(Date.now() - 30_000).toISOString();
    expect(timeSince(iso)).toBe('30s');
  });

  test('minutes ago', () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(timeSince(iso)).toBe('5m');
  });

  test('hours ago', () => {
    const iso = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(timeSince(iso)).toBe('3h');
  });

  test('days ago', () => {
    const iso = new Date(Date.now() - 2 * 86400_000).toISOString();
    expect(timeSince(iso)).toBe('2d');
  });
});

describe('formatCost', () => {
  test('zero', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  test('small amounts use 4 decimals', () => {
    expect(formatCost(0.0042)).toBe('$0.0042');
    expect(formatCost(0.001)).toBe('$0.0010');
  });

  test('larger amounts use 2 decimals', () => {
    expect(formatCost(0.12)).toBe('$0.12');
    expect(formatCost(1.5)).toBe('$1.50');
  });
});

describe('formatTokens', () => {
  test('small counts', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(999)).toBe('999');
  });

  test('thousands', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(45200)).toBe('45.2k');
  });

  test('millions', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(1_200_000)).toBe('1.2M');
  });
});

describe('shortId', () => {
  test('truncates UUID to 8 chars', () => {
    expect(shortId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('a1b2c3d4');
  });

  test('short string returned as-is', () => {
    expect(shortId('abc')).toBe('abc');
  });

  test('empty string', () => {
    expect(shortId('')).toBe('');
  });
});

describe('truncate', () => {
  test('shorter than maxLen unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  test('equal to maxLen unchanged', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  test('longer than maxLen truncated with ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  test('maxLen 4 leaves 1 char + ellipsis', () => {
    expect(truncate('abcdefg', 4)).toBe('a...');
  });
});

describe('elapsedSince', () => {
  test('recent timestamp', () => {
    const iso = new Date(Date.now() - 30_000).toISOString();
    expect(elapsedSince(iso)).toBe('30s');
  });

  test('minutes ago', () => {
    const iso = new Date(Date.now() - 150_000).toISOString();
    expect(elapsedSince(iso)).toBe('2m 30s');
  });
});

describe('toolHint', () => {
  test('known tools', () => {
    expect(toolHint('Read')).toBe('Reading files');
    expect(toolHint('Bash')).toBe('Running command');
    expect(toolHint('Edit')).toBe('Editing code');
  });

  test('unknown tools', () => {
    expect(toolHint('CustomTool')).toBe('Using CustomTool');
  });
});
