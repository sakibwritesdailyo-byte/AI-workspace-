import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VOICE_SETTINGS,
} from '../data/mockWorkspaceData';
import type {
  AppSettings,
  Conversation,
  FileLanguage,
  ImportInspectionPreview,
  ModelSettings,
  Project,
  ProjectFile,
  VoiceSessionRecord,
  VoiceSettings,
  WorkspaceExportBundle,
} from '../types/workspace';

export const SUPPORTED_BACKUP_VERSION = 2;

const VALID_LANGUAGES = new Set<FileLanguage>([
  'html',
  'css',
  'typescript',
  'javascript',
  'json',
  'markdown',
]);

function inferLang(name: string): FileLanguage {
  const lower = name.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  return 'markdown';
}

export function sanitizeModelSettings(raw: unknown): ModelSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MODEL_SETTINGS };
  const m = raw as Partial<ModelSettings>;
  const temp =
    typeof m.temperature === 'number' && Number.isFinite(m.temperature)
      ? Math.min(1, Math.max(0, m.temperature))
      : DEFAULT_MODEL_SETTINGS.temperature;

  const validThinking = new Set(['auto', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  const thinkingLevel =
    typeof m.thinkingLevel === 'string' && validThinking.has(m.thinkingLevel)
      ? (m.thinkingLevel as ModelSettings['thinkingLevel'])
      : DEFAULT_MODEL_SETTINGS.thinkingLevel;

  const maxOutputTokens =
    typeof m.maxOutputTokens === 'number' && Number.isFinite(m.maxOutputTokens)
      ? Math.min(8192, Math.max(128, Math.floor(m.maxOutputTokens)))
      : DEFAULT_MODEL_SETTINGS.maxOutputTokens;

  return {
    chatModel:
      typeof m.chatModel === 'string' && m.chatModel.trim()
        ? m.chatModel.trim()
        : DEFAULT_MODEL_SETTINGS.chatModel,
    liveModel:
      typeof m.liveModel === 'string' && m.liveModel.trim()
        ? m.liveModel.trim()
        : DEFAULT_MODEL_SETTINGS.liveModel,
    fallbackModel:
      typeof m.fallbackModel === 'string' && m.fallbackModel.trim()
        ? m.fallbackModel.trim()
        : DEFAULT_MODEL_SETTINGS.fallbackModel,
    temperature: temp,
    thinkingLevel,
    maxOutputTokens,
    systemPromptId:
      typeof m.systemPromptId === 'string' && m.systemPromptId.trim()
        ? m.systemPromptId.trim()
        : DEFAULT_MODEL_SETTINGS.systemPromptId,
    customSystemPrompt:
      typeof m.customSystemPrompt === 'string'
        ? m.customSystemPrompt
        : DEFAULT_MODEL_SETTINGS.customSystemPrompt,
    autoFallback:
      typeof m.autoFallback === 'boolean' ? m.autoFallback : DEFAULT_MODEL_SETTINGS.autoFallback,
  };
}

export function sanitizeVoiceSettings(raw: unknown): VoiceSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_VOICE_SETTINGS, saveRawAudio: false };
  const v = raw as Partial<VoiceSettings>;
  const validVoiceNames = new Set<VoiceSettings['voiceName']>([
    'Aoede',
    'Kore',
    'Charon',
    'Fenrir',
    'Puck',
  ]);
  const validLangs = new Set<VoiceSettings['languageMode']>(['bilingual', 'en', 'bn']);
  return {
    voiceName:
      v.voiceName && validVoiceNames.has(v.voiceName)
        ? v.voiceName
        : DEFAULT_VOICE_SETTINGS.voiceName,
    languageMode:
      v.languageMode && validLangs.has(v.languageMode)
        ? v.languageMode
        : DEFAULT_VOICE_SETTINGS.languageMode,
    allowBargeIn:
      typeof v.allowBargeIn === 'boolean' ? v.allowBargeIn : DEFAULT_VOICE_SETTINGS.allowBargeIn,
    saveTranscripts:
      typeof v.saveTranscripts === 'boolean'
        ? v.saveTranscripts
        : DEFAULT_VOICE_SETTINGS.saveTranscripts,
    saveRawAudio: false,
    speechRate:
      typeof v.speechRate === 'number' && Number.isFinite(v.speechRate)
        ? Math.min(2, Math.max(0.5, v.speechRate))
        : DEFAULT_VOICE_SETTINGS.speechRate,
  };
}

