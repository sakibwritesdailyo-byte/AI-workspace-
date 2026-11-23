export type ThinkingLevelOption = 'auto' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ChatModelDefinition {
  id: string;
  label: string;
  shortLabel: string;
  tier: 'standard' | 'fast';
  description: string;
  supportsThinkingLevel: boolean;
  supportedThinkingLevels: Exclude<ThinkingLevelOption, 'auto'>[];
  defaultThinkingLevel: Exclude<ThinkingLevelOption, 'auto'>;
  supportsTemperature: boolean;
  defaultMaxOutputTokens: number;
  maxOutputTokensCap: number;
  maxInputChars: number;
  requiresPaidKey: boolean;
}

export const DEFAULT_CHAT_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_FAST_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_LIVE_VOICE_MODEL = 'gemini-3.8-live';

export const CHAT_MODEL_CATALOG: readonly ChatModelDefinition[] = [
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite (Fast)',
    shortLabel: 'Gemini 3.1 Flash Lite',
    tier: 'fast',
    description:
      'Default low-latency lightweight model suited for quick Q&A, coding, drafts, and instant replies.',
    supportsThinkingLevel: true,
    supportedThinkingLevels: ['minimal', 'low', 'medium', 'high'],
    defaultThinkingLevel: 'minimal',
    supportsTemperature: true,
    defaultMaxOutputTokens: 4096,
    maxOutputTokensCap: 8192,
    maxInputChars: 40_000,
    requiresPaidKey: false,
  },
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen (Balanced)',
    shortLabel: 'Gemini 4 Hydrogen',
    tier: 'standard',
    description:
      'Balanced reasoning model for deeper architecture, coding, and structured technical notes.',
    supportsThinkingLevel: true,
    supportedThinkingLevels: ['low', 'medium', 'high', 'xhigh'],
    defaultThinkingLevel: 'high',
    supportsTemperature: false,
    defaultMaxOutputTokens: 4096,
    maxOutputTokensCap: 8192,
    maxInputChars: 48_000,
    requiresPaidKey: false,
  },
] as const;

export const LEGACY_MODEL_ALIASES: Record<string, string> = {
  'gemini-2.5-flash': 'gemini-4-hydrogen',
  'gemini-2.5-pro': 'gemini-4-hydrogen',
  'gemini-2.5-flash-lite': 'gemini-3.1-flash-lite',
};

const MODEL_MAP = new Map<string, ChatModelDefinition>(
  CHAT_MODEL_CATALOG.map((model) => [model.id, model]),
);

export function getChatModelDefinition(modelId: string): ChatModelDefinition | undefined {
  return MODEL_MAP.get(modelId);
}

export function isLegacyAliasedModel(modelId: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_MODEL_ALIASES, modelId.trim());
}

export interface ResolvedModelRouting {
  ok: true;
  requestedModel: string;
  primaryModel: string;
  fallbackModel: string | null;
  migratedFrom: string | null;
  capability: ChatModelDefinition;
  resolvedThinkingLevel: Exclude<ThinkingLevelOption, 'auto'> | undefined;
  resolvedTemperature: number | undefined;
  resolvedMaxOutputTokens: number;
}

export interface RejectedModelRouting {
  ok: false;
  code: 'invalid_model';
  message: string;
}

export function clampThinkingLevelForModel(
  model: ChatModelDefinition,
  requested: ThinkingLevelOption | undefined,
): Exclude<ThinkingLevelOption, 'auto'> | undefined {
  if (!model.supportsThinkingLevel || !requested || requested === 'auto') {
    return undefined;
  }
  if (model.supportedThinkingLevels.includes(requested)) {
    return requested;
  }
  if (requested === 'minimal') {
    return model.supportedThinkingLevels.includes('low') ? 'low' : model.defaultThinkingLevel;
  }
  if (requested === 'xhigh') {
    return model.supportedThinkingLevels.includes('high') ? 'high' : model.defaultThinkingLevel;
  }
  return model.defaultThinkingLevel;
}

export function resolveChatModelRouting(input: {
  requestedModel?: string;
  fallbackModel?: string;
  autoFallback?: boolean;
  thinkingLevel?: ThinkingLevelOption;
  temperature?: number;
  maxOutputTokens?: number;
}): ResolvedModelRouting | RejectedModelRouting {
  const rawRequested =
    typeof input.requestedModel === 'string' && input.requestedModel.trim()
      ? input.requestedModel.trim()
      : DEFAULT_CHAT_MODEL;

  const aliased = LEGACY_MODEL_ALIASES[rawRequested];
  const canonicalPrimary = aliased ?? rawRequested;
  const primaryCap = MODEL_MAP.get(canonicalPrimary);

  if (!primaryCap) {
    return {
      ok: false,
      code: 'invalid_model',
      message: `Model "${rawRequested}" is not supported on this workspace endpoint. Choose one of: ${CHAT_MODEL_CATALOG.map((m) => m.id).join(', ')}.`,
    };
  }

  let fallbackModel: string | null = null;
  if (input.autoFallback !== false) {
    const rawFallback =
      typeof input.fallbackModel === 'string' && input.fallbackModel.trim()
        ? input.fallbackModel.trim()
        : DEFAULT_FAST_FALLBACK_MODEL;
    const canonicalFallback = LEGACY_MODEL_ALIASES[rawFallback] ?? rawFallback;
    if (MODEL_MAP.has(canonicalFallback) && canonicalFallback !== primaryCap.id) {
      fallbackModel = canonicalFallback;
    } else if (primaryCap.id !== DEFAULT_FAST_FALLBACK_MODEL) {
      fallbackModel = DEFAULT_FAST_FALLBACK_MODEL;
    }
  }

  const rawTemp =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature)
      ? Math.min(1, Math.max(0, Number(input.temperature.toFixed(2))))
      : undefined;

  const rawMaxTokens =
    typeof input.maxOutputTokens === 'number' && Number.isFinite(input.maxOutputTokens)
      ? Math.min(primaryCap.maxOutputTokensCap, Math.max(128, Math.floor(input.maxOutputTokens)))
      : primaryCap.defaultMaxOutputTokens;

  return {
    ok: true,
    requestedModel: rawRequested,
    primaryModel: primaryCap.id,
    fallbackModel,
    migratedFrom: aliased ? rawRequested : null,
    capability: primaryCap,
    resolvedThinkingLevel: clampThinkingLevelForModel(primaryCap, input.thinkingLevel),
    resolvedTemperature: primaryCap.supportsTemperature ? rawTemp : undefined,
    resolvedMaxOutputTokens: rawMaxTokens,
  };
}
