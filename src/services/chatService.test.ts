import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserChatService, extractSseEventsFromBuffer } from './chatService';
import { createInitialWorkspaceState, workspaceReducer } from '../state/workspaceReducer';

function makeSseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

test('extractSseEventsFromBuffer parses split SSE blocks cleanly', () => {
  const first = extractSseEventsFromBuffer('event: meta\ndata: {"modelUsed":"gemini-4-hydrogen"}\n\nevent: del');
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].event, 'meta');
  const second = extractSseEventsFromBuffer(`${first.rest}ta\ndata: {"text":"Hi"}\n\n`);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].event, 'delta');
  assert.equal(second.events[0].data, '{"text":"Hi"}');
});

test('BrowserChatService enforces offline & auth checks and handles 401 token refresh retry', async () => {
  let fetchCalled = false;
  const offlineSvc = new BrowserChatService({
    isOnline: () => false,
    getAuthToken: async () => 'tok',
    fetchFn: async () => {
      fetchCalled = true;
      return new Response('{}');
    },
  });
  const offlineRes = await offlineSvc.streamMessage({
    model: 'gemini-4-hydrogen',
    temperature: 0.4,
    systemInstruction: '',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(offlineRes.ok, false);
  if (!offlineRes.ok) assert.equal(offlineRes.code, 'offline');
  assert.equal(fetchCalled, false);

  const signedOutSvc = new BrowserChatService({
    isOnline: () => true,
    getAuthToken: async () => null,
    fetchFn: async () => {
      fetchCalled = true;
      return new Response('{}');
    },
  });
  const authRes = await signedOutSvc.streamMessage({
    model: 'gemini-4-hydrogen',
    temperature: 0.4,
    systemInstruction: '',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(authRes.ok, false);
  if (!authRes.ok) assert.equal(authRes.code, 'auth_required');
  assert.equal(fetchCalled, false);

  // 401 -> force token refresh -> retry succeeds with SSE stream
  let attempts = 0;
  const deltas: string[] = [];
  const refreshSvc = new BrowserChatService({
    isOnline: () => true,
    getAuthToken: async (forceRefresh) => (forceRefresh ? 'fresh-token' : 'stale-token'),
    fetchFn: async (_url, init) => {
      attempts += 1;
      const authHeader = (init?.headers as Record<string, string>)?.Authorization;
      if (authHeader === 'Bearer stale-token') {
        return new Response(JSON.stringify({ ok: false, code: 'auth_expired', message: 'Expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return makeSseResponse([
        'event: meta\ndata: {"modelUsed":"gemini-4-hydrogen","fallbackUsed":false,"truncatedTurnsCount":0}\n\n',
        'event: delta\ndata: {"text":"Streamed "}\n\n',
        'event: delta\ndata: {"text":"answer"}\n\n',
        'event: done\ndata: {"modelUsed":"gemini-4-hydrogen","fallbackUsed":false,"usage":{"promptTokens":5,"outputTokens":2}}\n\n',
      ]);
    },
  });

  const okRes = await refreshSvc.streamMessage(
    {
      model: 'gemini-4-hydrogen',
      temperature: 0.4,
      systemInstruction: 'System',
      messages: [{ role: 'user', content: 'Test' }],
    },
    {
      onDelta: (delta) => deltas.push(delta),
    },
  );
  assert.equal(attempts, 2);
  assert.equal(okRes.ok, true);
  if (okRes.ok) {
    assert.equal(okRes.reply, 'Streamed answer');
    assert.deepEqual(deltas, ['Streamed ', 'answer']);
    assert.equal(okRes.usage?.outputTokens, 2);
  }
});

test('BrowserChatService preserves partial reply on mid-stream error or abort', async () => {
  const errSvc = new BrowserChatService({
    isOnline: () => true,
    getAuthToken: async () => 'tok',
    fetchFn: async () =>
      makeSseResponse([
        'event: meta\ndata: {"modelUsed":"gemini-4-hydrogen","fallbackUsed":false}\n\n',
        'event: delta\ndata: {"text":"Partial content"}\n\n',
        'event: error\ndata: {"code":"upstream_error","status":502,"retryable":true,"message":"Upstream reset"}\n\n',
      ]),
  });

  const res = await errSvc.streamMessage({
    model: 'gemini-4-hydrogen',
    temperature: 0.4,
    systemInstruction: '',
    messages: [{ role: 'user', content: 'Hello' }],
  });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.code, 'upstream_error');
    assert.equal(res.partialReply, 'Partial content');
    assert.equal(res.retryable, true);
  }
});

test('workspaceReducer streaming deltas do not bump dataRevision until CHAT_RESPONSE_RECEIVED, and regeneration preserves user message', () => {
  let state = createInitialWorkspaceState('uid-1');
  state = workspaceReducer(state, {
    type: 'SEND_USER_MESSAGE',
    text: 'Explain closures',
    conversationId: 'conv-stream-1',
  });
  const revAfterSend = state.dataRevision;
  assert.equal(state.chatSending, true);
  assert.equal(state.chatStreaming?.conversationId, 'conv-stream-1');

  state = workspaceReducer(state, {
    type: 'CHAT_STREAM_META',
    conversationId: 'conv-stream-1',
    modelUsed: 'gemini-4-hydrogen',
    fallbackUsed: false,
  });
  state = workspaceReducer(state, {
    type: 'CHAT_STREAM_DELTA',
    conversationId: 'conv-stream-1',
    delta: 'A closure ',
  });
  state = workspaceReducer(state, {
    type: 'CHAT_STREAM_DELTA',
    conversationId: 'conv-stream-1',
    delta: 'captures lexical scope.',
  });

  // Streaming buffer is ephemeral and must not thrash IndexedDB/outbox
  assert.equal(state.dataRevision, revAfterSend);
  assert.equal(state.chatStreaming?.text, 'A closure captures lexical scope.');

  state = workspaceReducer(state, {
    type: 'CHAT_RESPONSE_RECEIVED',
    conversationId: 'conv-stream-1',
    reply: 'A closure captures lexical scope.',
    modelUsed: 'gemini-4-hydrogen',
    usage: { promptTokens: 10, outputTokens: 6 },
  });
  assert.equal(state.chatSending, false);
  assert.equal(state.chatStreaming, null);
  assert.equal(state.dataRevision, revAfterSend + 1);
  assert.equal(state.conversations[0].messages.length, 2);
  assert.equal(state.conversations[0].messages[1].modelUsed, 'gemini-4-hydrogen');

  // Regenerating removes only the assistant turn and preserves user turn
  state = workspaceReducer(state, {
    type: 'PREPARE_REGENERATE_RESPONSE',
    conversationId: 'conv-stream-1',
  });
  assert.equal(state.chatSending, true);
  assert.equal(state.conversations[0].messages.length, 1);
  assert.equal(state.conversations[0].messages[0].role, 'user');
  assert.equal(state.conversations[0].messages[0].content, 'Explain closures');
});
