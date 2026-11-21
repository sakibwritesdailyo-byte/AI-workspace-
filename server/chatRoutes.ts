import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import {
  CHAT_MODEL_CATALOG,
  DEFAULT_CHAT_MODEL,
  resolveChatModelRouting,
  type ThinkingLevelOption,
} from '../src/shared/modelRegistry.ts';
import { buildConversationContext } from './contextManager.ts';
import {
  createFirebaseAuthMiddleware,
  isFirebaseAdminAuthReady,
  type AuthenticatedRequest,
  type VerifyIdTokenFn,
} from './firebaseAuthMiddleware.ts';
import {
  isGeminiConfigured,
  streamGeminiChat,
  type GeminiStreamClient,
} from './geminiService.ts';
import { UserRateLimiter } from './rateLimiter.ts';

export interface ChatRouterDependencies {
  verifyIdToken?: VerifyIdTokenFn;
  geminiClient?: GeminiStreamClient;
  rateLimiter?: UserRateLimiter;
  checkGeminiConfigured?: () => boolean;
}

interface RawChatRequestBody {
  model?: unknown;
  fallbackModel?: unknown;
  autoFallback?: unknown;
  thinkingLevel?: unknown;
  temperature?: unknown;
  maxOutputTokens?: unknown;
  systemInstruction?: unknown;
  messages?: unknown;
  stream?: unknown;
}