export function sanitizeAppSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_APP_SETTINGS };
  const a = raw as Partial<AppSettings>;
  return {
    showLineNumbers:
      typeof a.showLineNumbers === 'boolean'
        ? a.showLineNumbers
        : DEFAULT_APP_SETTINGS.showLineNumbers,
    autosaveEnabled:
      typeof a.autosaveEnabled === 'boolean'
        ? a.autosaveEnabled
        : DEFAULT_APP_SETTINGS.autosaveEnabled,
    localFirstMode:
      typeof a.localFirstMode === 'boolean'
        ? a.localFirstMode
        : DEFAULT_APP_SETTINGS.localFirstMode,
  };
}

export function buildWorkspaceExportBundle(input: {
  projects: Project[];
  conversations: Conversation[];
  deletedConversations: Conversation[];
  voiceSessions?: VoiceSessionRecord[];
  voiceSettings: VoiceSettings;
  modelSettings: ModelSettings;
  appSettings: AppSettings;
}): WorkspaceExportBundle {
  return {
    schemaVersion: SUPPORTED_BACKUP_VERSION,
    backupType: 'workspace',
    exportedAt: new Date().toISOString(),
    projects: input.projects.filter((p) => !p.isSample),
    conversations: input.conversations.filter((c) => !c.isSample),
    deletedConversations: input.deletedConversations.filter((c) => !c.isSample),
    voiceSessions: (input.voiceSessions ?? []).map((s) => ({
      ...s,
      rawAudioStored: false,
      transcripts: input.voiceSettings.saveTranscripts ? s.transcripts : [],
    })),
    preferences: {
      voiceSettings: { ...input.voiceSettings, saveRawAudio: false },
      modelSettings: input.modelSettings,
      appSettings: input.appSettings,
    },
  };
}

export function buildSingleProjectExportBundle(project: Project): WorkspaceExportBundle {
  return {
    schemaVersion: SUPPORTED_BACKUP_VERSION,
    backupType: 'project',
    exportedAt: new Date().toISOString(),
    projects: [{ ...project, isSample: false }],
    conversations: [],
    deletedConversations: [],
    voiceSessions: [],
  };
}

function normalizeImportedFile(raw: unknown, idx: number, nowIso: string): ProjectFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Partial<ProjectFile>;
  if (typeof f.name !== 'string' || !f.name.trim()) return null;
  const name = f.name.trim();
  const folder = typeof f.folder === 'string' && f.folder.trim() ? f.folder.trim() : 'src';
  const createdAt = typeof f.createdAt === 'string' && f.createdAt ? f.createdAt : nowIso;
  const updatedAt = typeof f.updatedAt === 'string' && f.updatedAt ? f.updatedAt : createdAt;
  return {
    id: typeof f.id === 'string' && f.id.trim() ? f.id : `file-import-${Date.now()}-${idx}`,
    name,
    folder,
    path: typeof f.path === 'string' && f.path.trim() ? f.path : `${folder}/${name}`,
    language: f.language && VALID_LANGUAGES.has(f.language) ? f.language : inferLang(name),
    content: typeof f.content === 'string' ? f.content : '',
    createdAt,
    updatedAt,
    revision: typeof f.revision === 'number' && f.revision > 0 ? f.revision : 1,
    ownerUid: null,
    syncStatus: 'local_only',
  };
}

