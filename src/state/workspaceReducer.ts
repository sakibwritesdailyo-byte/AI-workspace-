import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VOICE_SETTINGS,
  SAMPLE_CONVERSATIONS,
  SAMPLE_PROJECTS,
} from '../data/mockWorkspaceData';
import {
  sanitizeAppSettings,
  sanitizeModelSettings,
  sanitizeVoiceSettings,
} from '../services/backupService';
import type { PersistedWorkspaceSnapshot } from '../services/workspaceRepository';
import type {
  AppSettings,
  ChatMessage,
  ChatNoticeKind,
  Conversation,
  FileLanguage,
  HistoryFilter,
  ModelSettings,
  PreviewViewport,
  Project,
  ProjectFile,
  ProjectSubView,
  SaveStatus,
  SyncStatus,
  TokenUsageSummary,
  VoiceSessionRecord,
  VoiceSettings,
  WorkspaceExportBundle,
  WorkspaceId,
  WorkspaceState,
} from '../types/workspace';
import { safeJsonForHtmlScript } from '../utils/previewSecurity';
import {
  INITIAL_VOICE_SESSION,
  transitionVoiceSession,
  type VoiceEvent,
} from './voiceStateMachine';

export type WorkspaceAction =
  | {
      type: 'HYDRATE_FROM_STORAGE';
      snapshot: PersistedWorkspaceSnapshot;
      activeOwnerUid?: string | null;
    }
  | {
      type: 'SET_ACTIVE_OWNER_AND_HYDRATE';
      activeOwnerUid: string | null;
      snapshot: PersistedWorkspaceSnapshot;
    }
  | {
      type: 'APPLY_REMOTE_SNAPSHOT';
      snapshot: PersistedWorkspaceSnapshot;
      syncedAt?: string;
    }
  | { type: 'SET_STORAGE_ERROR'; error: string | null }
  | { type: 'CLEAR_WORKSPACE_NOTICE' }
  | {
      type: 'SET_SAVE_STATUS';
      status: SaveStatus;
      savedAt?: string;
      persistedRevision?: number;
      clearDirty?: boolean;
      error?: string | null;
    }
  | { type: 'SET_WORKSPACE'; workspace: WorkspaceId }
  | { type: 'SET_PROJECT_SUBVIEW'; subView: ProjectSubView }
  | { type: 'TOGGLE_LEFT_DRAWER' }
  | { type: 'SET_LEFT_DRAWER'; open: boolean }
  | { type: 'TOGGLE_RIGHT_DRAWER' }
  | { type: 'SET_RIGHT_DRAWER'; open: boolean }
  | { type: 'SELECT_PROJECT'; projectId: string; subView?: ProjectSubView }
  | { type: 'PREVIEW_SAMPLE_PROJECT'; sampleProjectId: string; subView?: ProjectSubView }
  | { type: 'CLONE_SAMPLE_PROJECT'; sampleProjectId: string }
  | { type: 'CREATE_PROJECT'; name: string; description?: string }
  | { type: 'RENAME_PROJECT'; projectId: string; name: string }
  | { type: 'DUPLICATE_PROJECT'; projectId: string }
  | { type: 'DELETE_PROJECT'; projectId: string }
  | { type: 'SELECT_FILE'; fileId: string; openCodeStudio?: boolean }
  | { type: 'CLOSE_FILE_TAB'; fileId: string }
  | { type: 'UPDATE_FILE_CONTENT'; fileId: string; content: string }
  | { type: 'MARK_FILE_SAVED'; fileId: string }
  | { type: 'CREATE_FILE'; folder: string; name: string }
  | { type: 'RENAME_FILE'; fileId: string; newName: string }
  | { type: 'DELETE_FILE'; fileId: string }
  | { type: 'CREATE_FOLDER'; folderPath: string }
  | { type: 'RENAME_FOLDER'; oldPath: string; newPath: string }
  | { type: 'DELETE_FOLDER'; folderPath: string }
  | { type: 'TOGGLE_FOLDER'; folderPath: string }
  | { type: 'SELECT_CONVERSATION'; conversationId: string; openChat?: boolean }
  | { type: 'CREATE_CONVERSATION'; kind?: 'voice' | 'chat'; title?: string }
  | { type: 'RENAME_CONVERSATION'; conversationId: string; title: string }
  | { type: 'TOGGLE_PIN_CONVERSATION'; conversationId: string }
  | { type: 'DELETE_CONVERSATION'; conversationId: string }
  | { type: 'RESTORE_DELETED_CONVERSATION'; conversationId: string }
  | { type: 'PERMANENTLY_DELETE_CONVERSATION'; conversationId: string }
  | { type: 'TOGGLE_SELECT_CONVERSATION'; conversationId: string }
  | { type: 'SELECT_ALL_CONVERSATIONS'; conversationIds: string[] }
  | { type: 'CLEAR_SELECTED_CONVERSATIONS' }
  | { type: 'BULK_DELETE_CONVERSATIONS' }
  | { type: 'CLONE_SAMPLE_CONVERSATION'; sampleConversationId: string }
  | { type: 'SEND_USER_MESSAGE'; text: string; timestamp?: string; conversationId?: string }
  | { type: 'RETRY_CHAT_REQUEST' }
  | { type: 'PREPARE_REGENERATE_RESPONSE'; conversationId: string }
  | {
      type: 'CHAT_STREAM_META';
      conversationId: string;
      modelUsed: string;
      fallbackUsed: boolean;
    }
  | {
      type: 'CHAT_STREAM_DELTA';
      conversationId: string;
      delta: string;
    }
  | {
      type: 'CHAT_RESPONSE_RECEIVED';
      conversationId: string;
      reply: string;
      timestamp?: string;
      modelUsed?: string;
      fallbackUsed?: boolean;
      usage?: TokenUsageSummary | null;
      stopped?: boolean;
    }
  | {
      type: 'CHAT_RESPONSE_FAILED';
      kind: ChatNoticeKind;
      message: string;
      retryable?: boolean;
    }
  | { type: 'CLEAR_CHAT_NOTICE' }
  | { type: 'CLEAR_ACTIVE_CONVERSATION' }
  | { type: 'SET_HISTORY_FILTER'; filter: HistoryFilter }
  | { type: 'SET_HISTORY_SEARCH'; query: string }
  | { type: 'SET_PREVIEW_VIEWPORT'; viewport: PreviewViewport }
  | { type: 'REFRESH_PREVIEW' }
  | { type: 'UPDATE_VOICE_SETTINGS'; patch: Partial<VoiceSettings> }
  | { type: 'UPDATE_MODEL_SETTINGS'; patch: Partial<ModelSettings> }
  | { type: 'UPDATE_APP_SETTINGS'; patch: Partial<AppSettings> }
  | { type: 'RECORD_VOICE_SESSION'; record: VoiceSessionRecord }
  | {
      type: 'IMPORT_WORKSPACE_BUNDLE';
      bundle: WorkspaceExportBundle;
      duplicateStrategy?: 'skip' | 'copy';
      restorePreferences?: boolean;
    }
  | {
      type: 'APPLY_COMMITTED_IMPORT';
      nextState: WorkspaceState;
      savedAt: string;
    }
  | {
      type: 'ROLLBACK_TO_COMMITTED_SNAPSHOT';
      snapshot: PersistedWorkspaceSnapshot;
      activeOwnerUid?: string | null;
    }
  | { type: 'CLEAR_ALL_LOCAL_DATA'; activeOwnerUid?: string | null }
  | { type: 'VOICE_EVENT'; event: VoiceEvent };

export function generateStableId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeFolderPath(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg && seg !== '.' && seg !== '..');
  return cleaned.join('/') || 'src';
}

export type PathValidationResult =
  | { ok: true; folder: string; name: string; path: string }
  | { ok: false; error: string };

/**
 * Validates and normalizes a project file path before creation or rename.
 * Policy: Case-insensitive uniqueness within a project (`folder/name.toLowerCase()`),
 * preserving user casing on display and excluding `excludeFileId` when renaming.
 */