function writeSseEvent(res: Response, event: string, data: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function parseThinkingLevel(raw: unknown): ThinkingLevelOption | undefined {
  if (
    raw === 'auto' ||
    raw === 'minimal' ||
    raw === 'low' ||
    raw === 'medium' ||
    raw === 'high' ||
    raw === 'xhigh'
  ) {
    return raw;
  }
  return undefined;
}

export function createApiRouter(deps: ChatRouterDependencies = {}): Router {
  const router = express.Router();
  const authMiddleware = createFirebaseAuthMiddleware(deps.verifyIdToken);
  const rateLimiter =
    deps.rateLimiter ??
    new UserRateLimiter({
      windowMs: 60_000,
      maxRequestsPerWindow: 20,
      maxConcurrentPerUser: 2,
    });
  const checkGemini = deps.checkGeminiConfigured ?? isGeminiConfigured;

  router.use(express.json({ limit: '1mb' }));

  // Malformed JSON handler specific to /api/*
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        ok: false,
        code: 'invalid_json',
        message: 'Request body contains malformed JSON.',
      });
      return;
    }
    next(err);
  });

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      status: 'ready',
      geminiConfigured: checkGemini(),
      firebaseAuthConfigured: isFirebaseAdminAuthReady(),
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/models', (_req, res) => {
    res.json({
      ok: true,
      defaultModel: DEFAULT_CHAT_MODEL,
      models: CHAT_MODEL_CATALOG,
    });
  });

  const handleChatExecution = async (
    req: AuthenticatedRequest,
    res: Response,
    forceStream: boolean,
  ): Promise<void> => {
    const uid = req.auth?.uid;
    if (!uid) {
      res.status(401).json({
        ok: false,
        code: 'auth_missing',
        message: 'Authenticated user context is missing.',
      });
      return;
    }

    const body = (req.body ?? {}) as RawChatRequestBody;
    const routing = resolveChatModelRouting({
      requestedModel: typeof body.model === 'string' ? body.model : undefined,
      fallbackModel: typeof body.fallbackModel === 'string' ? body.fallbackModel : undefined,
      autoFallback: typeof body.autoFallback === 'boolean' ? body.autoFallback : true,
      thinkingLevel: parseThinkingLevel(body.thinkingLevel),
      temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
      maxOutputTokens: typeof body.maxOutputTokens === 'number' ? body.maxOutputTokens : undefined,
    });

    if (!routing.ok) {
      res.status(400).json({
        ok: false,
        code: routing.code,
        message: routing.message,
      });
      return;
    }

    const prepared = buildConversationContext({
      messages: body.messages,
      systemInstruction: body.systemInstruction,
      maxHistoryChars: routing.capability.maxInputChars,
    });

    if (!prepared.ok) {
      res.status(400).json({
        ok: false,
        code: 'invalid_request',
        message: prepared.message,
      });
      return;
    }

    if (!deps.geminiClient && !checkGemini()) {
      res.status(503).json({
        ok: false,
        code: 'missing_api_key',
        message:
          'Server GEMINI_API_KEY is not configured. Configure GEMINI_API_KEY in Settings > Secrets to enable Gemini responses.',
      });
      return;
    }

    const limitResult = rateLimiter.tryConsume(uid);
    if (!limitResult.allowed) {
      res.setHeader('Retry-After', String(limitResult.retryAfterSeconds));
      res.status(429).json({
        ok: false,
        code: 'rate_limited',
        retryAfterSeconds: limitResult.retryAfterSeconds,
        message: limitResult.message,
      });
      return;
    }

    const acceptHeader = req.header('accept') || '';
    const wantsStream =
      forceStream || body.stream === true || acceptHeader.includes('text/event-stream');
    const requestId = crypto.randomUUID();
    const abortController = new AbortController();

    let released = false;
    const releaseSlot = () => {
      if (!released) {
        released = true;
        limitResult.release();
      }
    };

    req.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
      releaseSlot();
    });
    res.on('close', releaseSlot);
    res.on('finish', releaseSlot);

    if (wantsStream) {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      let metaSent = false;
      const result = await streamGeminiChat(
        {
          routing,
          contents: prepared.context.contents,
          systemInstruction: prepared.context.systemInstruction,
          signal: abortController.signal,
          onMeta: (meta) => {
            metaSent = true;
            writeSseEvent(res, 'meta', {
              requestId,
              modelRequested: routing.requestedModel,
              modelUsed: meta.modelUsed,
              fallbackUsed: meta.fallbackUsed,
              migratedFrom: meta.migratedFrom,
              truncatedTurnsCount: prepared.context.truncatedTurnsCount,
            });
          },
          onDelta: (text) => {
            writeSseEvent(res, 'delta', { text });
          },
        },
        deps.geminiClient,
      );

      if (abortController.signal.aborted || res.destroyed) {
        releaseSlot();
        if (!res.writableEnded) res.end();
        return;
      }

      if (result.ok) {
        if (result.usage) {
          writeSseEvent(res, 'usage', result.usage);
        }
        writeSseEvent(res, 'done', {
          requestId,
          modelUsed: result.modelUsed,
          fallbackUsed: result.fallbackUsed,
          finishReason: result.finishReason,
          usage: result.usage,
          truncatedTurnsCount: prepared.context.truncatedTurnsCount,
        });
      } else {
        if (!metaSent) {
          writeSseEvent(res, 'meta', {
            requestId,
            modelRequested: routing.requestedModel,
            modelUsed: result.modelAttempted,
            fallbackUsed: false,
            migratedFrom: routing.migratedFrom,
            truncatedTurnsCount: prepared.context.truncatedTurnsCount,
          });
        }
        writeSseEvent(res, 'error', {
          requestId,
          code: result.error.code,
          status: result.error.status,
          retryable: result.error.retryable,
          message: result.error.message,
          partialReply: result.partialReply,
        });
      }

      releaseSlot();
      res.end();
      return;
    }

    // Standard JSON request mode
    let fallbackUsed = false;
    let modelUsed = routing.primaryModel;
    const result = await streamGeminiChat(
      {
        routing,
        contents: prepared.context.contents,
        systemInstruction: prepared.context.systemInstruction,
        signal: abortController.signal,
        onMeta: (meta) => {
          modelUsed = meta.modelUsed;
          fallbackUsed = meta.fallbackUsed;
        },
        onDelta: () => {
          // Accumulated in result.reply for non-streaming response
        },
      },
      deps.geminiClient,
    );

    releaseSlot();
    if (abortController.signal.aborted || res.destroyed) {
      return;
    }

    if (!result.ok) {
      res.status(result.error.status >= 400 && result.error.status < 600 ? result.error.status : 502).json({
        ok: false,
        requestId,
        code: result.error.code,
        retryable: result.error.retryable,
        message: result.error.message,
      });
      return;
    }

    res.json({
      ok: true,
      requestId,
      reply: result.reply,
      modelUsed: result.modelUsed || modelUsed,
      fallbackUsed: result.fallbackUsed || fallbackUsed,
      migratedFrom: routing.migratedFrom,
      finishReason: result.finishReason,
      usage: result.usage,
      truncatedTurnsCount: prepared.context.truncatedTurnsCount,
    });
  };

  router.post('/chat/stream', authMiddleware, (req, res) => {
    void handleChatExecution(req as AuthenticatedRequest, res, true);
  });

  router.post('/chat', authMiddleware, (req, res) => {
    void handleChatExecution(req as AuthenticatedRequest, res, false);
  });

  router.use((_req, res) => {
    res.status(404).json({
      ok: false,
      code: 'not_found',
      message: 'API endpoint not found.',
    });
  });

  return router;
}