function normalizeImportedProject(raw: unknown, idx: number, nowIso: string): Project {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid project entry at index ${idx}.`);
  }
  const p = raw as Partial<Project>;
  if (typeof p.name !== 'string' || !p.name.trim()) {
    throw new Error(`Project at index ${idx} is missing a valid name.`);
  }
  if (!Array.isArray(p.files)) {
    throw new Error(`Project "${p.name}" is missing a valid files array.`);
  }
  const files = p.files
    .map((file, fileIdx) => normalizeImportedFile(file, fileIdx, nowIso))
    .filter((file): file is ProjectFile => Boolean(file));

  const folderSet = new Set<string>(Array.isArray(p.folders) ? p.folders : []);
  for (const f of files) {
    if (f.folder) folderSet.add(f.folder);
  }

  const createdAt = typeof p.createdAt === 'string' && p.createdAt ? p.createdAt : nowIso;
  const updatedAt = typeof p.updatedAt === 'string' && p.updatedAt ? p.updatedAt : createdAt;

  return {
    id: typeof p.id === 'string' && p.id.trim() ? p.id : `proj-import-${Date.now()}-${idx}`,
    name: p.name.trim(),
    description: typeof p.description === 'string' ? p.description : '',
    framework: typeof p.framework === 'string' && p.framework ? p.framework : 'HTML · CSS · JS',
    createdAt,
    updatedAt,
    revision: typeof p.revision === 'number' && p.revision > 0 ? p.revision : 1,
    ownerUid: null,
    syncStatus: 'local_only',
    entryFileId:
      typeof p.entryFileId === 'string' && files.some((f) => f.id === p.entryFileId)
        ? p.entryFileId
        : files[0]?.id ?? '',
    folders: Array.from(folderSet),
    files,
    isSample: false,
  };
}

function normalizeImportedConversation(
  raw: unknown,
  idx: number,
  nowIso: string,
  ensureDeletedAt = false,
): Conversation {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid conversation entry at index ${idx}.`);
  }
  const c = raw as Partial<Conversation>;
  if (typeof c.title !== 'string') {
    throw new Error(`Conversation at index ${idx} is missing a valid title.`);
  }

  const convCreatedAt = typeof c.createdAt === 'string' && c.createdAt ? c.createdAt : nowIso;
  const convUpdatedAt =
    typeof c.updatedAt === 'string' && c.updatedAt ? c.updatedAt : convCreatedAt;

  const messages = Array.isArray(c.messages)
    ? c.messages
        .filter((m) => m && typeof m === 'object' && typeof m.content === 'string')
        .map((m, mIdx) => {
          const msgCreatedAt =
            typeof m.createdAt === 'string' && m.createdAt ? m.createdAt : convCreatedAt;
          const msgUpdatedAt =
            typeof m.updatedAt === 'string' && m.updatedAt ? m.updatedAt : msgCreatedAt;
          return {
            id: typeof m.id === 'string' && m.id.trim() ? m.id : `msg-import-${Date.now()}-${mIdx}`,
            role:
              m.role === 'assistant' || m.role === 'system' ? m.role : ('user' as const),
            content: m.content,
            timestamp: typeof m.timestamp === 'string' ? m.timestamp : '00:00',
            createdAt: msgCreatedAt,
            updatedAt: msgUpdatedAt,
            revision: typeof m.revision === 'number' && m.revision > 0 ? m.revision : 1,
            ownerUid: null,
            syncStatus: 'local_only' as const,
            source: m.source === 'voice' ? ('voice' as const) : ('text' as const),
            language: m.language,
          };
        })
    : [];

  return {
    id: typeof c.id === 'string' && c.id.trim() ? c.id : `conv-import-${Date.now()}-${idx}`,
    title: c.title.trim() || 'Imported Conversation',
    kind: c.kind === 'voice' ? 'voice' : 'chat',
    projectId: c.projectId ?? null,
    createdAt: convCreatedAt,
    updatedAt: convUpdatedAt,
    isPinned: Boolean(c.isPinned),
    deletedAt:
      typeof c.deletedAt === 'string' && c.deletedAt
        ? c.deletedAt
        : ensureDeletedAt
          ? nowIso
          : undefined,
    revision: typeof c.revision === 'number' && c.revision > 0 ? c.revision : 1,
    ownerUid: null,
    syncStatus: 'local_only',
    durationSeconds: typeof c.durationSeconds === 'number' ? c.durationSeconds : undefined,
    voiceSessionIds: Array.isArray(c.voiceSessionIds) ? c.voiceSessionIds : undefined,
    summary: typeof c.summary === 'string' ? c.summary : '',
    messages,
    isSample: false,
  };
}

