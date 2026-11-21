export interface PreviewErrorMessage {
  type: 'preview-error';
  channel: string;
  message: string;
}

/**
 * Serializes arbitrary string/JSON safely for embedding inside an HTML `<script type="application/json">`
 * element so sequences like `</script>`, `</ScRiPt>`, or Unicode line separators can never break out
 * of the script context or corrupt JS string/template/regex literals.
 */
export function safeJsonForHtmlScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export interface PreviewMessageEventLike {
  source: unknown;
  origin: string;
  data: unknown;
}

/**
 * Validates postMessage events received from the sandboxed preview iframe (`sandbox="allow-scripts"`).
 * - Confirms the event came from the mounted iframe's `contentWindow` (or rejects null/mismatched sources).
 * - Accounts for opaque origins (`"null"`) used by sandboxed iframes without weakening sandbox isolation.
 * - Requires a matching per-render `channel` token and strictly typed payload.
 */
export function validatePreviewMessage(
  event: PreviewMessageEventLike,
  expectedWindow: unknown,
  expectedChannel: string,
  hostOrigin?: string,
): PreviewErrorMessage | null {
  if (!expectedWindow || event.source !== expectedWindow) {
    return null;
  }

  // Sandboxed iframes without `allow-same-origin` emit event.origin === 'null' (opaque origin)
  const originAllowed =
    event.origin === 'null' || (Boolean(hostOrigin) && event.origin === hostOrigin);
  if (!originAllowed) {
    return null;
  }

  if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) {
    return null;
  }

  const data = event.data as Record<string, unknown>;
  if (data.type !== 'preview-error') return null;
  if (typeof data.channel !== 'string' || data.channel !== expectedChannel) return null;
  if (typeof data.message !== 'string' || !data.message.trim()) return null;

  return {
    type: 'preview-error',
    channel: data.channel,
    message: data.message.slice(0, 2000),
  };
}
