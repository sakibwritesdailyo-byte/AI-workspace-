import type { Content } from '@google/genai';

export interface IncomingChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface PreparedConversationContext {
  contents: Content[];
  systemInstruction: string | undefined;
  truncatedTurnsCount: number;
  totalInputChars: number;
}

const DEFAULT_MAX_SYSTEM_CHARS = 8_000;
const DEFAULT_MAX_MESSAGE_CHARS = 24_000;
const DEFAULT_MAX_HISTORY_CHARS = 48_000;
const DEFAULT_MAX_TURNS = 40;

export function sanitizeSystemInstruction(
  systemInstruction: unknown,
  inlineSystemMessages: string[] = [],
  maxChars = DEFAULT_MAX_SYSTEM_CHARS,
): string | undefined {
  const parts: string[] = [];
  if (typeof systemInstruction === 'string' && systemInstruction.trim()) {
    parts.push(systemInstruction.trim());
  }
  for (const extra of inlineSystemMessages) {
    if (extra.trim()) {
      parts.push(extra.trim());
    }
  }
  if (parts.length === 0) return undefined;
  const combined = parts.join('\n\n');
  return combined.length > maxChars ? combined.slice(0, maxChars) : combined;
}

function clampText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[Truncated ${omitted} characters to fit context budget]`;
}

export function buildConversationContext(input: {
  messages: unknown;
  systemInstruction?: unknown;
  maxHistoryChars?: number;
  maxMessageChars?: number;
  maxTurns?: number;
}): { ok: true; context: PreparedConversationContext } | { ok: false; message: string } {
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    return {
      ok: false,
      message: 'At least one conversation message is required.',
    };
  }

  const maxHistoryChars = input.maxHistoryChars ?? DEFAULT_MAX_HISTORY_CHARS;
  const maxMessageChars = input.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS;
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;

  const inlineSystemNotes: string[] = [];
  const normalizedTurns: Array<{ role: 'user' | 'model'; text: string }> = [];

  for (let i = 0; i < input.messages.length; i += 1) {
    const raw = input.messages[i];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, message: `Invalid message entry at index ${i}.` };
    }
    const msg = raw as Partial<IncomingChatMessage>;
    if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system') {
      return { ok: false, message: `Unsupported message role "${String(msg.role)}" at index ${i}.` };
    }
    if (typeof msg.content !== 'string') {
      return { ok: false, message: `Message at index ${i} must have string content.` };
    }
    const trimmed = msg.content.trim();
    if (!trimmed) continue;

    if (msg.role === 'system') {
      inlineSystemNotes.push(trimmed);
      continue;
    }

    const mappedRole = msg.role === 'assistant' ? 'model' : 'user';
    const safeText = clampText(trimmed, maxMessageChars);

    // Coalesce consecutive turns with the same role to maintain valid user/model alternation
    const prev = normalizedTurns[normalizedTurns.length - 1];
    if (prev && prev.role === mappedRole) {
      prev.text = clampText(`${prev.text}\n\n${safeText}`, maxMessageChars);
    } else {
      normalizedTurns.push({ role: mappedRole, text: safeText });
    }
  }

  if (normalizedTurns.length === 0) {
    return { ok: false, message: 'Message content cannot be empty.' };
  }

  // Ensure the final turn belongs to the user when prompting for a reply
  const lastTurn = normalizedTurns[normalizedTurns.length - 1];
  if (lastTurn.role !== 'user') {
    return {
      ok: false,
      message: 'The latest non-empty message in a chat request must be a user prompt.',
    };
  }

  // Select most recent turns within turn count and character budget
  const keptReversed: Array<{ role: 'user' | 'model'; text: string }> = [];
  let charBudgetUsed = 0;
  let truncatedTurnsCount = 0;

  for (let i = normalizedTurns.length - 1; i >= 0; i -= 1) {
    const turn = normalizedTurns[i];
    const isLatestTurn = i === normalizedTurns.length - 1;
    const wouldExceedTurns = keptReversed.length >= maxTurns;
    const wouldExceedChars = charBudgetUsed + turn.text.length > maxHistoryChars;

    if (!isLatestTurn && (wouldExceedTurns || wouldExceedChars)) {
      truncatedTurnsCount = i + 1;
      break;
    }

    const boundedText =
      isLatestTurn && turn.text.length > maxHistoryChars
        ? clampText(turn.text, maxHistoryChars)
        : turn.text;

    keptReversed.push({ role: turn.role, text: boundedText });
    charBudgetUsed += boundedText.length;
  }

  const keptTurns = keptReversed.reverse();
  // Gemini conversations should begin with a user turn when possible
  while (keptTurns.length > 1 && keptTurns[0].role !== 'user') {
    keptTurns.shift();
    truncatedTurnsCount += 1;
  }

  const contents: Content[] = keptTurns.map((t) => ({
    role: t.role,
    parts: [{ text: t.text }],
  }));

  const finalChars = keptTurns.reduce((sum, t) => sum + t.text.length, 0);

  return {
    ok: true,
    context: {
      contents,
      systemInstruction: sanitizeSystemInstruction(input.systemInstruction, inlineSystemNotes),
      truncatedTurnsCount,
      totalInputChars: finalChars,
    },
  };
}
