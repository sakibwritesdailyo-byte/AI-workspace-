import { Fragment, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import {
  parseMarkdownBlocks,
  type InlineToken,
  type MarkdownBlock,
} from '../utils/markdownParser';

interface MarkdownMessageProps {
  content: string;
  streaming?: boolean;
}

const KEYWORD_SET = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'def',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'fun',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'private',
  'public',
  'return',
  'static',
  'switch',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'val',
  'var',
  'void',
  'while',
  'SELECT',
  'FROM',
  'WHERE',
  'INSERT',
  'UPDATE',
  'DELETE',
]);

function highlightCodeLine(line: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const regex =
    /(\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(line.slice(lastIndex, match.index));
    }
    const word = match[0];
    if (word.startsWith('//') || word.startsWith('#')) {
      tokens.push(
        <span key={keyIdx++} className="text-zinc-500 italic">
          {word}
        </span>,
      );
    } else if (word.startsWith('"') || word.startsWith("'") || word.startsWith('`')) {
      tokens.push(
        <span key={keyIdx++} className="text-emerald-300">
          {word}
        </span>,
      );
    } else if (/^\d/.test(word)) {
      tokens.push(
        <span key={keyIdx++} className="text-amber-300">
          {word}
        </span>,
      );
    } else if (KEYWORD_SET.has(word)) {
      tokens.push(
        <span key={keyIdx++} className="text-sky-300 font-medium">
          {word}
        </span>,
      );
    } else {
      tokens.push(word);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < line.length) {
    tokens.push(line.slice(lastIndex));
  }
  return tokens;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable in restricted contexts
    }
  };

  const lines = code.split('\n');

  return (
    <div className="my-2.5 rounded-xl border border-white/[0.1] bg-[#090B0E] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#11161D] border-b border-white/[0.08]">
        <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={() => void handleCopyCode()}
          aria-label={`Copy ${language || 'code'} snippet`}
          className="min-h-[28px] px-2 rounded-md text-[11px] text-zinc-300 hover:text-emerald-300 hover:bg-white/[0.06] inline-flex items-center gap-1 transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-[12.5px] leading-relaxed font-mono text-zinc-100">
        <code>
          {lines.map((line, idx) => (
            <Fragment key={idx}>
              {highlightCodeLine(line)}
              {idx < lines.length - 1 ? '\n' : null}
            </Fragment>
          ))}
        </code>
      </pre>
    </div>
  );
}

function renderInline(tokens: InlineToken[]): ReactNode[] {
  return tokens.map((token, idx) => {
    switch (token.type) {
      case 'text':
        return <Fragment key={idx}>{token.value}</Fragment>;
      case 'strong':
        return (
          <strong key={idx} className="font-semibold text-zinc-100">
            {renderInline(token.children)}
          </strong>
        );
      case 'em':
        return (
          <em key={idx} className="italic text-zinc-200">
            {renderInline(token.children)}
          </em>
        );
      case 'code':
        return (
          <code
            key={idx}
            className="px-1.5 py-0.5 mx-0.5 rounded bg-white/[0.08] font-mono text-[12.5px] text-emerald-200"
          >
            {token.value}
          </code>
        );
      case 'link':
        return (
          <a
            key={idx}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-300 underline decoration-emerald-400/40 hover:text-emerald-200 break-words"
          >
            {token.label}
          </a>
        );
    }
  });
}

function renderBlocks(blocks: MarkdownBlock[]): ReactNode[] {
  return blocks.map((block, idx) => {
    switch (block.type) {
      case 'heading': {
        const sizeClass =
          block.level === 1
            ? 'text-base font-semibold text-zinc-100 mt-3 mb-1.5'
            : block.level === 2
              ? 'text-[15px] font-semibold text-zinc-100 mt-2.5 mb-1'
              : 'text-sm font-semibold text-zinc-200 mt-2 mb-1';
        return (
          <div key={idx} className={sizeClass}>
            {renderInline(block.tokens)}
          </div>
        );
      }
      case 'paragraph':
        return (
          <p key={idx} className="whitespace-pre-wrap break-words leading-relaxed">
            {renderInline(block.tokens)}
          </p>
        );
      case 'blockquote':
        return (
          <blockquote
            key={idx}
            className="border-l-2 border-emerald-500/50 pl-3 py-0.5 text-zinc-300 space-y-1.5"
          >
            {renderBlocks(block.blocks)}
          </blockquote>
        );
      case 'list':
        if (block.ordered) {
          return (
            <ol key={idx} className="list-decimal pl-5 space-y-1 text-zinc-200">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="leading-relaxed break-words">
                  {renderInline(item)}
                </li>
              ))}
            </ol>
          );
        }
        return (
          <ul key={idx} className="list-disc pl-5 space-y-1 text-zinc-200">
            {block.items.map((item, itemIdx) => (
              <li key={itemIdx} className="leading-relaxed break-words">
                {renderInline(item)}
              </li>
            ))}
          </ul>
        );
      case 'code':
        return <CodeBlock key={idx} language={block.language} code={block.code} />;
      case 'table':
        return (
          <div key={idx} className="overflow-x-auto my-2 rounded-xl border border-white/[0.1]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#11161D] text-zinc-200">
                <tr>
                  {block.headers.map((head, hIdx) => (
                    <th key={hIdx} className="px-3 py-2 border-b border-white/[0.08] font-semibold">
                      {renderInline(head)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {block.rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-white/[0.02]">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-3 py-2 text-zinc-300 align-top">
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'hr':
        return <hr key={idx} className="border-white/[0.08] my-2.5" />;
    }
  });
}

export function MarkdownMessage({ content, streaming = false }: MarkdownMessageProps) {
  const blocks = parseMarkdownBlocks(content);
  return (
    <div className="space-y-2 text-[14px] text-zinc-200">
      {renderBlocks(blocks)}
      {streaming && (
        <span
          aria-hidden="true"
          className="inline-block w-2 h-4 align-middle bg-emerald-400/80 animate-pulse rounded-sm ml-0.5"
        />
      )}
    </div>
  );
}
