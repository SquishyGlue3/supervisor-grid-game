// Tests for wordWrap() — copied verbatim from server.js

function wordWrap(text, width = 70) {
  if (!text) return '  (none)';
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line.length + w.length + 1 > width && line.length > 0) {
      lines.push('  ' + line);
      line = w;
    } else {
      line = line ? line + ' ' + w : w;
    }
  }
  if (line) lines.push('  ' + line);
  return lines.join('\n');
}

describe('wordWrap', () => {
  test('empty string returns "(none)" with indent', () => {
    expect(wordWrap('')).toBe('  (none)');
  });

  test('null returns "(none)" with indent', () => {
    expect(wordWrap(null)).toBe('  (none)');
  });

  test('undefined returns "(none)" with indent', () => {
    expect(wordWrap(undefined)).toBe('  (none)');
  });

  test('short string under default width returns single indented line', () => {
    const result = wordWrap('Hello world');
    expect(result).toBe('  Hello world');
  });

  test('each line is indented with two spaces', () => {
    const long = 'word '.repeat(20).trim(); // forces wrapping
    const lines = wordWrap(long).split('\n');
    lines.forEach(line => {
      expect(line.startsWith('  ')).toBe(true);
    });
  });

  test('long string breaks at word boundary, not mid-word', () => {
    const long = 'The quick brown fox jumps over the lazy dog and then some more text to force wrapping';
    const result = wordWrap(long, 30);
    const lines = result.split('\n');
    // Each line (trimmed) should contain only complete words
    lines.forEach(line => {
      const trimmed = line.trim();
      expect(trimmed.length).toBeGreaterThan(0);
      // no word should be split with a hyphen by this function
      expect(trimmed).not.toMatch(/-$/);
    });
  });

  test('custom width parameter is respected', () => {
    const text = 'one two three four five six seven eight nine ten';
    const result = wordWrap(text, 15);
    const lines = result.split('\n');
    // With width=15, no line content (excluding 2-space indent) should exceed 15 chars
    lines.forEach(line => {
      expect(line.length).toBeLessThanOrEqual(15 + 2); // +2 for indent
    });
  });

  test('single very long word is still output (no splitting)', () => {
    const longWord = 'superlongwordthatexceedswidth';
    const result = wordWrap(longWord, 10);
    expect(result.trim()).toBe(longWord);
  });
});
