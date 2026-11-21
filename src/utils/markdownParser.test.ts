import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInlineMarkdown, parseMarkdownBlocks, sanitizeMarkdownUrl } from './markdownParser';

test('parseMarkdownBlocks handles headings, lists, tables, and fenced code blocks including unclosed streaming fences', () => {
  const md = [
    '# Title',
    '',
    '- First **bold** item',
    '- Second `inline` item',
    '',
    '| Col A | Col B |',
    '| --- | --- |',
    '| val 1 | val 2 |',
    '',
    '```ts',
    'const x: number = 42;',
    '```',
  ].join('\n');

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].type, 'list');
  assert.equal(blocks[2].type, 'table');
  assert.equal(blocks[3].type, 'code');
  if (blocks[3].type === 'code') {
    assert.equal(blocks[3].language, 'ts');
    assert.equal(blocks[3].closed, true);
    assert.equal(blocks[3].code, 'const x: number = 42;');
  }

  // Unclosed fence while streaming
  const streamingBlocks = parseMarkdownBlocks('Here is code:\n\n```python\nprint("hi")');
  assert.equal(streamingBlocks[1].type, 'code');
  if (streamingBlocks[1].type === 'code') {
    assert.equal(streamingBlocks[1].language, 'python');
    assert.equal(streamingBlocks[1].closed, false);
  }
});

test('sanitizeMarkdownUrl blocks javascript/data URLs and preserves https links', () => {
  assert.equal(sanitizeMarkdownUrl('https://ai.google.dev/'), 'https://ai.google.dev/');
  assert.equal(sanitizeMarkdownUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeMarkdownUrl('data:text/html,<script>alert(1)</script>'), null);

  const tokens = parseInlineMarkdown('[Click](javascript:alert(1)) and [Docs](https://example.com)');
  assert.equal(tokens.some((t) => t.type === 'link' && t.label === 'Click'), false);
  assert.equal(
    tokens.some((t) => t.type === 'link' && t.href === 'https://example.com/'),
    true,
  );
});
