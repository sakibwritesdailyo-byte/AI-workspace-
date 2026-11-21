export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: InlineToken[] }
  | { type: 'em'; children: InlineToken[] }
  | { type: 'code'; value: string }
  | { type: 'link'; label: string; href: string };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; tokens: InlineToken[] }
  | { type: 'paragraph'; tokens: InlineToken[] }
  | { type: 'blockquote'; blocks: MarkdownBlock[] }
  | { type: 'list'; ordered: boolean; items: InlineToken[][] }
  | { type: 'code'; language: string; code: string; closed: boolean }
  | { type: 'table'; headers: InlineToken[][]; rows: InlineToken[][][] }
  | { type: 'hr' };

export function sanitizeMarkdownUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'mailto:'
    ) {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function parseInlineMarkdown(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;

  const pushText = (val: string) => {
    if (!val) return;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.type === 'text') {
      prev.value += val;
    } else {
      tokens.push({ type: 'text', value: val });
    }
  };

  while (i < input.length) {
    // Inline code `...`
    if (input[i] === '`') {
      const end = input.indexOf('`', i + 1);
      if (end !== -1) {
        tokens.push({ type: 'code', value: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Markdown link [label](url)
    if (input[i] === '[') {
      const closeBracket = input.indexOf(']', i + 1);
      if (closeBracket !== -1 && input[closeBracket + 1] === '(') {
        const closeParen = input.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const label = input.slice(i + 1, closeBracket);
          const rawHref = input.slice(closeBracket + 2, closeParen);
          const safeHref = sanitizeMarkdownUrl(rawHref);
          if (safeHref) {
            tokens.push({ type: 'link', label: label || safeHref, href: safeHref });
          } else {
            pushText(label || rawHref);
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    // Bold **...** or __...__
    if (input.startsWith('**', i) || input.startsWith('__', i)) {
      const delim = input.slice(i, i + 2);
      const end = input.indexOf(delim, i + 2);
      if (end !== -1 && end > i + 2) {
        tokens.push({
          type: 'strong',
          children: parseInlineMarkdown(input.slice(i + 2, end)),
        });
        i = end + 2;
        continue;
      }
    }

    // Italic *...* or _..._
    if ((input[i] === '*' || input[i] === '_') && input[i + 1] !== input[i]) {
      const delim = input[i];
      const end = input.indexOf(delim, i + 1);
      if (end !== -1 && end > i + 1 && input[end - 1] !== ' ') {
        tokens.push({
          type: 'em',
          children: parseInlineMarkdown(input.slice(i + 1, end)),
        });
        i = end + 1;
        continue;
      }
    }

    pushText(input[i]);
    i += 1;
  }

  return tokens;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  const cells = splitTableRow(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block ```lang
    const fenceMatch = /^```([^\s`]*)\s*$/.exec(trimmed);
    if (fenceMatch) {
      const language = fenceMatch[1] || 'text';
      const codeLines: string[] = [];
      let closed = false;
      i += 1;
      while (i < lines.length) {
        if (/^```\s*$/.test(lines[i].trim())) {
          closed = true;
          i += 1;
          break;
        }
        codeLines.push(lines[i]);
        i += 1;
      }
      blocks.push({
        type: 'code',
        language,
        code: codeLines.join('\n'),
        closed,
      });
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // Heading (# to ####)
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4;
      blocks.push({
        type: 'heading',
        level,
        tokens: parseInlineMarkdown(headingMatch[2]),
      });
      i += 1;
      continue;
    }

    // Markdown Table
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line).map((cell) => parseInlineMarkdown(cell));
      const rows: InlineToken[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]).map((cell) => parseInlineMarkdown(cell)));
        i += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({
        type: 'blockquote',
        blocks: parseMarkdownBlocks(quoteLines.join('\n')),
      });
      continue;
    }

    // Unordered or ordered list
    const ulMatch = /^\s*[-*+]\s+(.+)$/.exec(line);
    const olMatch = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ulMatch || olMatch) {
      const ordered = Boolean(olMatch);
      const items: InlineToken[][] = [];
      const itemRegex = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      while (i < lines.length) {
        const match = itemRegex.exec(lines[i]);
        if (!match) break;
        items.push(parseInlineMarkdown(match[1]));
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph (gather contiguous non-special lines)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      const curTrim = cur.trim();
      if (
        !curTrim ||
        /^```/.test(curTrim) ||
        /^(#{1,4})\s+/.test(curTrim) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(curTrim) ||
        curTrim.startsWith('>') ||
        /^\s*[-*+]\s+/.test(cur) ||
        /^\s*\d+[.)]\s+/.test(cur) ||
        (cur.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
      ) {
        break;
      }
      paraLines.push(cur);
      i += 1;
    }
    blocks.push({
      type: 'paragraph',
      tokens: parseInlineMarkdown(paraLines.join('\n')),
    });
  }

  return blocks;
}
