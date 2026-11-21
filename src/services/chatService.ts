import type { ThinkingLevelOption } from '../shared/modelRegistry';
import type { ChatMessage, TokenUsageSummary } from '../types/workspace';
import { getFirebaseServices } from './firebase/firebaseConfig';

export type ChatErrorCode =
  | 'offline'
  | 'auth_required'
  | 'rate_limited'
  | 'invalid_request'
  | 'invalid_model'
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'quota_exceeded'
  | 'model_not_found'
  | 'safety_blocked'
  | 'aborted'
  | 'timeout'
  | 'backend_unavailable'
  | 'network_error'
  | 'upstream_error';

export type ChatSendResult =
  | {
      ok: true;
      reply: string;
      modelUsed: string;
      fallbackUsed: boolean;
      usage: TokenUsageSummary | null;
      truncatedTurnsCount: number;
    }
  | {
      ok: false;
      code: ChatErrorCode;
      message: string;
      retryable: boolean;
      partialReply?: string;
      modelUsed?: string;
    };

export interface ChatRequestConfig {
  model: string;
  fallbackModel?: string;
  autoFallback?: boolean;
  thinkingLevel?: ThinkingLevelOption;
  temperature: number;
  maxOutputTokens?: number;
  systemInstruction: string;
  messages: Pick<ChatMessage, 'role' | 'content'>[];
}

export interface ChatStreamCallbacks {
  signal?: AbortSignal;
  onMeta?: (meta: {
    modelUsed: string;
    fallbackUsed: boolean;
    migratedFrom: string | null;
    truncatedTurnsCount: number;
  }) => void;
  onDelta?: (delta: string, accumulated: string) => void;
  onUsage?: (usage: TokenUsageSummary) => void;
}

export interface ChatService {
  readonly backendEndpoint: string;
  readonly streamEndpoint: string;
  sendMessage(config: ChatRequestConfig): Promise<ChatSendResult>;
  streamMessage(config: ChatRequestConfig, callbacks?: ChatStreamCallbacks): Promise<ChatSendResult>;
}

export interface ChatServiceDependencies {
  fetchFn?: typeof fetch;
  getAuthToken?: (forceRefresh?: boolean) => Promise<string | null>;
  isOnline?: () => boolean;
}

interface ParsedSseEvent {
  event: string;
  data: string;
}

export function extractSseEventsFromBuffer(
  buffer: string,
  flushAll = false,
): { events: ParsedSseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const events: ParsedSseEvent[] = [];
  let cursor = 0;

  while (true) {
    const boundary = normalized.indexOf('\n\n', cursor);
    if (boundary === -1) break;
    const rawBlock = normalized.slice(cursor, boundary);
    cursor = boundary + 2;
    const parsed = parseSingleSseBlock(rawBlock);
    if (parsed) events.push(parsed);
  }

  let rest = normalized.slice(cursor);
  if (flushAll && rest.trim()) {
    const parsed = parseSingleSseBlock(rest);
    if (parsed) events.push(parsed);
    rest = '';
  }

  return { events, rest };
}

function parseSingleSseBlock(block: string): ParsedSseEvent | null {
  const lines = block.split('\n');
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() || 'message';
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  return { event: eventName, data: dataLines.join('\n') };
}

