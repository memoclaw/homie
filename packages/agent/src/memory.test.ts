import { describe, expect, test } from 'bun:test';
import { parseMemoryTags } from './memory';

describe('parseMemoryTags', () => {
  test('returns text unchanged when no tags', () => {
    const result = parseMemoryTags('Hello world');
    expect(result.text).toBe('Hello world');
    expect(result.memories).toEqual([]);
  });

  test('extracts single memory tag', () => {
    const result = parseMemoryTags(
      'Got it! <memory>User prefers TypeScript over JavaScript</memory> I will use TS.',
    );
    expect(result.text).toBe('Got it!  I will use TS.');
    expect(result.memories).toEqual([{ content: 'User prefers TypeScript over JavaScript' }]);
  });

  test('extracts multiple memory tags', () => {
    const result = parseMemoryTags(
      'Sure! <memory>Project uses Bun</memory> And <memory>No classes, only factories</memory> noted.',
    );
    expect(result.memories).toHaveLength(2);
    expect(result.memories[0]?.content).toBe('Project uses Bun');
    expect(result.memories[1]?.content).toBe('No classes, only factories');
  });

  test('handles multiline memory content', () => {
    const result = parseMemoryTags(
      'OK.\n<memory>\nUser preferences:\n- dark mode\n- vim keybindings\n</memory>\nDone.',
    );
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]?.content).toContain('dark mode');
    expect(result.memories[0]?.content).toContain('vim keybindings');
  });

  test('skips empty memory tags', () => {
    const result = parseMemoryTags('Text <memory>  </memory> more text');
    expect(result.memories).toEqual([]);
  });

  test('is case-insensitive', () => {
    const result = parseMemoryTags('Hello <MEMORY>important</MEMORY> world');
    expect(result.memories).toEqual([{ content: 'important' }]);
  });

  test('collapses extra newlines after stripping', () => {
    const result = parseMemoryTags('Hello\n\n<memory>note</memory>\n\nworld');
    expect(result.text).toBe('Hello\n\nworld');
  });
});
