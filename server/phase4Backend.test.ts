import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { GenerateContentResponse } from '@google/genai';
import { createApp } from '../server.ts';
import { buildConversationContext } from './contextManager.ts';
import { extractBearerToken } from './firebaseAuthMiddleware.ts';
import {
  buildGenerateContentConfig,
  classifyGeminiError,
  type GeminiStreamClient,
} from './geminiService.ts';
import { UserRateLimiter } from './rateLimiter.ts';
import { resolveChatModelRouting } from '../src/shared/modelRegistry.ts';

test('modelRegistry resolves active models, legacy aliases, and rejects deprecated models', () => {
  const hydrogen = resolveChatModelRouting({
    requestedModel: 'gemini-4-hydrogen',
    thinkingLevel: 'minimal',
    temperature: 0.7,
  });
  assert.equal(hydrogen.ok, true);
  if (hydrogen.ok) {
    assert.equal(hydrogen.primaryModel, 'gemini-4-hydrogen');
    assert.equal(hydrogen.fallbackModel, 'gemini-3.1-flash-lite');
    // Gemini 4 Hydrogen rejects temperature and maps minimal -> low
    assert.equal(hydrogen.resolvedTemperature, undefined);
    assert.equal(hydrogen.resolvedThinkingLevel, 'low');
  }

  const lite = resolveChatModelRouting({
    requestedModel: 'gemini-3.1-flash-lite',
    thinkingLevel: 'xhigh',
    temperature: 0.3,
  });
  assert.equal(lite.ok, true);
  if (lite.ok) {
    assert.equal(lite.primaryModel, 'gemini-3.1-flash-lite');
    assert.equal(lite.resolvedTemperature, 0.3);
    // Gemini 3.1 Flash Lite clamps xhigh -> high
    assert.equal(lite.resolvedThinkingLevel, 'high');
  }

  const legacy = resolveChatModelRouting({ requestedModel: 'gemini-2.5-flash' });
  assert.equal(legacy.ok, true);
  if (legacy.ok) {
    assert.equal(legacy.primaryModel, 'gemini-4-hydrogen');
    assert.equal(legacy.migratedFrom, 'gemini-2.5-flash');
  }

  const deprecated = resolveChatModelRouting({ requestedModel: 'gemini-1.5-flash' });
  assert.equal(deprecated.ok, false);
  if (!deprecated.ok) {
    assert.equal(deprecated.code, 'invalid_model');
  }

  const unknown = resolveChatModelRouting({ requestedModel: 'gpt-4o' });
  assert.equal(unknown.ok, false);
});

test('buildGenerateContentConfig never passes sampling params on Gemini 4 models', () => {
  const config = buildGenerateContentConfig({
    modelId: 'gemini-4-hydrogen',
    systemInstruction: 'Be concise.',
    thinkingLevel: 'medium',
    temperature: 0.9,
    maxOutputTokens: 2048,
  });
  assert.equal(config.temperature, undefined);
  assert.equal(config.systemInstruction, 'Be concise.');
  assert.equal(config.maxOutputTokens, 2048);
  assert.ok(config.thinkingConfig);
});

test('contextManager maps assistant->model, merges system messages, and trims oldest turns under budget', () => {
  const result = buildConversationContext({
    systemInstruction: 'Base persona',
    maxHistoryChars: 120,
    messages: [
      { role: 'system', content: 'Extra instruction' },
      { role: 'user', content: 'First old message that should be truncated '.repeat(2) },
      { role: 'assistant', content: 'Old assistant reply that should be truncated '.repeat(2) },
      { role: 'user', content: 'Recent question' },
      { role: 'assistant', content: 'Recent answer' },
      { role: 'user', content: 'Follow-up prompt' },
    ],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.context.systemInstruction ?? '', /Base persona/);
    assert.match(result.context.systemInstruction ?? '', /Extra instruction/);
    assert.ok(result.context.truncatedTurnsCount >= 2);
    assert.equal(result.context.contents[0]?.role, 'user');
    const last = result.context.contents[result.context.contents.length - 1];
    assert.equal(last?.role, 'user');
    assert.equal(last?.parts?.[0]?.text, 'Follow-up prompt');
  }

  const trailingAssistant = buildConversationContext({
    messages: [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ],
  });
  assert.equal(trailingAssistant.ok, false);
});

test('UserRateLimiter enforces concurrent and sliding-window caps and releases cleanly', () => {
  let now = 1_000;
  const limiter = new UserRateLimiter(
    { windowMs: 10_000, maxRequestsPerWindow: 3, maxConcurrentPerUser: 1 },
    () => now,
  );

  const first = limiter.tryConsume('uid-1');
  assert.equal(first.allowed, true);
  if (!first.allowed) return;

  // Concurrent cap hit
  const concurrentBlocked = limiter.tryConsume('uid-1');
  assert.equal(concurrentBlocked.allowed, false);
  if (!concurrentBlocked.allowed) {
    assert.equal(concurrentBlocked.reason, 'concurrent_limit');
  }

  first.release();
  assert.equal(limiter.getActiveCount('uid-1'), 0);

  const second = limiter.tryConsume('uid-1');
  assert.equal(second.allowed, true);
  if (second.allowed) second.release();

  const third = limiter.tryConsume('uid-1');
  assert.equal(third.allowed, true);
  if (third.allowed) third.release();

  // Window cap hit (3 within 10s)
  const windowBlocked = limiter.tryConsume('uid-1');
  assert.equal(windowBlocked.allowed, false);
  if (!windowBlocked.allowed) {
    assert.equal(windowBlocked.reason, 'window_limit');
    assert.ok(windowBlocked.retryAfterSeconds >= 1);
  }

  // Advances past window
  now += 10_001;
  const fourth = limiter.tryConsume('uid-1');
  assert.equal(fourth.allowed, true);
  if (fourth.allowed) fourth.release();
});