async function defaultGetAuthToken(forceRefresh = false): Promise<string | null> {
  const services = getFirebaseServices();
  const user = services?.auth.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

function defaultIsOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function mapHttpFailureCode(status: number, serverCode?: string): ChatErrorCode {
  if (
    serverCode === 'auth_missing' ||
    serverCode === 'auth_malformed' ||
    serverCode === 'auth_invalid' ||
    serverCode === 'auth_expired' ||
    status === 401
  ) {
    return 'auth_required';
  }
  if (serverCode === 'rate_limited' || serverCode === 'quota_exceeded' || status === 429) {
    return serverCode === 'quota_exceeded' ? 'quota_exceeded' : 'rate_limited';
  }
  if (serverCode === 'invalid_model' || serverCode === 'model_not_found') {
    return serverCode;
  }
  if (serverCode === 'missing_api_key' || serverCode === 'invalid_api_key') {
    return serverCode;
  }
  if (serverCode === 'safety_blocked') return 'safety_blocked';
  if (serverCode === 'timeout' || status === 504) return 'timeout';
  if (status === 400) return 'invalid_request';
  if (status === 404 || status === 503) return 'backend_unavailable';
  return 'upstream_error';
}

export class BrowserChatService implements ChatService {
  readonly backendEndpoint = '/api/chat';
  readonly streamEndpoint = '/api/chat/stream';

  private readonly fetchFn: typeof fetch;
  private readonly getAuthToken: (forceRefresh?: boolean) => Promise<string | null>;
  private readonly isOnline: () => boolean;

  constructor(deps: ChatServiceDependencies = {}) {
    this.fetchFn = deps.fetchFn ?? ((...args) => fetch(...args));
    this.getAuthToken = deps.getAuthToken ?? defaultGetAuthToken;
    this.isOnline = deps.isOnline ?? defaultIsOnline;
  }

  async sendMessage(config: ChatRequestConfig): Promise<ChatSendResult> {
    return this.streamMessage(config);
  }

  async streamMessage(
    config: ChatRequestConfig,
    callbacks: ChatStreamCallbacks = {},
  ): Promise<ChatSendResult> {
    if (!this.isOnline()) {
      return {
        ok: false,
        code: 'offline',
        retryable: true,
        message:
          'You are offline. Your message has been saved locally in IndexedDB, and Gemini responses require an internet connection.',
      };
    }

    if (callbacks.signal?.aborted) {
      return {
        ok: false,
        code: 'aborted',
        retryable: false,
        partialReply: '',
        message: 'Response generation was cancelled.',
      };
    }

    let token: string | null = null;
    try {
      token = await this.getAuthToken(false);
    } catch {
      token = null;
    }

    if (!token) {
      return {
        ok: false,
        code: 'auth_required',
        retryable: false,
        message:
          'Your message was saved locally in IndexedDB. Sign in with your workspace account to send prompts to Gemini.',
      };
    }

    const executeRequest = async (bearerToken: string): Promise<Response> =>
      this.fetchFn(this.streamEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({
          ...config,
          stream: true,
        }),
        signal: callbacks.signal,
      });

    let accumulated = '';
    let resolvedModel = config.model;
    let fallbackUsed = false;
    let truncatedTurnsCount = 0;
    let usage: TokenUsageSummary | null = null;

    try {
      let response = await executeRequest(token);

      // Retry once with forced token refresh on 401 in case cached JWT expired
      if (response.status === 401) {
        try {
          const refreshed = await this.getAuthToken(true);
          if (refreshed && refreshed !== token) {
            response = await executeRequest(refreshed);
          }
        } catch {
          // Proceed with original 401 response handling
        }
      }

      if (!response.ok) {
        let serverCode: string | undefined;
        let serverMsg: string | undefined;
        try {
          const errJson = (await response.json()) as { code?: string; message?: string };
          serverCode = errJson.code;
          serverMsg = errJson.message;
        } catch {
          // Non-JSON error body
        }

        const mappedCode = mapHttpFailureCode(response.status, serverCode);
        return {
          ok: false,
          code: mappedCode,
          retryable:
            mappedCode === 'rate_limited' ||
            mappedCode === 'quota_exceeded' ||
            mappedCode === 'timeout' ||
            mappedCode === 'upstream_error',
          message:
            serverMsg ||
            `Gemini chat endpoint returned HTTP ${response.status}. Your message remains saved locally.`,
        };
      }

      const contentType = response.headers.get('content-type') || '';

      // Graceful JSON response support if server or test responds with JSON directly
      if (contentType.includes('application/json')) {
        const payload = (await response.json()) as {
          ok?: boolean;
          reply?: string;
          modelUsed?: string;
          fallbackUsed?: boolean;
          usage?: TokenUsageSummary | null;
          truncatedTurnsCount?: number;
          code?: string;
          message?: string;
        };

        if (payload.ok === false || !payload.reply) {
          const code = mapHttpFailureCode(502, payload.code);
          return {
            ok: false,
            code,
            retryable: code !== 'auth_required' && code !== 'missing_api_key',
            message: payload.message || 'Chat endpoint returned an empty response.',
          };
        }

        const used = payload.modelUsed || config.model;
        callbacks.onMeta?.({
          modelUsed: used,
          fallbackUsed: Boolean(payload.fallbackUsed),
          migratedFrom: null,
          truncatedTurnsCount: payload.truncatedTurnsCount ?? 0,
        });
        callbacks.onDelta?.(payload.reply, payload.reply);
        if (payload.usage) callbacks.onUsage?.(payload.usage);

        return {
          ok: true,
          reply: payload.reply,
          modelUsed: used,
          fallbackUsed: Boolean(payload.fallbackUsed),
          usage: payload.usage ?? null,
          truncatedTurnsCount: payload.truncatedTurnsCount ?? 0,
        };
      }

      if (!contentType.includes('text/event-stream') || !response.body) {
        return {
          ok: false,
          code: 'backend_unavailable',
          retryable: true,
          message: `Unexpected response format from ${this.streamEndpoint}. Your message remains saved locally.`,
        };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamErrorEvent: {
        code: ChatErrorCode;
        message: string;
        retryable: boolean;
      } | null = null;
      let receivedDone = false;

      const handleParsedEvent = (ev: ParsedSseEvent) => {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(ev.data) as Record<string, unknown>;
        } catch {
          return;
        }

        if (ev.event === 'meta') {
          if (typeof parsed.modelUsed === 'string' && parsed.modelUsed) {
            resolvedModel = parsed.modelUsed;
          }
          fallbackUsed = Boolean(parsed.fallbackUsed);
          if (typeof parsed.truncatedTurnsCount === 'number') {
            truncatedTurnsCount = parsed.truncatedTurnsCount;
          }
          callbacks.onMeta?.({
            modelUsed: resolvedModel,
            fallbackUsed,
            migratedFrom: typeof parsed.migratedFrom === 'string' ? parsed.migratedFrom : null,
            truncatedTurnsCount,
          });
        } else if (ev.event === 'delta') {
          const text = typeof parsed.text === 'string' ? parsed.text : '';
          if (text) {
            accumulated += text;
            callbacks.onDelta?.(text, accumulated);
          }
        } else if (ev.event === 'usage') {
          usage = parsed as TokenUsageSummary;
          callbacks.onUsage?.(usage);
        } else if (ev.event === 'done') {
          receivedDone = true;
          if (typeof parsed.modelUsed === 'string' && parsed.modelUsed) {
            resolvedModel = parsed.modelUsed;
          }
          if (typeof parsed.fallbackUsed === 'boolean') {
            fallbackUsed = parsed.fallbackUsed;
          }
          if (parsed.usage && typeof parsed.usage === 'object') {
            usage = parsed.usage as TokenUsageSummary;
            callbacks.onUsage?.(usage);
          }
          if (typeof parsed.truncatedTurnsCount === 'number') {
            truncatedTurnsCount = parsed.truncatedTurnsCount;
          }
        } else if (ev.event === 'error') {
          const rawCode = typeof parsed.code === 'string' ? parsed.code : 'upstream_error';
          const status = typeof parsed.status === 'number' ? parsed.status : 502;
          streamErrorEvent = {
            code: mapHttpFailureCode(status, rawCode),
            retryable: Boolean(parsed.retryable ?? true),
            message:
              typeof parsed.message === 'string'
                ? parsed.message
                : 'Stream interrupted by an upstream error.',
          };
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const extracted = extractSseEventsFromBuffer(buffer, false);
        buffer = extracted.rest;
        for (const ev of extracted.events) {
          handleParsedEvent(ev);
        }
        if (streamErrorEvent || receivedDone) break;
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        const flushed = extractSseEventsFromBuffer(buffer, true);
        for (const ev of flushed.events) {
          handleParsedEvent(ev);
        }
      }

      if (streamErrorEvent) {
        const err = streamErrorEvent as {
          code: ChatErrorCode;
          message: string;
          retryable: boolean;
        };
        return {
          ok: false,
          code: err.code,
          retryable: err.retryable,
          partialReply: accumulated,
          modelUsed: resolvedModel,
          message: err.message,
        };
      }

      if (!accumulated.trim()) {
        return {
          ok: false,
          code: 'upstream_error',
          retryable: true,
          partialReply: '',
          modelUsed: resolvedModel,
          message: 'Gemini stream ended before returning any response text.',
        };
      }

      return {
        ok: true,
        reply: accumulated,
        modelUsed: resolvedModel,
        fallbackUsed,
        usage,
        truncatedTurnsCount,
      };
    } catch (err) {
      if (
        callbacks.signal?.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        return {
          ok: false,
          code: 'aborted',
          retryable: false,
          partialReply: accumulated,
          modelUsed: resolvedModel,
          message: 'Response generation was stopped.',
        };
      }

      return {
        ok: false,
        code: 'network_error',
        retryable: true,
        partialReply: accumulated,
        modelUsed: resolvedModel,
        message:
          accumulated.trim().length > 0
            ? 'Connection interrupted while streaming response. Partial output is shown below.'
            : `Unable to reach ${this.streamEndpoint}. Your message remains saved locally in IndexedDB.`,
      };
    }
  }
}

export const chatService: ChatService = new BrowserChatService();