function normalizeImportedVoiceSession(
  raw: unknown,
  idx: number,
  nowIso: string,
): VoiceSessionRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<VoiceSessionRecord>;
  if (typeof v.id !== 'string' || !v.id.trim()) return null;
  const startedAt = typeof v.startedAt === 'string' && v.startedAt ? v.startedAt : nowIso;
  const createdAt = typeof v.createdAt === 'string' && v.createdAt ? v.createdAt : startedAt;
  const updatedAt =
    typeof v.updatedAt === 'string' && v.updatedAt ? v.updatedAt : v.endedAt || createdAt;
  return {
    id: v.id.trim() || `voice-import-${Date.now()}-${idx}`,
    conversationId: typeof v.conversationId === 'string' ? v.conversationId : null,
    model: typeof v.model === 'string' && v.model ? v.model : DEFAULT_MODEL_SETTINGS.liveModel,
    languageMode:
      v.languageMode === 'en' || v.languageMode === 'bn' ? v.languageMode : 'bilingual',
    status: v.status ?? 'disconnected',
    micPermission: v.micPermission ?? 'unknown',
    startedAt,
    endedAt: typeof v.endedAt === 'string' ? v.endedAt : undefined,
    createdAt,
    updatedAt,
    revision: typeof v.revision === 'number' && v.revision > 0 ? v.revision : 1,
    ownerUid: null,
    syncStatus: 'local_only',
    durationSeconds: typeof v.durationSeconds === 'number' ? v.durationSeconds : 0,
    errorMessage: typeof v.errorMessage === 'string' ? v.errorMessage : null,
    transcriptsSaved: Boolean(v.transcriptsSaved && Array.isArray(v.transcripts) && v.transcripts.length > 0),
    transcripts: Array.isArray(v.transcripts) ? v.transcripts : [],
    rawAudioStored: false,
  };
}

function deduplicateItemsById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

