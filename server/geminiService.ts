import {
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
} from '@google/genai';
import {
  clampThinkingLevelForModel,
  getChatModelDefinition,
  type ResolvedModelRouting,
  type ThinkingLevelOption,
} from '../src/shared/modelRegistry.ts';

export interface TokenUsageSummary {
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  thoughtsTokens?: number;
}

export interface GeminiErrorClassification {
  code:
    | 'missing_api_key'
    | 'invalid_api_key'
    | 'quota_exceeded'
    | 'model_not_found'
    | 'safety_blocked'
    | 'aborted'
    | 'timeout'
    | 'upstream_error';
  status: number;
  retryable: boolean;
  message: string;
}

export interface StreamChatParams {
  routing: ResolvedModelRouting;
  contents: Content[];
  systemInstruction?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onMeta?: (meta: {
    modelUsed: string;
    fallbackUsed: boolean;
    migratedFrom: string | null;
  }) => void;
  onDelta: (text: string) => void;
}

export interface StreamChatCompleted {
  ok: true;
  reply: string;
  modelUsed: string;
  fallbackUsed: boolean;
  finishReason: string | null;
  usage: TokenUsageSummary | null;
}

export interface StreamChatFailed {
  ok: false;
  error: GeminiErrorClassification;
  partialReply: string;
  modelAttempted: string;
}

export interface GeminiStreamClient {
  generateContentStream: (params: {
    model: string;
    contents: Content[];
    config: GenerateContentConfig;
  }) => Promise<AsyncIterable<GenerateContentResponse>>;
}

export function getConfiguredGeminiApiKey(): string | null {
  const raw = process.env.GEMINI_API_KEY;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'MY_GEMINI_API_KEY') return null;
  return trimmed;
}

export function isGeminiConfigured(): boolean {
  return getConfiguredGeminiApiKey() !== null;
}

function toSdkThinkingLevel(
  level: Exclude<ThinkingLevelOption, 'auto'> | undefined,
): ThinkingLevel | undefined {
  switch (level) {
    case 'minimal':
      return ThinkingLevel.MINIMAL;
    case 'low':
      return ThinkingLevel.LOW;
    case 'medium':
      return ThinkingLevel.MEDIUM;
    case 'high':
      return ThinkingLevel.HIGH;
    case 'xhigh':
      return ThinkingLevel.XHIGH;
    default:
      return undefined;
  }
}

export const STRICT_ENGLISH_SYSTEM_INSTRUCTION =
  'You are a professional software engineering assistant. Always respond in English only. Do not translate your responses into other languages unless explicitly asked.';

export function buildGenerateContentConfig(params: {
  modelId: string;
  systemInstruction?: string;
  thinkingLevel?: Exclude<ThinkingLevelOption, 'auto'>;
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}): GenerateContentConfig {
  const modelCap = getChatModelDefinition(params.modelId);
  const config: GenerateContentConfig = {};

  const trimmedSystem = params.systemInstruction?.trim() ?? '';
  config.systemInstruction = trimmedSystem
    ? trimmedSystem.includes(STRICT_ENGLISH_SYSTEM_INSTRUCTION)
      ? trimmedSystem
      : `${STRICT_ENGLISH_SYSTEM_INSTRUCTION}\n\n${trimmedSystem}`
    : STRICT_ENGLISH_SYSTEM_INSTRUCTION;

  if (params.abortSignal) {
    config.abortSignal = params.abortSignal;
  }

  if (typeof params.maxOutputTokens === 'number' && Number.isFinite(params.maxOutputTokens)) {
    const cap = modelCap?.maxOutputTokensCap ?? 8192;
    config.maxOutputTokens = Math.min(cap, Math.max(128, Math.floor(params.maxOutputTokens)));
  }

  if (modelCap?.supportsThinkingLevel && params.thinkingLevel) {
    const clamped = clampThinkingLevelForModel(modelCap, params.thinkingLevel);
    const sdkLevel = toSdkThinkingLevel(clamped);
    if (sdkLevel !== undefined) {
      config.thinkingConfig = { thinkingLevel: sdkLevel };
    }
  }

  // Strictly avoid deprecated sampling parameters on Gemini 4 series models
  if (
    modelCap?.supportsTemperature &&
    typeof params.temperature === 'number' &&
    Number.isFinite(params.temperature)
  ) {
    config.temperature = Math.min(1, Math.max(0, params.temperature));
  }

  return config;
}