export function validateProjectFilePath(
  project: Project,
  rawFolder: string,
  rawFileName: string,
  excludeFileId?: string,
): PathValidationResult {
  const trimmedFolder = rawFolder.trim().replace(/\\/g, '/');
  if (trimmedFolder.split('/').some((seg) => seg.trim() === '..' || seg.trim() === '.')) {
    return {
      ok: false,
      error: 'Folder path cannot contain relative "." or ".." segments.',
    };
  }
  if (/[\0<>:"|?*]/.test(trimmedFolder)) {
    return {
      ok: false,
      error: 'Folder path contains invalid characters.',
    };
  }

  const cleanName = rawFileName.trim();
  if (!cleanName) {
    return { ok: false, error: 'File name cannot be empty.' };
  }
  if (cleanName.includes('/') || cleanName.includes('\\')) {
    return {
      ok: false,
      error: 'File name cannot include "/" or "\\". Specify subfolders in the folder path field.',
    };
  }
  if (cleanName === '.' || cleanName === '..' || /[\0<>:"|?*]/.test(cleanName)) {
    return {
      ok: false,
      error: 'File name is invalid or contains unsupported characters.',
    };
  }

  const folder = normalizeFolderPath(trimmedFolder);
  const candidatePath = `${folder}/${cleanName}`;
  const normalizedKey = candidatePath.toLowerCase();

  const collision = project.files.find(
    (f) => f.id !== excludeFileId && `${normalizeFolderPath(f.folder)}/${f.name}`.toLowerCase() === normalizedKey,
  );
  if (collision) {
    return {
      ok: false,
      error: `A file already exists at "${collision.path}" (paths are case-insensitive within a project).`,
    };
  }

  return { ok: true, folder, name: cleanName, path: candidatePath };
}

export function getProjectFolders(project: Project): string[] {
  const set = new Set<string>(project.folders ?? []);
  for (const file of project.files) {
    if (file.folder) set.add(file.folder);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function inferLanguageFromFilename(name: string): FileLanguage {
  const lower = name.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  return 'markdown';
}

export function createInitialWorkspaceState(
  activeOwnerUid: string | null = null,
): WorkspaceState {
  return {
    hydrated: false,
    activeOwnerUid,
    dataRevision: 0,
    persistedRevision: 0,
    uiRevision: 0,
    saveStatus: 'idle',
    lastSavedAt: null,
    storageError: null,
    workspaceNotice: null,
    activeWorkspace: 'chat',
    projectSubView: 'overview',
    leftDrawerOpen: false,
    rightDrawerOpen: false,
    projects: [],
    activeProjectId: null,
    previewSampleProjectId: null,
    openFileIds: [],
    activeFileId: null,
    expandedFolders: ['src', 'docs', 'app'],
    conversations: [],
    deletedConversations: [],
    voiceSessions: [],
    activeConversationId: null,
    selectedConversationIds: [],
    historyFilter: 'all',
    historySearch: '',
    previewViewport: 'mobile',
    previewNonce: 1,
    voiceSession: INITIAL_VOICE_SESSION,
    voiceSettings: DEFAULT_VOICE_SETTINGS,
    modelSettings: DEFAULT_MODEL_SETTINGS,
    appSettings: DEFAULT_APP_SETTINGS,
    settingRevisions: {},
    dirtyFileIds: [],
    dirtyFileRevisions: {},
    chatSending: false,
    chatStreaming: null,
    chatNotice: null,
  };
}

export function getActiveProject(state: WorkspaceState): Project | undefined {
  if (state.previewSampleProjectId) {
    return SAMPLE_PROJECTS.find((p) => p.id === state.previewSampleProjectId);
  }
  if (!state.activeProjectId) return state.projects[0];
  return state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0];
}

export function getActiveFile(state: WorkspaceState): ProjectFile | undefined {
  const project = getActiveProject(state);
  if (!project) return undefined;
  return project.files.find((f) => f.id === state.activeFileId) ?? project.files[0];
}

export function getActiveConversation(state: WorkspaceState): Conversation | undefined {
  if (!state.activeConversationId) return undefined;
  return state.conversations.find((c) => c.id === state.activeConversationId);
}

export function sortAndFilterConversations(
  conversations: Conversation[],
  filter: HistoryFilter,
  query: string,
): Conversation[] {
  const normalized = query.trim().toLowerCase();
  const filtered = conversations.filter((conv) => {
    if (filter === 'pinned' && !conv.isPinned) return false;
    if ((filter === 'voice' || filter === 'chat') && conv.kind !== filter) return false;
    if (!normalized) return true;
    return (
      conv.title.toLowerCase().includes(normalized) ||
      conv.summary.toLowerCase().includes(normalized) ||
      conv.messages.some((m) => m.content.toLowerCase().includes(normalized))
    );
  });

  return [...filtered].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function assemblePreviewDocument(
  project: Project,
  channelToken = 'preview-default',
): string {
  const htmlFile =
    project.files.find((f) => f.id === project.entryFileId && f.language === 'html') ??
    project.files.find((f) => f.language === 'html');
  const cssFiles = project.files.filter((f) => f.language === 'css');
  const jsFiles = project.files.filter((f) => f.language === 'javascript');

  const combinedCss = cssFiles.map((f) => f.content).join('\n\n');
  const combinedJs = jsFiles.map((f) => f.content).join('\n\n');

  const safeName = escapeHtml(project.name);
  const safeDesc = escapeHtml(project.description || 'Local-first project preview.');

  let output =
    htmlFile?.content ??
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${safeName}</title></head><body><main style="padding:24px;font-family:system-ui;color:#e2e8f0;background:#0b0e12;"><h1>${safeName}</h1><p>${safeDesc}</p></main></body></html>`;

  // Strip local relative stylesheet/script tags matching either full path or filename
  for (const cssFile of cssFiles) {
    const patterns = [cssFile.path, `${cssFile.folder}/${cssFile.name}`, cssFile.name]
      .filter(Boolean)
      .map(escapeRegExp);
    const refRegex = new RegExp(
      `<link[^>]+href=["'](?:\\.\\/|\\/|src\\/)?(?:${patterns.join('|')})["'][^>]*>`,
      'gi',
    );
    output = output.replace(refRegex, '');
  }
  for (const jsFile of jsFiles) {
    const patterns = [jsFile.path, `${jsFile.folder}/${jsFile.name}`, jsFile.name]
      .filter(Boolean)
      .map(escapeRegExp);
    const refRegex = new RegExp(
      `<script[^>]+src=["'](?:\\.\\/|\\/|src\\/)?(?:${patterns.join('|')})["'][^>]*>\\s*<\\/script>`,
      'gi',
    );
    output = output.replace(refRegex, '');
  }

  const safeChannelJson = safeJsonForHtmlScript(channelToken);

  if (combinedCss) {
    const safeCssJson = safeJsonForHtmlScript(combinedCss);
    const styleLoader = `<script id="__studio_css_payload" type="application/json">${safeCssJson}</script>
<script>
(function() {
  var el = document.getElementById('__studio_css_payload');
  if (!el) return;
  var style = document.createElement('style');
  style.textContent = JSON.parse(el.textContent || '""');
  (document.head || document.documentElement).appendChild(style);
})();
</script>`;
    output = output.includes('</head>')
      ? output.replace('</head>', `${styleLoader}\n</head>`)
      : `${styleLoader}\n${output}`;
  }

  const errorBridgeScript = `<script>
(function() {
  var CHANNEL = ${safeChannelJson};
  function report(msg) {
    window.parent.postMessage({ type: 'preview-error', channel: CHANNEL, message: String(msg || 'Runtime error') }, '*');
  }
  window.addEventListener('error', function(event) {
    report(event && event.message ? event.message : 'Runtime error');
  });
  window.addEventListener('unhandledrejection', function(event) {
    var reason = event && event.reason;
    report(reason && reason.message ? reason.message : String(reason || 'Unhandled promise rejection'));
  });
})();
</script>`;

  const runtimeScript = combinedJs
    ? `${errorBridgeScript}
<script id="__studio_js_payload" type="application/json">${safeJsonForHtmlScript(combinedJs)}</script>
<script>
(function() {
  var el = document.getElementById('__studio_js_payload');
  if (!el) return;
  var code = JSON.parse(el.textContent || '""');
  var s = document.createElement('script');
  s.textContent = code;
  document.body.appendChild(s);
})();
</script>`
    : errorBridgeScript;

  output = output.includes('</body>')
    ? output.replace('</body>', `${runtimeScript}\n</body>`)
    : `${output}\n${runtimeScript}`;

  return output;
}

function nowTimeLabel(override?: string): string {
  if (override) return override;
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function detectLanguageHint(text: string): 'en' | 'bn' | 'mixed' {
  const hasBangla = /[\u0980-\u09FF]/.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);
  if (hasBangla && hasLatin) return 'mixed';
  if (hasBangla) return 'bn';
  return 'en';
}

function resolveMutationSyncStatus(ownerUid: string | null): SyncStatus {
  return ownerUid ? 'pending' : 'local_only';
}

function cloneProjectWithNewIds(
  source: Project,
  nameOverride?: string,
  ownerUid: string | null = null,
): Project {
  const nowIso = new Date().toISOString();
  const newProjectId = generateStableId('proj');
  const nextSyncStatus = resolveMutationSyncStatus(ownerUid);
  let newEntryId = '';
  const clonedFiles: ProjectFile[] = source.files.map((f) => {
    const clonedId = generateStableId('file');
    if (f.id === source.entryFileId) newEntryId = clonedId;
    return {
      ...f,
      id: clonedId,
      createdAt: nowIso,
      updatedAt: nowIso,
      revision: 1,
      ownerUid,
      syncStatus: nextSyncStatus,
    };
  });

  return {
    ...source,
    id: newProjectId,
    name: nameOverride ?? source.name,
    createdAt: nowIso,
    updatedAt: nowIso,
    revision: 1,
    ownerUid,
    syncStatus: nextSyncStatus,
    entryFileId: newEntryId || clonedFiles[0]?.id || '',
    folders: getProjectFolders(source),
    files: clonedFiles,
    isSample: false,
  };
}

function markDataMutated(state: WorkspaceState, extra?: Partial<WorkspaceState>): WorkspaceState {
  return {
    ...state,
    ...extra,
    dataRevision: state.dataRevision + 1,
    saveStatus: 'unsaved',
  };
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case 'HYDRATE_FROM_STORAGE':
    case 'SET_ACTIVE_OWNER_AND_HYDRATE': {
      const {
        projects,
        conversations,
        deletedConversations,
        voiceSessions,
        preferences,
      } = action.snapshot;
      const nextOwnerUid =
        action.type === 'SET_ACTIVE_OWNER_AND_HYDRATE'
          ? action.activeOwnerUid
          : (action.activeOwnerUid ?? state.activeOwnerUid ?? null);

      const activeProjectId =
        preferences.activeProjectId && projects.some((p) => p.id === preferences.activeProjectId)
          ? preferences.activeProjectId
          : projects[0]?.id ?? null;

      const selectedProject = projects.find((p) => p.id === activeProjectId);
      const activeFileId =
        selectedProject &&
        preferences.activeFileId &&
        selectedProject.files.some((f) => f.id === preferences.activeFileId)
          ? preferences.activeFileId
          : selectedProject?.entryFileId ?? null;

      const activeConversationId =
        preferences.activeConversationId &&
        conversations.some((c) => c.id === preferences.activeConversationId)
          ? preferences.activeConversationId
          : conversations[0]?.id ?? null;

      const folders = selectedProject ? getProjectFolders(selectedProject) : state.expandedFolders;

      return {
        ...state,
        hydrated: true,
        activeOwnerUid: nextOwnerUid,
        dataRevision: 0,
        persistedRevision: 0,
        uiRevision: 0,
        saveStatus: 'saved',
        storageError: null,
        workspaceNotice: null,
        previewSampleProjectId: null,
        selectedConversationIds: [],
        chatSending: false,
        chatStreaming: null,
        chatNotice: null,
        projects,
        conversations,
        deletedConversations,
        voiceSessions: voiceSessions ?? [],
        activeProjectId,
        activeFileId,
        openFileIds: activeFileId ? [activeFileId] : [],
        expandedFolders: Array.from(new Set([...state.expandedFolders, ...folders])),
        activeConversationId,
        dirtyFileIds: [],
        dirtyFileRevisions: {},
        voiceSettings: preferences.voiceSettings
          ? sanitizeVoiceSettings(preferences.voiceSettings)
          : DEFAULT_VOICE_SETTINGS,
        modelSettings: preferences.modelSettings
          ? sanitizeModelSettings(preferences.modelSettings)
          : DEFAULT_MODEL_SETTINGS,
        appSettings: preferences.appSettings
          ? sanitizeAppSettings(preferences.appSettings)
          : DEFAULT_APP_SETTINGS,
        settingRevisions: { ...(preferences.settingRevisions ?? {}) },
      };
    }

    case 'APPLY_REMOTE_SNAPSHOT': {
      const {
        projects,
        conversations,
        deletedConversations,
        voiceSessions,
        preferences,
      } = action.snapshot;

      const activeProjectId =
        state.activeProjectId && projects.some((p) => p.id === state.activeProjectId)
          ? state.activeProjectId
          : preferences.activeProjectId && projects.some((p) => p.id === preferences.activeProjectId)
            ? preferences.activeProjectId
            : projects[0]?.id ?? null;

      const selectedProject = projects.find((p) => p.id === activeProjectId);
      const validOpenFileIds = selectedProject
        ? state.openFileIds.filter((id) => selectedProject.files.some((f) => f.id === id))
        : [];
      const activeFileId =
        selectedProject &&
        state.activeFileId &&
        selectedProject.files.some((f) => f.id === state.activeFileId)
          ? state.activeFileId
          : selectedProject?.entryFileId ?? selectedProject?.files[0]?.id ?? null;
      const openFileIds =
        validOpenFileIds.length > 0
          ? validOpenFileIds
          : activeFileId
            ? [activeFileId]
            : [];

      const activeConversationId =
        state.activeConversationId &&
        conversations.some((c) => c.id === state.activeConversationId)
          ? state.activeConversationId
          : preferences.activeConversationId &&
              conversations.some((c) => c.id === preferences.activeConversationId)
            ? preferences.activeConversationId
            : conversations[0]?.id ?? null;

      const folders = selectedProject ? getProjectFolders(selectedProject) : state.expandedFolders;

      return {
        ...state,
        projects,
        conversations,
        deletedConversations,
        voiceSessions: voiceSessions ?? [],
        activeProjectId,
        activeFileId,
        openFileIds,
        expandedFolders: Array.from(new Set([...state.expandedFolders, ...folders])),
        activeConversationId,
        selectedConversationIds: state.selectedConversationIds.filter((id) =>
          conversations.some((c) => c.id === id),
        ),
        voiceSettings: preferences.voiceSettings
          ? sanitizeVoiceSettings(preferences.voiceSettings)
          : state.voiceSettings,
        modelSettings: preferences.modelSettings
          ? sanitizeModelSettings(preferences.modelSettings)
          : state.modelSettings,
        appSettings: preferences.appSettings
          ? sanitizeAppSettings(preferences.appSettings)
          : state.appSettings,
        settingRevisions: { ...(preferences.settingRevisions ?? state.settingRevisions) },
        lastSavedAt: action.syncedAt ?? state.lastSavedAt,
      };
    }

    case 'SET_STORAGE_ERROR':
      return {
        ...state,
        hydrated: true,
        saveStatus: action.error ? 'error' : state.saveStatus,
        storageError: action.error,
      };

    case 'CLEAR_WORKSPACE_NOTICE':
      return {
        ...state,
        workspaceNotice: null,
      };

    case 'SET_SAVE_STATUS': {
      const confirmedRev =
        typeof action.persistedRevision === 'number'
          ? action.persistedRevision
          : action.clearDirty
            ? state.dataRevision
            : undefined;

      let nextDirtyIds = state.dirtyFileIds;
      let nextDirtyRevs = state.dirtyFileRevisions;

      if (confirmedRev !== undefined) {
        const remainingRevs: Record<string, number> = {};
        const remainingIds: string[] = [];
        for (const fileId of state.dirtyFileIds) {
          const rev = state.dirtyFileRevisions[fileId] ?? state.dataRevision;
          if (rev > confirmedRev) {
            remainingRevs[fileId] = rev;
            remainingIds.push(fileId);
          }
        }
        nextDirtyIds = remainingIds;
        nextDirtyRevs = remainingRevs;
      }

      const nextPersistedRevision =
        confirmedRev !== undefined
          ? Math.max(state.persistedRevision, confirmedRev)
          : state.persistedRevision;

      const effectiveStatus: SaveStatus =
        action.status === 'saved' && state.dataRevision > nextPersistedRevision
          ? 'unsaved'
          : action.status;

      return {
        ...state,
        saveStatus: effectiveStatus,
        persistedRevision: nextPersistedRevision,
        lastSavedAt: action.savedAt ?? state.lastSavedAt,
        dirtyFileIds: nextDirtyIds,
        dirtyFileRevisions: nextDirtyRevs,
        storageError: action.error !== undefined ? action.error : state.storageError,
      };
    }

    case 'SET_WORKSPACE':
      return { ...state, activeWorkspace: action.workspace };

    case 'SET_PROJECT_SUBVIEW':
      return { ...state, projectSubView: action.subView };

    case 'TOGGLE_LEFT_DRAWER':
      return {
        ...state,
        leftDrawerOpen: !state.leftDrawerOpen,
        rightDrawerOpen: !state.leftDrawerOpen ? false : state.rightDrawerOpen,
      };

    case 'SET_LEFT_DRAWER':
      return { ...state, leftDrawerOpen: action.open };

    case 'TOGGLE_RIGHT_DRAWER':
      return {
        ...state,
        rightDrawerOpen: !state.rightDrawerOpen,
        leftDrawerOpen: !state.rightDrawerOpen ? false : state.leftDrawerOpen,
      };

    case 'SET_RIGHT_DRAWER':
      return { ...state, rightDrawerOpen: action.open };

    case 'SELECT_PROJECT': {
      const target = state.projects.find((p) => p.id === action.projectId);
      if (!target) return state;
      const folders = getProjectFolders(target);
      const entryId = target.entryFileId || target.files[0]?.id || null;
      return {
        ...state,
        previewSampleProjectId: null,
        activeProjectId: target.id,
        openFileIds: entryId ? [entryId] : [],
        activeFileId: entryId,
        expandedFolders: Array.from(new Set([...state.expandedFolders, ...folders])),
        projectSubView: action.subView ?? state.projectSubView,
        activeWorkspace: 'projects',
        previewNonce: state.previewNonce + 1,
        uiRevision: state.uiRevision + 1,
      };
    }

    case 'PREVIEW_SAMPLE_PROJECT': {
      const sample = SAMPLE_PROJECTS.find((p) => p.id === action.sampleProjectId);
      if (!sample) return state;
      return {
        ...state,
        previewSampleProjectId: sample.id,
        openFileIds: [sample.entryFileId],
        activeFileId: sample.entryFileId,
        projectSubView: action.subView ?? 'preview',
        activeWorkspace: 'projects',
        previewNonce: state.previewNonce + 1,
      };
    }

    case 'CLONE_SAMPLE_PROJECT': {
      const sample = SAMPLE_PROJECTS.find((p) => p.id === action.sampleProjectId);
      if (!sample) return state;
      const cloned = cloneProjectWithNewIds(sample, sample.name, state.activeOwnerUid);
      return markDataMutated(state, {
        projects: [cloned, ...state.projects],
        previewSampleProjectId: null,
        activeProjectId: cloned.id,
        openFileIds: cloned.entryFileId ? [cloned.entryFileId] : [],
        activeFileId: cloned.entryFileId || null,
        expandedFolders: Array.from(
          new Set([...state.expandedFolders, ...getProjectFolders(cloned)]),
        ),
        projectSubView: 'code',
        activeWorkspace: 'projects',
      });
    }

    case 'CREATE_PROJECT': {
      const cleanName = action.name.trim();
      if (!cleanName) return state;
      const projectId = generateStableId('proj');
      const entryId = generateStableId('file');
      const cssId = generateStableId('file');
      const nowIso = new Date().toISOString();
      const safeTitle = escapeHtml(cleanName);
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      const newProject: Project = {
        id: projectId,
        name: cleanName,
        description: action.description?.trim() || 'Personal local-first workspace project.',
        framework: 'HTML · CSS · JS',
        createdAt: nowIso,
        updatedAt: nowIso,
        revision: 1,
        ownerUid: state.activeOwnerUid,
        syncStatus: nextSyncStatus,
        entryFileId: entryId,
        folders: ['src'],
        isSample: false,
        files: [
          {
            id: entryId,
            name: 'index.html',
            path: 'src/index.html',
            folder: 'src',
            language: 'html',
            createdAt: nowIso,
            updatedAt: nowIso,
            revision: 1,
            ownerUid: state.activeOwnerUid,
            syncStatus: nextSyncStatus,
            content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
</head>
<body>
  <main class="container">
    <h1>${safeTitle}</h1>
    <p>Saved locally in IndexedDB.</p>
  </main>
</body>
</html>`,
          },
          {
            id: cssId,
            name: 'styles.css',
            path: 'src/styles.css',
            folder: 'src',
            language: 'css',
            createdAt: nowIso,
            updatedAt: nowIso,
            revision: 1,
            ownerUid: state.activeOwnerUid,
            syncStatus: nextSyncStatus,
            content: `body {
  margin: 0;
  padding: 24px;
  background: #0b0e12;
  color: #edf2f7;
  font-family: system-ui, sans-serif;
}
.container {
  max-width: 440px;
  margin: 0 auto;
  padding: 20px;
  background: #131820;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
}`,
          },
        ],
      };

      return markDataMutated(state, {
        projects: [newProject, ...state.projects],
        previewSampleProjectId: null,
        activeProjectId: projectId,
        openFileIds: [entryId, cssId],
        activeFileId: entryId,
        expandedFolders: Array.from(new Set([...state.expandedFolders, 'src'])),
        projectSubView: 'code',
        activeWorkspace: 'projects',
      });
    }

    case 'RENAME_PROJECT': {
      const cleanName = action.name.trim();
      if (!cleanName) return state;
      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      return markDataMutated(state, {
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? {
                ...p,
                name: cleanName,
                updatedAt: nowIso,
                revision: (p.revision ?? 1) + 1,
                ownerUid: p.ownerUid ?? state.activeOwnerUid,
                syncStatus: nextSyncStatus,
              }
            : p,
        ),
      });
    }

    case 'DUPLICATE_PROJECT': {
      const source = state.projects.find((p) => p.id === action.projectId);
      if (!source) return state;
      const duplicated = cloneProjectWithNewIds(
        source,
        `${source.name} (Copy)`,
        state.activeOwnerUid,
      );
      return markDataMutated(state, {
        projects: [duplicated, ...state.projects],
        previewSampleProjectId: null,
        activeProjectId: duplicated.id,
        openFileIds: duplicated.entryFileId ? [duplicated.entryFileId] : [],
        activeFileId: duplicated.entryFileId || null,
        expandedFolders: Array.from(
          new Set([...state.expandedFolders, ...getProjectFolders(duplicated)]),
        ),
      });
    }

    case 'DELETE_PROJECT': {
      const remaining = state.projects.filter((p) => p.id !== action.projectId);
      const nextActive =
        state.activeProjectId === action.projectId
          ? remaining[0]?.id ?? null
          : state.activeProjectId;
      const nextProject = remaining.find((p) => p.id === nextActive);
      const deletedProject = state.projects.find((p) => p.id === action.projectId);
      const deletedFileSet = new Set(deletedProject?.files.map((f) => f.id) ?? []);
      const nextDirtyIds = state.dirtyFileIds.filter((id) => !deletedFileSet.has(id));
      const nextDirtyRevs = { ...state.dirtyFileRevisions };
      for (const fid of deletedFileSet) delete nextDirtyRevs[fid];

      return markDataMutated(state, {
        projects: remaining,
        activeProjectId: nextActive,
        openFileIds: nextProject?.entryFileId ? [nextProject.entryFileId] : [],
        activeFileId: nextProject?.entryFileId ?? null,
        dirtyFileIds: nextDirtyIds,
        dirtyFileRevisions: nextDirtyRevs,
        projectSubView: remaining.length === 0 ? 'overview' : state.projectSubView,
      });
    }

    case 'SELECT_FILE': {
      const openFileIds = state.openFileIds.includes(action.fileId)
        ? state.openFileIds
        : [...state.openFileIds, action.fileId];
      return {
        ...state,
        openFileIds,
        activeFileId: action.fileId,
        projectSubView: action.openCodeStudio ? 'code' : state.projectSubView,
        activeWorkspace: action.openCodeStudio ? 'projects' : state.activeWorkspace,
        uiRevision: state.uiRevision + 1,
      };
    }

    case 'CLOSE_FILE_TAB': {
      const remaining = state.openFileIds.filter((id) => id !== action.fileId);
      const project = getActiveProject(state);
      const fallbackId = project?.entryFileId ?? null;
      const nextActive =
        state.activeFileId === action.fileId
          ? remaining[remaining.length - 1] ?? fallbackId
          : state.activeFileId;
      return {
        ...state,
        openFileIds: remaining.length > 0 ? remaining : fallbackId ? [fallbackId] : [],
        activeFileId: nextActive,
        uiRevision: state.uiRevision + 1,
      };
    }

    case 'UPDATE_FILE_CONTENT': {
      if (state.previewSampleProjectId) return state;
      const nextRev = state.dataRevision + 1;
      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      const projects = state.projects.map((project) => {
        if (project.id !== state.activeProjectId) return project;
        return {
          ...project,
          updatedAt: nowIso,
          revision: (project.revision ?? 1) + 1,
          ownerUid: project.ownerUid ?? state.activeOwnerUid,
          syncStatus: nextSyncStatus,
          files: project.files.map((file) =>
            file.id === action.fileId
              ? {
                  ...file,
                  content: action.content,
                  updatedAt: nowIso,
                  revision: (file.revision ?? 1) + 1,
                  ownerUid: file.ownerUid ?? state.activeOwnerUid,
                  syncStatus: nextSyncStatus,
                }
              : file,
          ),
        };
      });
      const dirtyFileIds = state.dirtyFileIds.includes(action.fileId)
        ? state.dirtyFileIds
        : [...state.dirtyFileIds, action.fileId];
      return {
        ...state,
        projects,
        dirtyFileIds,
        dirtyFileRevisions: {
          ...state.dirtyFileRevisions,
          [action.fileId]: nextRev,
        },
        dataRevision: nextRev,
        saveStatus: 'unsaved',
      };
    }

    case 'MARK_FILE_SAVED': {
      const remaining = state.dirtyFileIds.filter((id) => id !== action.fileId);
      const nextRevs = { ...state.dirtyFileRevisions };
      delete nextRevs[action.fileId];
      return {
        ...state,
        dirtyFileIds: remaining,
        dirtyFileRevisions: nextRevs,
        saveStatus: remaining.length === 0 ? 'saved' : state.saveStatus,
      };
    }

    case 'CREATE_FILE': {
      if (state.previewSampleProjectId || !state.activeProjectId) return state;
      const activeProject = state.projects.find((p) => p.id === state.activeProjectId);
      if (!activeProject) return state;

      const validation = validateProjectFilePath(activeProject, action.folder, action.name);
      if (!validation.ok) {
        return { ...state, workspaceNotice: validation.error };
      }

      const { folder, name: cleanName, path: cleanPath } = validation;
      const newFileId = generateStableId('file');
      const nowIso = new Date().toISOString();
      const lang = inferLanguageFromFilename(cleanName);
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      const defaultContent =
        lang === 'html'
          ? `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8" /><title>${escapeHtml(cleanName)}</title></head>\n<body>\n  <main><h1>${escapeHtml(cleanName)}</h1></main>\n</body>\n</html>\n`
          : lang === 'css'
            ? `/* ${cleanName} */\n`
            : lang === 'json'
              ? `{\n  "name": "${cleanName}"\n}\n`
              : lang === 'markdown'
                ? `# ${cleanName}\n\n`
                : `// ${cleanName}\n`;

      const newFile: ProjectFile = {
        id: newFileId,
        name: cleanName,
        path: cleanPath,
        folder,
        language: lang,
        createdAt: nowIso,
        updatedAt: nowIso,
        revision: 1,
        ownerUid: state.activeOwnerUid,
        syncStatus: nextSyncStatus,
        content: defaultContent,
      };
      const projects = state.projects.map((project) => {
        if (project.id !== state.activeProjectId) return project;
        const folderSet = new Set(getProjectFolders(project));
        folderSet.add(folder);
        return {
          ...project,
          updatedAt: nowIso,
          revision: (project.revision ?? 1) + 1,
          ownerUid: project.ownerUid ?? state.activeOwnerUid,
          syncStatus: nextSyncStatus,
          folders: Array.from(folderSet),
          files: [...project.files, newFile],
        };
      });
      return markDataMutated(state, {
        projects,
        workspaceNotice: null,
        openFileIds: [...state.openFileIds, newFileId],
        activeFileId: newFileId,
        expandedFolders: Array.from(new Set([...state.expandedFolders, folder])),
        projectSubView: 'code',
        activeWorkspace: 'projects',
      });
    }

    case 'RENAME_FILE': {
      if (state.previewSampleProjectId || !state.activeProjectId) return state;
      const activeProject = state.projects.find((p) => p.id === state.activeProjectId);
      if (!activeProject) return state;
      const targetFile = activeProject.files.find((f) => f.id === action.fileId);
      if (!targetFile) return state;

      const validation = validateProjectFilePath(
        activeProject,
        targetFile.folder,
        action.newName,
        targetFile.id,
      );
      if (!validation.ok) {
        return { ...state, workspaceNotice: validation.error };
      }

      if (validation.name === targetFile.name && validation.folder === targetFile.folder) {
        return { ...state, workspaceNotice: null };
      }

      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      const projects = state.projects.map((project) => {
        if (project.id !== state.activeProjectId) return project;
        return {
          ...project,
          updatedAt: nowIso,
          revision: (project.revision ?? 1) + 1,
          ownerUid: project.ownerUid ?? state.activeOwnerUid,
          syncStatus: nextSyncStatus,
          files: project.files.map((file) =>
            file.id === action.fileId
              ? {
                  ...file,
                  name: validation.name,
                  path: validation.path,
                  language: inferLanguageFromFilename(validation.name),
                  updatedAt: nowIso,
                  revision: (file.revision ?? 1) + 1,
                  ownerUid: file.ownerUid ?? state.activeOwnerUid,
                  syncStatus: nextSyncStatus,
                }
              : file,
          ),
        };
      });
      return markDataMutated(state, { projects, workspaceNotice: null });
    }

    case 'DELETE_FILE': {
      if (state.previewSampleProjectId) return state;
      const activeProject = getActiveProject(state);
      if (!activeProject || activeProject.files.length <= 1) {
        return {
          ...state,
          workspaceNotice: 'Cannot delete the last remaining file in a project.',
        };
      }
      const remainingFiles = activeProject.files.filter((f) => f.id !== action.fileId);
      const nextEntry =
        activeProject.entryFileId === action.fileId
          ? remainingFiles[0].id
          : activeProject.entryFileId;
      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      const projects = state.projects.map((project) =>
        project.id === activeProject.id
          ? {
              ...project,
              updatedAt: nowIso,
              revision: (project.revision ?? 1) + 1,
              ownerUid: project.ownerUid ?? state.activeOwnerUid,
              syncStatus: nextSyncStatus,
              files: remainingFiles,
              entryFileId: nextEntry,
            }
          : project,
      );
      const openFileIds = state.openFileIds.filter((id) => id !== action.fileId);
      const activeFileId =
        state.activeFileId === action.fileId
          ? openFileIds[0] ?? remainingFiles[0].id
          : state.activeFileId;
      const nextDirtyRevs = { ...state.dirtyFileRevisions };
      delete nextDirtyRevs[action.fileId];

      return markDataMutated(state, {
        projects,
        workspaceNotice: null,
        openFileIds: openFileIds.length > 0 ? openFileIds : [remainingFiles[0].id],
        activeFileId,
        dirtyFileIds: state.dirtyFileIds.filter((id) => id !== action.fileId),
        dirtyFileRevisions: nextDirtyRevs,
      });
    }

    case 'CREATE_FOLDER': {
      if (state.previewSampleProjectId || !state.activeProjectId) return state;
      const rawTrim = action.folderPath.trim().replace(/\\/g, '/');
      if (
        !rawTrim ||
        rawTrim.split('/').some((seg) => seg.trim() === '..' || seg.trim() === '.')
      ) {
        return {
          ...state,
          workspaceNotice: 'Invalid folder path. Avoid empty segments, "." or "..".',
        };
      }
      const folderPath = normalizeFolderPath(action.folderPath);
      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      const projects = state.projects.map((project) => {
        if (project.id !== state.activeProjectId) return project;
        const folderSet = new Set(getProjectFolders(project));
        folderSet.add(folderPath);
        return {
          ...project,
          updatedAt: nowIso,
          revision: (project.revision ?? 1) + 1,
          ownerUid: project.ownerUid ?? state.activeOwnerUid,
          syncStatus: nextSyncStatus,
          folders: Array.from(folderSet),
        };
      });
      return markDataMutated(state, {
        projects,
        workspaceNotice: null,
        expandedFolders: Array.from(new Set([...state.expandedFolders, folderPath])),
      });
    }

    case 'RENAME_FOLDER': {
      if (state.previewSampleProjectId || !state.activeProjectId) return state;
      const activeProject = state.projects.find((p) => p.id === state.activeProjectId);
      if (!activeProject) return state;
      const oldPath = normalizeFolderPath(action.oldPath);
      const newPath = normalizeFolderPath(action.newPath);
      if (oldPath === newPath) return state;
      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);

      const remapFolder = (folder: string) => {
        if (folder === oldPath) return newPath;
        if (folder.startsWith(`${oldPath}/`)) return `${newPath}${folder.slice(oldPath.length)}`;
        return folder;
      };

      // Guard against file path collisions when merging/renaming into an existing folder
      const seenPaths = new Set<string>();
      for (const file of activeProject.files) {
        const mappedFolder = remapFolder(file.folder);
        const mappedKey = `${mappedFolder}/${file.name}`.toLowerCase();
        if (seenPaths.has(mappedKey)) {
          return {
            ...state,
            workspaceNotice: `Cannot rename folder to "${newPath}" because "${mappedFolder}/${file.name}" would collide with an existing file.`,
          };
        }
        seenPaths.add(mappedKey);
      }

      const projects = state.projects.map((project) => {
        if (project.id !== state.activeProjectId) return project;
        const nextFiles = project.files.map((file) => {
          const updatedFolder = remapFolder(file.folder);
          if (updatedFolder === file.folder) return file;
          return {
            ...file,
            folder: updatedFolder,
            path: `${updatedFolder}/${file.name}`,
            updatedAt: nowIso,
            revision: (file.revision ?? 1) + 1,
            ownerUid: file.ownerUid ?? state.activeOwnerUid,
            syncStatus: nextSyncStatus,
          };
        });
        const nextFolders = Array.from(new Set(getProjectFolders(project).map(remapFolder)));
        return {
          ...project,
          updatedAt: nowIso,
          revision: (project.revision ?? 1) + 1,
          ownerUid: project.ownerUid ?? state.activeOwnerUid,
          syncStatus: nextSyncStatus,
          folders: nextFolders,
          files: nextFiles,
        };
      });

      return markDataMutated(state, {
        projects,
        workspaceNotice: null,
        expandedFolders: Array.from(new Set(state.expandedFolders.map(remapFolder))),
      });
    }

    case 'DELETE_FOLDER': {
      if (state.previewSampleProjectId || !state.activeProjectId) return state;
      const activeProject = getActiveProject(state);
      if (!activeProject) return state;
      const target = normalizeFolderPath(action.folderPath);
      const matchesTarget = (folder: string) =>
        folder === target || folder.startsWith(`${target}/`);

      const remainingFiles = activeProject.files.filter((f) => !matchesTarget(f.folder));
      if (remainingFiles.length === 0) {
        return {
          ...state,
          workspaceNotice:
            'Cannot delete this folder because a project must keep at least one file. Create or move a file elsewhere first.',
        };
      }

      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      const nextEntry = remainingFiles.some((f) => f.id === activeProject.entryFileId)
        ? activeProject.entryFileId
        : remainingFiles[0].id;
      const remainingFolders = getProjectFolders(activeProject).filter((f) => !matchesTarget(f));
      const removedFileIds = new Set(
        activeProject.files.filter((f) => matchesTarget(f.folder)).map((f) => f.id),
      );

      const projects = state.projects.map((p) =>
        p.id === activeProject.id
          ? {
              ...p,
              updatedAt: nowIso,
              revision: (p.revision ?? 1) + 1,
              ownerUid: p.ownerUid ?? state.activeOwnerUid,
              syncStatus: nextSyncStatus,
              folders: remainingFolders,
              files: remainingFiles,
              entryFileId: nextEntry,
            }
          : p,
      );

      const openFileIds = state.openFileIds.filter((id) => !removedFileIds.has(id));
      const activeFileId =
        state.activeFileId && !removedFileIds.has(state.activeFileId)
          ? state.activeFileId
          : openFileIds[0] ?? remainingFiles[0].id;
      const nextDirtyRevs = { ...state.dirtyFileRevisions };
      for (const fid of removedFileIds) delete nextDirtyRevs[fid];

      return markDataMutated(state, {
        projects,
        workspaceNotice: null,
        openFileIds: openFileIds.length > 0 ? openFileIds : [remainingFiles[0].id],
        activeFileId,
        dirtyFileIds: state.dirtyFileIds.filter((id) => !removedFileIds.has(id)),
        dirtyFileRevisions: nextDirtyRevs,
      });
    }

    case 'TOGGLE_FOLDER': {
      const exists = state.expandedFolders.includes(action.folderPath);
      return {
        ...state,
        expandedFolders: exists
          ? state.expandedFolders.filter((f) => f !== action.folderPath)
          : [...state.expandedFolders, action.folderPath],
      };
    }

    case 'SELECT_CONVERSATION':
      return {
        ...state,
        activeConversationId: action.conversationId,
        activeWorkspace: action.openChat ? 'chat' : state.activeWorkspace,
        chatSending: false,
        chatStreaming: null,
        chatNotice: null,
        uiRevision: state.uiRevision + 1,
      };

    case 'CREATE_CONVERSATION': {
      const id = generateStableId('conv');
      const kind = action.kind ?? 'chat';
      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      const newConversation: Conversation = {
        id,
        title: action.title?.trim() || (kind === 'voice' ? 'New Voice Session' : 'New Conversation'),
        kind,
        projectId: state.activeProjectId,
        createdAt: nowIso,
        updatedAt: nowIso,
        revision: 1,
        ownerUid: state.activeOwnerUid,
        syncStatus: nextSyncStatus,
        isPinned: false,
        summary: '',
        messages: [],
        isSample: false,
      };
      return markDataMutated(state, {
        conversations: [newConversation, ...state.conversations],
        activeConversationId: id,
        activeWorkspace: 'chat',
        chatSending: false,
        chatStreaming: null,
        chatNotice: null,
      });
    }

    case 'RENAME_CONVERSATION': {
      const cleanTitle = action.title.trim();
      if (!cleanTitle) return state;
      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      return markDataMutated(state, {
        conversations: state.conversations.map((conv) =>
          conv.id === action.conversationId
            ? {
                ...conv,
                title: cleanTitle,
                updatedAt: nowIso,
                revision: (conv.revision ?? 1) + 1,
                ownerUid: conv.ownerUid ?? state.activeOwnerUid,
                syncStatus: nextSyncStatus,
              }
            : conv,
        ),
      });
    }

    case 'TOGGLE_PIN_CONVERSATION': {
      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      return markDataMutated(state, {
        conversations: state.conversations.map((conv) =>
          conv.id === action.conversationId
            ? {
                ...conv,
                isPinned: !conv.isPinned,
                updatedAt: nowIso,
                revision: (conv.revision ?? 1) + 1,
                ownerUid: conv.ownerUid ?? state.activeOwnerUid,
                syncStatus: nextSyncStatus,
              }
            : conv,
        ),
      });
    }

    case 'DELETE_CONVERSATION': {
      const target = state.conversations.find((c) => c.id === action.conversationId);
      if (!target) return state;
      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      const remaining = state.conversations.filter((c) => c.id !== action.conversationId);
      const nextActive =
        state.activeConversationId === action.conversationId
          ? remaining[0]?.id ?? null
          : state.activeConversationId;
      return markDataMutated(state, {
        conversations: remaining,
        deletedConversations: [
          {
            ...target,
            deletedAt: nowIso,
            updatedAt: nowIso,
            revision: (target.revision ?? 1) + 1,
            ownerUid: target.ownerUid ?? state.activeOwnerUid,
            syncStatus: nextSyncStatus,
          },
          ...state.deletedConversations,
        ],
        activeConversationId: nextActive,
        selectedConversationIds: state.selectedConversationIds.filter(
          (id) => id !== action.conversationId,
        ),
      });
    }

    case 'RESTORE_DELETED_CONVERSATION': {
      const target = state.deletedConversations.find((c) => c.id === action.conversationId);
      if (!target) return state;
      const { deletedAt: _omit, ...restored } = target;
      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      return markDataMutated(state, {
        deletedConversations: state.deletedConversations.filter(
          (c) => c.id !== action.conversationId,
        ),
        conversations: [
          {
            ...restored,
            updatedAt: nowIso,
            revision: (restored.revision ?? 1) + 1,
            ownerUid: restored.ownerUid ?? state.activeOwnerUid,
            syncStatus: nextSyncStatus,
          },
          ...state.conversations,
        ],
        activeConversationId: restored.id,
      });
    }

    case 'PERMANENTLY_DELETE_CONVERSATION': {
      const target = state.deletedConversations.find((c) => c.id === action.conversationId);
      const linkedVoiceIds = new Set(target?.voiceSessionIds ?? []);
      return markDataMutated(state, {
        deletedConversations: state.deletedConversations.filter(
          (c) => c.id !== action.conversationId,
        ),
        voiceSessions: state.voiceSessions.filter(
          (s) => s.conversationId !== action.conversationId && !linkedVoiceIds.has(s.id),
        ),
      });
    }

    case 'TOGGLE_SELECT_CONVERSATION': {
      const exists = state.selectedConversationIds.includes(action.conversationId);
      return {
        ...state,
        selectedConversationIds: exists
          ? state.selectedConversationIds.filter((id) => id !== action.conversationId)
          : [...state.selectedConversationIds, action.conversationId],
      };
    }

    case 'SELECT_ALL_CONVERSATIONS':
      return {
        ...state,
        selectedConversationIds: action.conversationIds,
      };

    case 'CLEAR_SELECTED_CONVERSATIONS':
      return {
        ...state,
        selectedConversationIds: [],
      };

    case 'BULK_DELETE_CONVERSATIONS': {
      if (state.selectedConversationIds.length === 0) return state;
      const selectedSet = new Set(state.selectedConversationIds);
      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      const toDelete = state.conversations
        .filter((c) => selectedSet.has(c.id))
        .map((c) => ({
          ...c,
          deletedAt: nowIso,
          updatedAt: nowIso,
          revision: (c.revision ?? 1) + 1,
          ownerUid: c.ownerUid ?? state.activeOwnerUid,
          syncStatus: nextSyncStatus,
        }));
      const remaining = state.conversations.filter((c) => !selectedSet.has(c.id));
      const nextActive =
        state.activeConversationId && selectedSet.has(state.activeConversationId)
          ? remaining[0]?.id ?? null
          : state.activeConversationId;
      return markDataMutated(state, {
        conversations: remaining,
        deletedConversations: [...toDelete, ...state.deletedConversations],
        selectedConversationIds: [],
        activeConversationId: nextActive,
      });
    }

    case 'CLONE_SAMPLE_CONVERSATION': {
      const sample = SAMPLE_CONVERSATIONS.find((c) => c.id === action.sampleConversationId);
      if (!sample) return state;
      const nowIso = new Date().toISOString();
      const newId = generateStableId('conv');
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      const cloned: Conversation = {
        ...sample,
        id: newId,
        title: sample.title.replace(/^Sample:\s*/i, ''),
        createdAt: nowIso,
        updatedAt: nowIso,
        revision: 1,
        ownerUid: state.activeOwnerUid,
        syncStatus: nextSyncStatus,
        isPinned: false,
        isSample: false,
        messages: sample.messages.map((m) => ({
          ...m,
          id: generateStableId('msg'),
          createdAt: nowIso,
          updatedAt: nowIso,
          revision: 1,
          ownerUid: state.activeOwnerUid,
          syncStatus: nextSyncStatus,
        })),
      };
      return markDataMutated(state, {
        conversations: [cloned, ...state.conversations],
        activeConversationId: newId,
        activeWorkspace: 'chat',
      });
    }

    case 'SEND_USER_MESSAGE': {
      const trimmed = action.text.trim();
      if (!trimmed) return state;
      const time = nowTimeLabel(action.timestamp);
      const lang = detectLanguageHint(trimmed);
      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);

      const userMessage: ChatMessage = {
        id: generateStableId('msg'),
        role: 'user',
        content: trimmed,
        timestamp: time,
        createdAt: nowIso,
        updatedAt: nowIso,
        revision: 1,
        ownerUid: state.activeOwnerUid,
        syncStatus: nextSyncStatus,
        source: 'text',
        language: lang,
      };

      if (
        !state.activeConversationId ||
        !state.conversations.some((c) => c.id === state.activeConversationId)
      ) {
        const newId = action.conversationId ?? generateStableId('conv');
        const created: Conversation = {
          id: newId,
          title: trimmed.slice(0, 48),
          kind: 'chat',
          projectId: state.activeProjectId,
          createdAt: nowIso,
          updatedAt: nowIso,
          revision: 1,
          ownerUid: state.activeOwnerUid,
          syncStatus: nextSyncStatus,
          isPinned: false,
          summary: trimmed.slice(0, 120),
          messages: [userMessage],
          isSample: false,
        };
        return markDataMutated(state, {
          conversations: [created, ...state.conversations],
          activeConversationId: newId,
          chatSending: true,
          chatStreaming: {
            conversationId: newId,
            text: '',
            modelUsed: null,
            fallbackUsed: false,
          },
          chatNotice: null,
        });
      }

      const activeId = state.activeConversationId;
      const conversations = state.conversations.map((conv) => {
        if (conv.id !== activeId) return conv;
        const isFirst = conv.messages.length === 0;
        const nextTitle =
          isFirst && (conv.title === 'New Conversation' || conv.title === 'New Voice Session')
            ? trimmed.slice(0, 48)
            : conv.title;
        return {
          ...conv,
          title: nextTitle,
          summary: conv.summary || trimmed.slice(0, 120),
          updatedAt: nowIso,
          revision: (conv.revision ?? 1) + 1,
          ownerUid: conv.ownerUid ?? state.activeOwnerUid,
          syncStatus: nextSyncStatus,
          messages: [...conv.messages, userMessage],
        };
      });

      return markDataMutated(state, {
        conversations,
        chatSending: true,
        chatStreaming: {
          conversationId: activeId,
          text: '',
          modelUsed: null,
          fallbackUsed: false,
        },
        chatNotice: null,
      });
    }

    case 'RETRY_CHAT_REQUEST':
      return {
        ...state,
        chatSending: true,
        chatStreaming: state.activeConversationId
          ? {
              conversationId: state.activeConversationId,
              text: '',
              modelUsed: null,
              fallbackUsed: false,
            }
          : null,
        chatNotice: null,
      };

    case 'PREPARE_REGENERATE_RESPONSE': {
      const target = state.conversations.find((c) => c.id === action.conversationId);
      if (!target || target.messages.length === 0) return state;
      const lastMsg = target.messages[target.messages.length - 1];
      if (lastMsg.role !== 'assistant') {
        return {
          ...state,
          chatSending: true,
          chatStreaming: {
            conversationId: target.id,
            text: '',
            modelUsed: null,
            fallbackUsed: false,
          },
          chatNotice: null,
        };
      }

      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      return markDataMutated(state, {
        chatSending: true,
        chatStreaming: {
          conversationId: target.id,
          text: '',
          modelUsed: null,
          fallbackUsed: false,
        },
        chatNotice: null,
        conversations: state.conversations.map((conv) =>
          conv.id === target.id
            ? {
                ...conv,
                updatedAt: nowIso,
                revision: (conv.revision ?? 1) + 1,
                ownerUid: conv.ownerUid ?? state.activeOwnerUid,
                syncStatus: nextSyncStatus,
                messages: conv.messages.slice(0, -1),
              }
            : conv,
        ),
      });
    }

    case 'CHAT_STREAM_META':
      if (!state.chatSending) return state;
      return {
        ...state,
        chatStreaming: {
          conversationId: action.conversationId,
          text:
            state.chatStreaming?.conversationId === action.conversationId
              ? state.chatStreaming.text
              : '',
          modelUsed: action.modelUsed,
          fallbackUsed: action.fallbackUsed,
        },
      };

    case 'CHAT_STREAM_DELTA':
      if (!state.chatSending || !action.delta) return state;
      return {
        ...state,
        chatStreaming:
          state.chatStreaming && state.chatStreaming.conversationId === action.conversationId
            ? {
                ...state.chatStreaming,
                text: state.chatStreaming.text + action.delta,
              }
            : {
                conversationId: action.conversationId,
                text: action.delta,
                modelUsed: null,
                fallbackUsed: false,
              },
      };

    case 'CHAT_RESPONSE_RECEIVED': {
      const trimmed = action.reply.trim();
      if (!trimmed) {
        return { ...state, chatSending: false, chatStreaming: null };
      }
      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      const assistantMessage: ChatMessage = {
        id: generateStableId('msg'),
        role: 'assistant',
        content: trimmed,
        timestamp: nowTimeLabel(action.timestamp),
        createdAt: nowIso,
        updatedAt: nowIso,
        revision: 1,
        ownerUid: state.activeOwnerUid,
        syncStatus: nextSyncStatus,
        source: 'text',
        language: detectLanguageHint(trimmed),
        modelUsed: action.modelUsed,
        fallbackUsed: action.fallbackUsed,
        usage: action.usage ?? undefined,
        stopped: action.stopped,
      };
      return markDataMutated(state, {
        chatSending: false,
        chatStreaming: null,
        chatNotice: null,
        conversations: state.conversations.map((conv) =>
          conv.id === action.conversationId
            ? {
                ...conv,
                updatedAt: nowIso,
                revision: (conv.revision ?? 1) + 1,
                ownerUid: conv.ownerUid ?? state.activeOwnerUid,
                syncStatus: nextSyncStatus,
                messages: [...conv.messages, assistantMessage],
              }
            : conv,
        ),
      });
    }

    case 'CHAT_RESPONSE_FAILED':
      return {
        ...state,
        chatSending: false,
        chatStreaming: null,
        chatNotice: {
          kind: action.kind,
          message: action.message,
          retryable: action.retryable,
        },
      };

    case 'CLEAR_CHAT_NOTICE':
      return { ...state, chatNotice: null };

    case 'CLEAR_ACTIVE_CONVERSATION': {
      if (!state.activeConversationId) return state;
      const nowIso = new Date().toISOString();
      const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
      return markDataMutated(state, {
        chatSending: false,
        chatStreaming: null,
        chatNotice: null,
        conversations: state.conversations.map((conv) =>
          conv.id === state.activeConversationId
            ? {
                ...conv,
                messages: [],
                summary: '',
                updatedAt: nowIso,
                revision: (conv.revision ?? 1) + 1,
                ownerUid: conv.ownerUid ?? state.activeOwnerUid,
                syncStatus: nextSyncStatus,
              }
            : conv,
        ),
      });
    }

    case 'SET_HISTORY_FILTER':
      return { ...state, historyFilter: action.filter };

    case 'SET_HISTORY_SEARCH':
      return { ...state, historySearch: action.query };

    case 'SET_PREVIEW_VIEWPORT':
      return { ...state, previewViewport: action.viewport };

    case 'REFRESH_PREVIEW':
      return { ...state, previewNonce: state.previewNonce + 1 };

    case 'UPDATE_VOICE_SETTINGS': {
      const nextVoice = sanitizeVoiceSettings({
        ...state.voiceSettings,
        ...action.patch,
        saveRawAudio: false,
      });
      return markDataMutated(state, {
        voiceSettings: nextVoice,
        settingRevisions: {
          ...state.settingRevisions,
          voiceSettings: (state.settingRevisions.voiceSettings ?? 0) + 1,
        },
      });
    }

    case 'UPDATE_MODEL_SETTINGS':
      return markDataMutated(state, {
        modelSettings: sanitizeModelSettings({ ...state.modelSettings, ...action.patch }),
        settingRevisions: {
          ...state.settingRevisions,
          modelSettings: (state.settingRevisions.modelSettings ?? 0) + 1,
        },
      });

    case 'UPDATE_APP_SETTINGS':
      return markDataMutated(state, {
        appSettings: sanitizeAppSettings({ ...state.appSettings, ...action.patch }),
        settingRevisions: {
          ...state.settingRevisions,
          appSettings: (state.settingRevisions.appSettings ?? 0) + 1,
        },
      });

    case 'RECORD_VOICE_SESSION': {
      const nowIso = new Date().toISOString();
      const ownerUid = action.record.ownerUid ?? state.activeOwnerUid;
      const safeRecord: VoiceSessionRecord = {
        ...action.record,
        createdAt: action.record.createdAt || action.record.startedAt || nowIso,
        updatedAt: action.record.updatedAt || action.record.endedAt || nowIso,
        revision: action.record.revision ?? 1,
        ownerUid,
        syncStatus: action.record.syncStatus ?? resolveMutationSyncStatus(ownerUid),
        rawAudioStored: false,
        transcripts: state.voiceSettings.saveTranscripts ? action.record.transcripts : [],
        transcriptsSaved: Boolean(
          state.voiceSettings.saveTranscripts && action.record.transcripts.length > 0,
        ),
      };
      return markDataMutated(state, {
        voiceSessions: [safeRecord, ...state.voiceSessions],
      });
    }

    case 'IMPORT_WORKSPACE_BUNDLE':
      return applyImportWorkspaceBundle(state, {
        bundle: action.bundle,
        duplicateStrategy: action.duplicateStrategy,
        restorePreferences: action.restorePreferences,
      });

    case 'APPLY_COMMITTED_IMPORT':
      return {
        ...action.nextState,
        persistedRevision: action.nextState.dataRevision,
        saveStatus: 'saved',
        lastSavedAt: action.savedAt,
        storageError: null,
        workspaceNotice: null,
      };

    case 'ROLLBACK_TO_COMMITTED_SNAPSHOT': {
      const {
        projects,
        conversations,
        deletedConversations,
        voiceSessions,
        preferences,
      } = action.snapshot;
      const activeProjectId =
        state.activeProjectId && projects.some((p) => p.id === state.activeProjectId)
          ? state.activeProjectId
          : preferences.activeProjectId && projects.some((p) => p.id === preferences.activeProjectId)
            ? preferences.activeProjectId
            : projects[0]?.id ?? null;
      const selectedProject = projects.find((p) => p.id === activeProjectId);
      const activeFileId =
        selectedProject &&
        state.activeFileId &&
        selectedProject.files.some((f) => f.id === state.activeFileId)
          ? state.activeFileId
          : selectedProject?.entryFileId ?? selectedProject?.files[0]?.id ?? null;
      const activeConversationId =
        state.activeConversationId &&
        conversations.some((c) => c.id === state.activeConversationId)
          ? state.activeConversationId
          : preferences.activeConversationId &&
              conversations.some((c) => c.id === preferences.activeConversationId)
            ? preferences.activeConversationId
            : conversations[0]?.id ?? null;

      return {
        ...state,
        activeOwnerUid: action.activeOwnerUid ?? state.activeOwnerUid,
        projects,
        conversations,
        deletedConversations,
        voiceSessions,
        activeProjectId,
        activeFileId,
        openFileIds: activeFileId ? [activeFileId] : [],
        activeConversationId,
        voiceSettings: preferences.voiceSettings
          ? sanitizeVoiceSettings(preferences.voiceSettings)
          : state.voiceSettings,
        modelSettings: preferences.modelSettings
          ? sanitizeModelSettings(preferences.modelSettings)
          : state.modelSettings,
        appSettings: preferences.appSettings
          ? sanitizeAppSettings(preferences.appSettings)
          : state.appSettings,
        settingRevisions: { ...(preferences.settingRevisions ?? state.settingRevisions) },
        dirtyFileIds: [],
        dirtyFileRevisions: {},
        persistedRevision: state.dataRevision,
        saveStatus: 'saved',
        storageError: null,
        workspaceNotice: 'Reverted unsaved changes back to the last persisted IndexedDB state.',
      };
    }

    case 'CLEAR_ALL_LOCAL_DATA':
      return {
        ...createInitialWorkspaceState(action.activeOwnerUid ?? null),
        hydrated: true,
        saveStatus: 'saved',
      };

    case 'VOICE_EVENT':
      return {
        ...state,
        voiceSession: transitionVoiceSession(state.voiceSession, action.event),
      };

    default:
      return state;
  }
}

export function applyImportWorkspaceBundle(
  state: WorkspaceState,
  options: {
    bundle: WorkspaceExportBundle;
    duplicateStrategy?: 'skip' | 'copy';
    restorePreferences?: boolean;
  },
): WorkspaceState {
  const { bundle, duplicateStrategy = 'skip', restorePreferences = false } = options;

  const existingProjectIds = new Set(state.projects.map((p) => p.id));
  const existingFileIds = new Set(state.projects.flatMap((p) => p.files.map((f) => f.id)));
  const existingConvIds = new Set(state.conversations.map((c) => c.id));
  const existingDeletedIds = new Set(state.deletedConversations.map((c) => c.id));
  const existingVoiceIds = new Set(state.voiceSessions.map((v) => v.id));

  const projectIdMap = new Map<string, string>();
  const conversationIdMap = new Map<string, string>();
  const voiceSessionIdMap = new Map<string, string>();

  const allocateUniqueId = (prefix: string, taken: Set<string>): string => {
    let candidate = generateStableId(prefix);
    while (taken.has(candidate)) {
      candidate = generateStableId(prefix);
    }
    taken.add(candidate);
    return candidate;
  };

  const nextSyncStatus = resolveMutationSyncStatus(state.activeOwnerUid);
  const ownerUid = state.activeOwnerUid;

  const ensureUniqueProjectFiles = (proj: Project): Project => {
    let entryId = proj.entryFileId;
    const files = proj.files.map((f) => {
      if (!existingFileIds.has(f.id)) {
        existingFileIds.add(f.id);
        return { ...f, ownerUid, syncStatus: nextSyncStatus };
      }
      const freshId = allocateUniqueId('file', existingFileIds);
      if (f.id === entryId) entryId = freshId;
      return { ...f, id: freshId, ownerUid, syncStatus: nextSyncStatus };
    });
    return {
      ...proj,
      ownerUid,
      syncStatus: nextSyncStatus,
      folders: getProjectFolders(proj),
      files,
      entryFileId: entryId || files[0]?.id || '',
    };
  };

  // Pass 1: Allocate IDs for projects, conversations, deletedConversations, and voiceSessions
  const importedProjects: Project[] = [];
  for (const proj of bundle.projects) {
    if (!existingProjectIds.has(proj.id)) {
      existingProjectIds.add(proj.id);
      projectIdMap.set(proj.id, proj.id);
      importedProjects.push(ensureUniqueProjectFiles(proj));
    } else if (duplicateStrategy === 'copy') {
      const cloned = cloneProjectWithNewIds(proj, `${proj.name} (Imported)`, ownerUid);
      while (existingProjectIds.has(cloned.id)) {
        cloned.id = generateStableId('proj');
      }
      existingProjectIds.add(cloned.id);
      cloned.files.forEach((f) => existingFileIds.add(f.id));
      projectIdMap.set(proj.id, cloned.id);
      importedProjects.push(cloned);
    }
  }

  const pendingImportedConversations: Array<{ source: Conversation; item: Conversation }> = [];
  for (const conv of bundle.conversations) {
    if (!existingConvIds.has(conv.id) && !existingDeletedIds.has(conv.id)) {
      existingConvIds.add(conv.id);
      conversationIdMap.set(conv.id, conv.id);
      pendingImportedConversations.push({
        source: conv,
        item: {
          ...conv,
          ownerUid,
          syncStatus: nextSyncStatus,
          messages: conv.messages.map((m) => ({
            ...m,
            ownerUid,
            syncStatus: nextSyncStatus,
          })),
        },
      });
    } else if (duplicateStrategy === 'copy') {
      const clonedId = allocateUniqueId('conv', existingConvIds);
      existingDeletedIds.add(clonedId);
      conversationIdMap.set(conv.id, clonedId);
      pendingImportedConversations.push({
        source: conv,
        item: {
          ...conv,
          id: clonedId,
          title: `${conv.title} (Imported)`,
          revision: 1,
          syncStatus: nextSyncStatus,
          ownerUid,
          messages: conv.messages.map((m) => ({
            ...m,
            id: generateStableId('msg'),
            revision: 1,
            syncStatus: nextSyncStatus,
            ownerUid,
          })),
        },
      });
    }
  }

  const pendingImportedDeleted: Array<{ source: Conversation; item: Conversation }> = [];
  for (const trashed of bundle.deletedConversations) {
    if (!existingDeletedIds.has(trashed.id) && !existingConvIds.has(trashed.id)) {
      existingDeletedIds.add(trashed.id);
      conversationIdMap.set(trashed.id, trashed.id);
      pendingImportedDeleted.push({
        source: trashed,
        item: {
          ...trashed,
          ownerUid,
          syncStatus: nextSyncStatus,
          messages: trashed.messages.map((m) => ({
            ...m,
            ownerUid,
            syncStatus: nextSyncStatus,
          })),
        },
      });
    } else if (duplicateStrategy === 'copy') {
      const clonedId = allocateUniqueId('conv', existingDeletedIds);
      existingConvIds.add(clonedId);
      conversationIdMap.set(trashed.id, clonedId);
      pendingImportedDeleted.push({
        source: trashed,
        item: {
          ...trashed,
          id: clonedId,
          title: `${trashed.title} (Imported)`,
          deletedAt: trashed.deletedAt || new Date().toISOString(),
          revision: 1,
          syncStatus: nextSyncStatus,
          ownerUid,
          messages: trashed.messages.map((m) => ({
            ...m,
            id: generateStableId('msg'),
            revision: 1,
            syncStatus: nextSyncStatus,
            ownerUid,
          })),
        },
      });
    }
  }

  const pendingImportedVoice: Array<{ source: VoiceSessionRecord; item: VoiceSessionRecord }> = [];
  for (const session of bundle.voiceSessions ?? []) {
    if (!existingVoiceIds.has(session.id)) {
      existingVoiceIds.add(session.id);
      voiceSessionIdMap.set(session.id, session.id);
      pendingImportedVoice.push({
        source: session,
        item: {
          ...session,
          ownerUid,
          syncStatus: nextSyncStatus,
          rawAudioStored: false,
        },
      });
    } else if (duplicateStrategy === 'copy') {
      const clonedId = allocateUniqueId('voice', existingVoiceIds);
      voiceSessionIdMap.set(session.id, clonedId);
      pendingImportedVoice.push({
        source: session,
        item: {
          ...session,
          id: clonedId,
          revision: 1,
          syncStatus: nextSyncStatus,
          ownerUid,
          rawAudioStored: false,
        },
      });
    }
  }

  // Pass 2: Remap cross-entity references consistently against merged workspace IDs
  const validProjectIds = existingProjectIds;
  const validConvIds = new Set([...existingConvIds, ...existingDeletedIds]);
  const validVoiceIds = existingVoiceIds;

  const resolveProjectId = (oldProjectId: string | null): string | null => {
    if (!oldProjectId) return null;
    const remapped = projectIdMap.get(oldProjectId);
    if (remapped) return remapped;
    return validProjectIds.has(oldProjectId) ? oldProjectId : null;
  };

  const resolveConversationId = (oldConvId: string | null): string | null => {
    if (!oldConvId) return null;
    const remapped = conversationIdMap.get(oldConvId);
    if (remapped) return remapped;
    return validConvIds.has(oldConvId) ? oldConvId : null;
  };

  const resolveVoiceSessionIds = (oldIds?: string[]): string[] => {
    if (!Array.isArray(oldIds) || oldIds.length === 0) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const oldId of oldIds) {
      const resolved = voiceSessionIdMap.get(oldId) ?? (validVoiceIds.has(oldId) ? oldId : null);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        out.push(resolved);
      }
    }
    return out;
  };

  const importedConversations: Conversation[] = pendingImportedConversations.map(({ source, item }) => ({
    ...item,
    projectId: resolveProjectId(source.projectId),
    voiceSessionIds: resolveVoiceSessionIds(source.voiceSessionIds),
  }));

  const importedDeleted: Conversation[] = pendingImportedDeleted.map(({ source, item }) => ({
    ...item,
    projectId: resolveProjectId(source.projectId),
    voiceSessionIds: resolveVoiceSessionIds(source.voiceSessionIds),
  }));

  const importedVoice: VoiceSessionRecord[] = pendingImportedVoice.map(({ source, item }) => ({
    ...item,
    conversationId: resolveConversationId(source.conversationId),
  }));

  const mergedProjects = [...importedProjects, ...state.projects];
  const mergedConversations = [...importedConversations, ...state.conversations];
  const mergedDeleted = [...importedDeleted, ...state.deletedConversations];
  const mergedVoice = [...importedVoice, ...state.voiceSessions];

  // Never overwrite studio settings unless user explicitly opts in
  const applyVoicePref = Boolean(restorePreferences && bundle.preferences?.voiceSettings);
  const applyModelPref = Boolean(restorePreferences && bundle.preferences?.modelSettings);
  const applyAppPref = Boolean(restorePreferences && bundle.preferences?.appSettings);

  const nextVoiceSettings = applyVoicePref
    ? sanitizeVoiceSettings(bundle.preferences!.voiceSettings)
    : state.voiceSettings;
  const nextModelSettings = applyModelPref
    ? sanitizeModelSettings(bundle.preferences!.modelSettings)
    : state.modelSettings;
  const nextAppSettings = applyAppPref
    ? sanitizeAppSettings(bundle.preferences!.appSettings)
    : state.appSettings;

  const nextSettingRevisions = { ...state.settingRevisions };
  if (applyVoicePref) {
    nextSettingRevisions.voiceSettings = (nextSettingRevisions.voiceSettings ?? 0) + 1;
  }
  if (applyModelPref) {
    nextSettingRevisions.modelSettings = (nextSettingRevisions.modelSettings ?? 0) + 1;
  }
  if (applyAppPref) {
    nextSettingRevisions.appSettings = (nextSettingRevisions.appSettings ?? 0) + 1;
  }

  return markDataMutated(state, {
    projects: mergedProjects,
    conversations: mergedConversations,
    deletedConversations: mergedDeleted,
    voiceSessions: mergedVoice,
    activeProjectId: state.activeProjectId ?? mergedProjects[0]?.id ?? null,
    activeFileId:
      state.activeFileId ??
      mergedProjects[0]?.entryFileId ??
      mergedProjects[0]?.files[0]?.id ??
      null,
    activeConversationId: state.activeConversationId ?? mergedConversations[0]?.id ?? null,
    voiceSettings: nextVoiceSettings,
    modelSettings: nextModelSettings,
    appSettings: nextAppSettings,
    settingRevisions: nextSettingRevisions,
    workspaceNotice: null,
  });
}
