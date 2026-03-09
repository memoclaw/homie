const MEMORY_TAG_RE = /<memory>([\s\S]*?)<\/memory>/gi;

export interface ExtractedMemory {
  content: string;
}

export interface ParsedResponse {
  text: string;
  memories: ExtractedMemory[];
}

/**
 * Extract <memory>...</memory> tags from agent response text.
 * Returns the cleaned text (tags stripped) and extracted memories.
 */
export function parseMemoryTags(text: string): ParsedResponse {
  const memories: ExtractedMemory[] = [];

  const cleaned = text.replace(MEMORY_TAG_RE, (_, content: string) => {
    const trimmed = content.trim();
    if (trimmed) {
      memories.push({ content: trimmed });
    }
    return '';
  });

  return {
    text: cleaned.replace(/\n{3,}/g, '\n\n').trim(),
    memories,
  };
}