export function classifyGeminiError(err: unknown): GeminiErrorClassification {
  if (
    err instanceof Error &&
    (err.name === 'AbortError' || err.message.toLowerCase().includes('aborted'))
  ) {
    return {
      code: 'aborted',
      status: 499,
      retryable: false,
      message: 'Response generation was cancelled.',
    };
  }

  const rawMessage = err instanceof Error ? err.message : String(err ?? 'Unknown Gemini error');
  const lower = rawMessage.toLowerCase();
  const statusProp =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : NaN;

  if (lower.includes('timed out') || lower.includes('timeout')) {
    return {
      code: 'timeout',
      status: 504,
      retryable: true,
      message: 'Gemini request timed out before completing. Please retry.',
    };
  }

  if (
    statusProp === 403 ||
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('invalid api key')
  ) {
    return {
      code: 'invalid_api_key',
      status: 502,
      retryable: false,
      message:
        'Gemini API key was rejected or lacks permission. Verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }

  if (statusProp === 429 || lower.includes('resource_exhausted') || lower.includes('quota') || lower.includes('429')) {
    return {
      code: 'quota_exceeded',
      status: 429,
      retryable: true,
      message:
        'Gemini API rate limit or quota was reached. Wait briefly before retrying or switch to Gemini 3.1 Flash Lite.',
    };
  }

  if (statusProp === 404 || lower.includes('not_found') || lower.includes('model not found')) {
    return {
      code: 'model_not_found',
      status: 400,
      retryable: false,
      message:
        'The selected Gemini model could not be found on the API. Switch to Gemini 4 Hydrogen or Gemini 3.1 Flash Lite.',
    };
  }

  if (lower.includes('safety') || lower.includes('blocked')) {
    return {
      code: 'safety_blocked',
      status: 422,
      retryable: false,
      message: 'The response could not be completed due to safety filtering.',
    };
  }

  return {
    code: 'upstream_error',
    status: 502,
    retryable: true,
    message: rawMessage || 'Gemini returned an upstream error. Please try again.',
  };
}

function createDefaultGeminiClient(): GeminiStreamClient | null {
  const apiKey = getConfiguredGeminiApiKey();
  if (!apiKey) return null;

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  return {
    generateContentStream: (params) => ai.models.generateContentStream(params),
  };
}

function extractUsage(chunk: GenerateContentResponse): TokenUsageSummary | null {
  const meta = chunk.usageMetadata;
  if (!meta) return null;
  const usage: TokenUsageSummary = {};
  if (typeof meta.promptTokenCount === 'number') usage.promptTokens = meta.promptTokenCount;
  if (typeof meta.candidatesTokenCount === 'number') usage.outputTokens = meta.candidatesTokenCount;
  if (typeof meta.totalTokenCount === 'number') usage.totalTokens = meta.totalTokenCount;
  if (typeof meta.thoughtsTokenCount === 'number') usage.thoughtsTokens = meta.thoughtsTokenCount;
  return Object.keys(usage).length > 0 ? usage : null;
}

export async function streamGeminiChat(
  params: StreamChatParams,
  injectedClient?: GeminiStreamClient,
): Promise<StreamChatCompleted | StreamChatFailed> {
  const client = injectedClient ?? createDefaultGeminiClient();
  if (!client) {
    return {
      ok: false,
      partialReply: '',
      modelAttempted: params.routing.primaryModel,
      error: {
        code: 'missing_api_key',
        status: 503,
        retryable: false,
        message:
          'Server GEMINI_API_KEY is not configured. Configure GEMINI_API_KEY in Settings > Secrets to enable Gemini responses.',
      },
    };
  }

  const hasFallback = Boolean(params.routing.fallbackModel);

  const runAttempt = async (
    modelId: string,
    fallbackUsed: boolean,
  ): Promise<StreamChatCompleted | StreamChatFailed> => {
    const controller = new AbortController();
    const timeoutMs =
      params.timeoutMs ?? (fallbackUsed ? 30_000 : hasFallback ? 12_000 : 30_000);
    let timedOut = false;

    const onParentAbort = () => controller.abort();
    if (params.signal) {
      if (params.signal.aborted) {
        return {
          ok: false,
          partialReply: '',
          modelAttempted: modelId,
          error: {
            code: 'aborted',
            status: 499,
            retryable: false,
            message: 'Response generation was cancelled.',
          },
        };
      }
      params.signal.addEventListener('abort', onParentAbort, { once: true });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let fullReply = '';
    let finishReason: string | null = null;
    let latestUsage: TokenUsageSummary | null = null;

    try {
      const config = buildGenerateContentConfig({
        modelId,
        systemInstruction: params.systemInstruction,
        thinkingLevel: params.routing.resolvedThinkingLevel,
        temperature: params.routing.resolvedTemperature,
        maxOutputTokens: params.routing.resolvedMaxOutputTokens,
        abortSignal: controller.signal,
      });

      const stream = await client.generateContentStream({
        model: modelId,
        contents: params.contents,
        config,
      });

      params.onMeta?.({
        modelUsed: modelId,
        fallbackUsed,
        migratedFrom: params.routing.migratedFrom,
      });

      for await (const chunk of stream) {
        if (controller.signal.aborted) {
          throw new Error(timedOut ? 'Request timed out' : 'Request aborted');
        }
        const delta = chunk.text;
        if (typeof delta === 'string' && delta.length > 0) {
          fullReply += delta;
          params.onDelta(delta);
        }
        const chunkUsage = extractUsage(chunk);
        if (chunkUsage) {
          latestUsage = chunkUsage;
        }
        const candidateFinish = chunk.candidates?.[0]?.finishReason;
        if (typeof candidateFinish === 'string' && candidateFinish) {
          finishReason = candidateFinish;
        }
      }

      if (!fullReply.trim()) {
        return {
          ok: false,
          partialReply: '',
          modelAttempted: modelId,
          error: {
            code: finishReason === 'SAFETY' ? 'safety_blocked' : 'upstream_error',
            status: finishReason === 'SAFETY' ? 422 : 502,
            retryable: finishReason !== 'SAFETY',
            message:
              finishReason === 'SAFETY'
                ? 'Gemini blocked this response due to safety policy.'
                : 'Gemini completed without returning any text content.',
          },
        };
      }

      return {
        ok: true,
        reply: fullReply,
        modelUsed: modelId,
        fallbackUsed,
        finishReason,
        usage: latestUsage,
      };
    } catch (err) {
      const classified = timedOut
        ? {
            code: 'timeout' as const,
            status: 504,
            retryable: true,
            message: 'Gemini request timed out before completing. Please retry.',
          }
        : classifyGeminiError(err);

      return {
        ok: false,
        partialReply: fullReply,
        modelAttempted: modelId,
        error: classified,
      };
    } finally {
      clearTimeout(timer);
      params.signal?.removeEventListener('abort', onParentAbort);
    }
  };

  const primaryResult = await runAttempt(params.routing.primaryModel, false);
  if (primaryResult.ok) {
    return primaryResult;
  }

  const canFallback =
    Boolean(params.routing.fallbackModel) &&
    primaryResult.partialReply.length === 0 &&
    !params.signal?.aborted &&
    (primaryResult.error.code === 'quota_exceeded' ||
      primaryResult.error.code === 'upstream_error' ||
      primaryResult.error.code === 'timeout' ||
      primaryResult.error.code === 'model_not_found');

  if (canFallback && params.routing.fallbackModel) {
    return runAttempt(params.routing.fallbackModel, true);
  }

  return primaryResult;
}