test('extractBearerToken and classifyGeminiError map errors accurately', () => {
  assert.equal(extractBearerToken(undefined).ok, false);
  assert.equal(extractBearerToken('Basic abc').ok, false);
  const valid = extractBearerToken('Bearer tok_123');
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.token, 'tok_123');

  assert.equal(
    classifyGeminiError(Object.assign(new Error('PERMISSION_DENIED'), { status: 403 })).code,
    'invalid_api_key',
  );
  assert.equal(
    classifyGeminiError(Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 })).code,
    'quota_exceeded',
  );
  assert.equal(
    classifyGeminiError(Object.assign(new Error('NOT_FOUND'), { status: 404 })).code,
    'model_not_found',
  );
});

async function startTestServer(app: ReturnType<typeof createApp>): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind ephemeral port.');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('API routes enforce Firebase auth, validate payloads, stream SSE, and auto-fallback on pre-token quota error', async () => {
  let attemptCount = 0;
  const mockClient: GeminiStreamClient = {
    async generateContentStream({ model, contents }) {
      attemptCount += 1;
      const lastText = contents[contents.length - 1]?.parts?.[0]?.text ?? '';
      if (lastText.includes('TRIGGER_QUOTA') && model === 'gemini-4-hydrogen') {
        const quotaErr = Object.assign(new Error('429 RESOURCE_EXHAUSTED'), { status: 429 });
        throw quotaErr;
      }

      async function* gen(): AsyncIterable<GenerateContentResponse> {
        yield { text: 'Hello ', candidates: [] } as unknown as GenerateContentResponse;
        yield {
          text: 'from Gemini!',
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 5,
            totalTokenCount: 17,
          },
        } as unknown as GenerateContentResponse;
      }
      return gen();
    },
  };

  const app = createApp({
    verifyIdToken: async (token) => {
      if (token === 'expired') {
        throw Object.assign(new Error('Token expired'), { code: 'auth/id-token-expired' });
      }
      if (token !== 'valid-token') {
        throw Object.assign(new Error('Invalid token'), { code: 'auth/argument-error' });
      }
      return { uid: 'user-verified-1', email: 'dev@example.com', email_verified: true };
    },
    geminiClient: mockClient,
    checkGeminiConfigured: () => true,
  });

  const srv = await startTestServer(app);
  try {
    // 1. Health & models endpoints
    const healthRes = await fetch(`${srv.baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = (await healthRes.json()) as { ok: boolean; geminiConfigured: boolean };
    assert.equal(health.ok, true);
    assert.equal(health.geminiConfigured, true);

    const modelsRes = await fetch(`${srv.baseUrl}/api/models`);
    assert.equal(modelsRes.status, 200);
    const modelsBody = (await modelsRes.json()) as { models: Array<{ id: string }> };
    assert.ok(modelsBody.models.some((m) => m.id === 'gemini-4-hydrogen'));

    // 2. Reject missing/expired/invalid tokens
    const unauth = await fetch(`${srv.baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-4-hydrogen', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(unauth.status, 401);

    const expired = await fetch(`${srv.baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer expired',
      },
      body: JSON.stringify({ model: 'gemini-4-hydrogen', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(expired.status, 401);
    const expiredBody = (await expired.json()) as { code: string };
    assert.equal(expiredBody.code, 'auth_expired');

    // 3. Reject unsupported model with 400
    const badModel = await fetch(`${srv.baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({
        model: 'gemini-1.5-flash',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    assert.equal(badModel.status, 400);

    // 4. Stream SSE events cleanly
    const sseRes = await fetch(`${srv.baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({
        model: 'gemini-4-hydrogen',
        messages: [{ role: 'user', content: 'Say hi' }],
      }),
    });
    assert.equal(sseRes.status, 200);
    assert.match(sseRes.headers.get('content-type') || '', /text\/event-stream/);
    const sseText = await sseRes.text();
    assert.match(sseText, /event: meta/);
    assert.match(sseText, /event: delta/);
    assert.match(sseText, /Hello /);
    assert.match(sseText, /from Gemini!/);
    assert.match(sseText, /event: done/);

    // 5. Auto-fallback when primary returns 429 before emitting any delta
    const fbRes = await fetch(`${srv.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({
        model: 'gemini-4-hydrogen',
        fallbackModel: 'gemini-3.1-flash-lite',
        autoFallback: true,
        messages: [{ role: 'user', content: 'TRIGGER_QUOTA test' }],
      }),
    });
    assert.equal(fbRes.status, 200);
    const fbBody = (await fbRes.json()) as {
      ok: boolean;
      reply: string;
      modelUsed: string;
      fallbackUsed: boolean;
      usage: { totalTokens?: number };
    };
    assert.equal(fbBody.ok, true);
    assert.equal(fbBody.reply, 'Hello from Gemini!');
    assert.equal(fbBody.modelUsed, 'gemini-3.1-flash-lite');
    assert.equal(fbBody.fallbackUsed, true);
    assert.equal(fbBody.usage.totalTokens, 17);
    assert.equal(attemptCount, 3);
  } finally {
    await srv.close();
  }
});

test('API returns honest 503 missing_api_key when GEMINI_API_KEY is absent', async () => {
  const app = createApp({
    verifyIdToken: async () => ({ uid: 'u1' }),
    checkGeminiConfigured: () => false,
  });
  const srv = await startTestServer(app);
  try {
    const res = await fetch(`${srv.baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer any',
      },
      body: JSON.stringify({
        model: 'gemini-4-hydrogen',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, 'missing_api_key');
  } finally {
    await srv.close();
  }
});
