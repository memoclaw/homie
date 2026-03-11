import { describe, expect, test } from 'bun:test';
import { formatElapsed, toolHint, truncate } from './format';

describe('formatElapsed', () => {
  test('formats seconds only', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(30)).toBe('30s');
    expect(formatElapsed(59)).toBe('59s');
  });

  test('formats minutes and seconds', () => {
    expect(formatElapsed(60)).toBe('1m');
    expect(formatElapsed(90)).toBe('1m 30s');
    expect(formatElapsed(150)).toBe('2m 30s');
  });
});

describe('truncate', () => {
  test('keeps short strings intact', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello', 5)).toBe('hello');
  });

  test('truncates long strings with ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
    expect(truncate('abcdefg', 4)).toBe('a...');
  });
});

describe('toolHint', () => {
  test('maps known tools', () => {
    expect(toolHint('Read')).toBe('Reading files');
    expect(toolHint('Bash')).toBe('Running command');
    expect(toolHint('Edit')).toBe('Editing code');
  });

  test('falls back for unknown tools', () => {
    expect(toolHint('CustomTool')).toBe('Using CustomTool');
  });
});