export function validateAndInspectImportBundle(
  rawJson: string,
  existing: {
    projectIds: string[];
    conversationIds: string[];
    deletedIds: string[];
    voiceSessionIds?: string[];
  },
): ImportInspectionPreview {
  const emptyFail = (error: string): ImportInspectionPreview => ({
    valid: false,
    error,
    projectCount: 0,
    fileCount: 0,
    conversationCount: 0,
    deletedCount: 0,
    voiceSessionCount: 0,
    hasPreferences: false,
    duplicateProjectIds: [],
    duplicateConversationIds: [],
    duplicateDeletedIds: [],
    duplicateVoiceSessionIds: [],
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return emptyFail('Invalid JSON file. Select a valid Personal AI Studio backup (.json).');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return emptyFail('Backup file must contain a JSON object.');
  }

  const obj = parsed as Record<string, unknown>;
  const version = obj.schemaVersion;
  if (typeof version !== 'number' || (version !== 1 && version !== SUPPORTED_BACKUP_VERSION)) {
    return emptyFail(
      `Incompatible backup schema version (${String(version ?? 'missing')}). Supported versions: 1, 2.`,
    );
  }

  if (obj.projects !== undefined && !Array.isArray(obj.projects)) {
    return emptyFail('Malformed backup: "projects" must be an array.');
  }
  if (obj.conversations !== undefined && !Array.isArray(obj.conversations)) {
    return emptyFail('Malformed backup: "conversations" must be an array.');
  }
  if (obj.deletedConversations !== undefined && !Array.isArray(obj.deletedConversations)) {
    return emptyFail('Malformed backup: "deletedConversations" must be an array.');
  }
  if (obj.voiceSessions !== undefined && !Array.isArray(obj.voiceSessions)) {
    return emptyFail('Malformed backup: "voiceSessions" must be an array.');
  }

  const rawProjects = Array.isArray(obj.projects) ? obj.projects : [];
  const rawConversations = Array.isArray(obj.conversations) ? obj.conversations : [];
  const rawDeleted = Array.isArray(obj.deletedConversations) ? obj.deletedConversations : [];
  const rawVoiceSessions = Array.isArray(obj.voiceSessions) ? obj.voiceSessions : [];

  if (
    rawProjects.length === 0 &&
    rawConversations.length === 0 &&
    rawDeleted.length === 0 &&
    rawVoiceSessions.length === 0
  ) {
    return emptyFail('Backup file contains no projects, conversations, or voice logs to import.');
  }

  const nowIso = new Date().toISOString();
  let projects: Project[];
  let conversations: Conversation[];
  let deletedConversations: Conversation[];

  try {
    projects = rawProjects.map((p, idx) => normalizeImportedProject(p, idx, nowIso));
    conversations = rawConversations.map((c, idx) =>
      normalizeImportedConversation(c, idx, nowIso, false),
    );
    deletedConversations = rawDeleted.map((c, idx) =>
      normalizeImportedConversation(c, idx, nowIso, true),
    );
  } catch (err) {
    return emptyFail(err instanceof Error ? err.message : 'Backup validation failed.');
  }

  const uniqueProjects = deduplicateItemsById(projects);
  const uniqueConversations = deduplicateItemsById(conversations);
  const activeConvIdsInBundle = new Set(uniqueConversations.map((c) => c.id));
  const uniqueDeleted = deduplicateItemsById(deletedConversations).filter(
    (c) => !activeConvIdsInBundle.has(c.id),
  );
  const uniqueVoiceSessions = deduplicateItemsById(
    rawVoiceSessions
      .map((v, idx) => normalizeImportedVoiceSession(v, idx, nowIso))
      .filter((v): v is VoiceSessionRecord => Boolean(v)),
  );

  const existingProjectSet = new Set(existing.projectIds);
  const existingConvSet = new Set([...existing.conversationIds, ...existing.deletedIds]);
  const existingVoiceSet = new Set(existing.voiceSessionIds ?? []);

  const duplicateProjectIds = uniqueProjects
    .filter((p) => existingProjectSet.has(p.id))
    .map((p) => p.id);
  const duplicateConversationIds = uniqueConversations
    .filter((c) => existingConvSet.has(c.id))
    .map((c) => c.id);
  const duplicateDeletedIds = uniqueDeleted
    .filter((c) => existingConvSet.has(c.id))
    .map((c) => c.id);
  const duplicateVoiceSessionIds = uniqueVoiceSessions
    .filter((v) => existingVoiceSet.has(v.id))
    .map((v) => v.id);

  let sanitizedPreferences: WorkspaceExportBundle['preferences'] | undefined;
  let hasPreferences = false;
  if (obj.preferences && typeof obj.preferences === 'object' && !Array.isArray(obj.preferences)) {
    const rawPrefs = obj.preferences as Record<string, unknown>;
    if (rawPrefs.voiceSettings || rawPrefs.modelSettings || rawPrefs.appSettings) {
      hasPreferences = true;
      sanitizedPreferences = {
        voiceSettings: sanitizeVoiceSettings(rawPrefs.voiceSettings),
        modelSettings: sanitizeModelSettings(rawPrefs.modelSettings),
        appSettings: sanitizeAppSettings(rawPrefs.appSettings),
      };
    }
  }

  const fileCount = uniqueProjects.reduce((sum, p) => sum + p.files.length, 0);
  const backupType = obj.backupType === 'project' ? 'project' : 'workspace';

  const bundle: WorkspaceExportBundle = {
    schemaVersion: SUPPORTED_BACKUP_VERSION,
    backupType,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : nowIso,
    projects: uniqueProjects,
    conversations: uniqueConversations,
    deletedConversations: uniqueDeleted,
    voiceSessions: uniqueVoiceSessions,
    preferences: sanitizedPreferences,
  };

  return {
    valid: true,
    schemaVersion: version,
    backupType,
    exportedAt: bundle.exportedAt,
    projectCount: uniqueProjects.length,
    fileCount,
    conversationCount: uniqueConversations.length,
    deletedCount: uniqueDeleted.length,
    voiceSessionCount: uniqueVoiceSessions.length,
    hasPreferences,
    duplicateProjectIds,
    duplicateConversationIds,
    duplicateDeletedIds,
    duplicateVoiceSessionIds,
    bundle,
  };
}

export function triggerJsonDownload(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
