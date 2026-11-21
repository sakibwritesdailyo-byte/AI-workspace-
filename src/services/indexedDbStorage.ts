import type {
  AppSettings,
  ChatMessage,
  ClaimCollisionStrategy,
  ClaimLocalDataResult,
  Conversation,
  FileLanguage,
  ModelSettings,
  OutboxDiagnostics,
  OutboxStatus,
  OwnershipSummary,
  Project,
  ProjectFile,
  SettingSyncCategory,
  SyncEntityType,
  SyncOutboxRecord,
  SyncStatus,
  SyncTombstoneRecord,
  VoiceSessionRecord,
  VoiceSettings,
  WorkspaceStorageStats,
} from '../types/workspace';
import {
  buildScopedOutboxId,
  normalizeOwnerUid,
  ownerScopeKey,
  recordBelongsToOwner,
} from './ownershipPolicy';
import {
  getSettingSyncCategory,
  isDeviceLocalSetting,
  isSettingSyncable,
  type PreferenceKey,
  type SyncableSettingKey,
} from './settingsPolicy';
import {
  buildOutboxRecord,
  computeWorkspaceDelta,
  createOutboxOperationId,
  createTombstoneId,
  type ApplyRemoteSyncInput,
  type PersistedPreferences,
  type PersistedWorkspaceSnapshot,
  type WorkspaceRepository,
  type WorkspaceSnapshotDelta,
} from './workspaceRepository';

export type { PersistedPreferences, PersistedWorkspaceSnapshot } from './workspaceRepository';

export const DB_NAME = 'personal_ai_studio_db';
export const DB_VERSION = 4;

export const STORE_PROJECTS = 'projects';
export const STORE_FILES = 'files';
export const STORE_CONVERSATIONS = 'conversations';
export const STORE_MESSAGES = 'messages';
export const STORE_VOICE_SESSIONS = 'voice_sessions';
export const STORE_DELETED = 'deleted_conversations';
export const STORE_SETTINGS = 'settings';
export const STORE_TOMBSTONES = 'sync_tombstones';
export const STORE_OUTBOX = 'sync_outbox';
const LEGACY_STORE_PREFERENCES = 'preferences';

interface StoredProjectRecord {
  id: string;
  name: string;
  description: string;
  framework: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  revision: number;
  ownerUid: string | null;
  syncStatus: SyncStatus;
  entryFileId: string;
  folders: string[];
}

interface StoredFileRecord extends ProjectFile {
  projectId: string;
  createdAt: string;
  revision: number;
  ownerUid: string | null;
  syncStatus: SyncStatus;
}

interface StoredConversationRecord {
  id: string;
  title: string;
  kind: 'voice' | 'chat';
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  revision: number;
  ownerUid: string | null;
  syncStatus: SyncStatus;
  isPinned: boolean;
  durationSeconds?: number;
  voiceSessionIds?: string[];
  summary: string;
}

interface StoredMessageRecord extends ChatMessage {
  conversationId: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
  ownerUid: string | null;
  syncStatus: SyncStatus;
}

interface StoredSettingRecord {
  key: string;
  settingKey?: PreferenceKey;
  value: unknown;
  updatedAt: string;
  revision?: number;
  ownerUid?: string | null;
  syncStatus?: SyncStatus;
  syncCategory?: SettingSyncCategory;
}

function formatStorageError(err: unknown, fallback: string): Error {
  if (
    err &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name: string }).name === 'QuotaExceededError'
  ) {
    return new Error(
      'Local storage quota exceeded. Export a JSON backup and delete unused items to free space.',
    );
  }
  if (err instanceof Error) return err;
  return new Error(fallback);
}

function ensureStoreIndex(
  store: IDBObjectStore,
  name: string,
  keyPath: string,
  unique = false,
): void {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, { unique });
  }
}

function deduplicateById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    if (item && typeof item.id === 'string' && item.id && !map.has(item.id)) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

function normalizeSyncStatus(status?: unknown): SyncStatus {
  if (
    status === 'local_only' ||
    status === 'pending' ||
    status === 'synced' ||
    status === 'conflict'
  ) {
    return status;
  }
  return 'local_only';
}

function normalizeRevision(rev?: unknown, fallback = 1): number {
  return typeof rev === 'number' && Number.isFinite(rev) && rev >= 1 ? Math.floor(rev) : fallback;
}

function normalizeOutboxStatus(status?: unknown): OutboxStatus {
  if (status === 'pending' || status === 'in_flight' || status === 'failed') {
    return status;
  }
  return 'pending';
}

function isValidFileLanguage(lang: unknown): lang is FileLanguage {
  return (
    lang === 'html' ||
    lang === 'css' ||
    lang === 'typescript' ||
    lang === 'javascript' ||
    lang === 'json' ||
    lang === 'markdown'
  );
}

function inferLanguageFallback(name: string): FileLanguage {
  const lower = name.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  return 'markdown';
}

function normalizeLegacyFiles(
  rawFiles: unknown,
  fallbackCreatedAt: string,
  nowIso: string,
): ProjectFile[] {
  if (!Array.isArray(rawFiles)) return [];
  const valid: ProjectFile[] = [];
  for (const entry of rawFiles) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Partial<ProjectFile>;
    if (typeof raw.id !== 'string' || !raw.id.trim()) continue;
    const name =
      typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `${raw.id}.txt`;
    const folder =
      typeof raw.folder === 'string' && raw.folder.trim() ? raw.folder.trim() : 'src';
    const path =
      typeof raw.path === 'string' && raw.path.trim() ? raw.path.trim() : `${folder}/${name}`;
    const updatedAt =
      typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : fallbackCreatedAt || nowIso;
    const createdAt =
      typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : updatedAt;
    valid.push({
      id: raw.id,
      name,
      folder,
      path,
      language: isValidFileLanguage(raw.language) ? raw.language : inferLanguageFallback(name),
      content: typeof raw.content === 'string' ? raw.content : '',
      createdAt,
      updatedAt,
      deletedAt: raw.deletedAt ?? null,
      revision: normalizeRevision(raw.revision, 1),
      ownerUid: normalizeOwnerUid(raw.ownerUid),
      syncStatus: normalizeSyncStatus(raw.syncStatus),
    });
  }
  return valid;
}

function toStoredProjectRecord(project: Project, nowIso: string): StoredProjectRecord {
  const safeFiles = Array.isArray(project.files) ? project.files : [];
  const safeFolders = Array.isArray(project.folders) ? project.folders : [];
  const folderSet = new Set<string>();
  for (const folder of safeFolders) {
    if (typeof folder === 'string' && folder.trim()) {
      folderSet.add(folder);
    }
  }
  for (const f of safeFiles) {
    if (f && typeof f === 'object' && typeof f.folder === 'string' && f.folder.trim()) {
      folderSet.add(f.folder);
    }
  }
  const firstValidFileId =
    safeFiles.find((f) => f && typeof f === 'object' && typeof f.id === 'string')?.id ?? '';
  return {
    id: project.id,
    name: typeof project.name === 'string' && project.name ? project.name : 'Untitled Project',
    description: typeof project.description === 'string' ? project.description : '',
    framework:
      typeof project.framework === 'string' && project.framework
        ? project.framework
        : 'HTML · CSS · JS',
    createdAt: project.createdAt || nowIso,
    updatedAt: project.updatedAt || project.createdAt || nowIso,
    deletedAt: project.deletedAt ?? null,
    revision: normalizeRevision(project.revision, 1),
    ownerUid: normalizeOwnerUid(project.ownerUid),
    syncStatus: normalizeSyncStatus(project.syncStatus),
    entryFileId:
      typeof project.entryFileId === 'string' && project.entryFileId
        ? project.entryFileId
        : firstValidFileId,
    folders: Array.from(folderSet),
  };
}

function toStoredFileRecord(projectId: string, file: ProjectFile, nowIso: string): StoredFileRecord {
  return {
    ...file,
    projectId,
    createdAt: file.createdAt || file.updatedAt || nowIso,
    updatedAt: file.updatedAt || nowIso,
    deletedAt: file.deletedAt ?? null,
    revision: normalizeRevision(file.revision, 1),
    ownerUid: normalizeOwnerUid(file.ownerUid),
    syncStatus: normalizeSyncStatus(file.syncStatus),
  };
}

function toStoredConversationRecord(conv: Conversation, nowIso: string): StoredConversationRecord {
  return {
    id: conv.id,
    title: typeof conv.title === 'string' && conv.title ? conv.title : 'Untitled Conversation',
    kind: conv.kind === 'voice' ? 'voice' : 'chat',
    projectId: conv.projectId ?? null,
    createdAt: conv.createdAt || nowIso,
    updatedAt: conv.updatedAt || conv.createdAt || nowIso,
    deletedAt: conv.deletedAt ?? null,
    revision: normalizeRevision(conv.revision, 1),
    ownerUid: normalizeOwnerUid(conv.ownerUid),
    syncStatus: normalizeSyncStatus(conv.syncStatus),
    isPinned: Boolean(conv.isPinned),
    durationSeconds: conv.durationSeconds,
    voiceSessionIds: Array.isArray(conv.voiceSessionIds) ? conv.voiceSessionIds : [],
    summary: typeof conv.summary === 'string' ? conv.summary : '',
  };
}

function toStoredMessageRecord(
  conversationId: string,
  orderIndex: number,
  msg: ChatMessage,
  fallbackCreatedAt: string,
): StoredMessageRecord {
  const createdAt = msg.createdAt || fallbackCreatedAt;
  return {
    ...msg,
    conversationId,
    orderIndex,
    createdAt,
    updatedAt: msg.updatedAt || createdAt,
    deletedAt: msg.deletedAt ?? null,
    revision: normalizeRevision(msg.revision, 1),
    ownerUid: normalizeOwnerUid(msg.ownerUid),
    syncStatus: normalizeSyncStatus(msg.syncStatus),
  };
}

function toStoredVoiceSessionRecord(
  session: VoiceSessionRecord,
  saveTranscripts: boolean,
  nowIso: string,
): VoiceSessionRecord {
  const safeTranscripts = Array.isArray(session.transcripts) ? session.transcripts : [];
  return {
    ...session,
    createdAt: session.createdAt || session.startedAt || nowIso,
    updatedAt: session.updatedAt || session.endedAt || session.startedAt || nowIso,
    deletedAt: session.deletedAt ?? null,
    revision: normalizeRevision(session.revision, 1),
    ownerUid: normalizeOwnerUid(session.ownerUid),
    syncStatus: normalizeSyncStatus(session.syncStatus),
    rawAudioStored: false,
    transcripts: saveTranscripts ? safeTranscripts : [],
    transcriptsSaved: Boolean(saveTranscripts && safeTranscripts.length > 0),
  };
}

function getSettingStorageKey(key: PreferenceKey, ownerUid: string | null): string {
  if (isDeviceLocalSetting(key) || ownerUid === null) {
    return key;
  }
  return `${ownerUid}:${key}`;
}

function resolveSettingLogicalKey(row: StoredSettingRecord): PreferenceKey | null {
  if (
    row.settingKey === 'voiceSettings' ||
    row.settingKey === 'modelSettings' ||
    row.settingKey === 'appSettings' ||
    row.settingKey === 'activeProjectId' ||
    row.settingKey === 'activeConversationId' ||
    row.settingKey === 'activeFileId'
  ) {
    return row.settingKey;
  }
  if (
    row.key === 'voiceSettings' ||
    row.key === 'modelSettings' ||
    row.key === 'appSettings' ||
    row.key === 'activeProjectId' ||
    row.key === 'activeConversationId' ||
    row.key === 'activeFileId'
  ) {
    return row.key;
  }
  const idx = row.key.lastIndexOf(':');
  if (idx >= 0) {
    const tail = row.key.slice(idx + 1);
    if (
      tail === 'voiceSettings' ||
      tail === 'modelSettings' ||
      tail === 'appSettings' ||
      tail === 'activeProjectId' ||
      tail === 'activeConversationId' ||
      tail === 'activeFileId'
    ) {
      return tail;
    }
  }
  return null;
}

/**
 * Coalesces an incoming outbox record with any existing record in the same store,
 * enforcing monotonic revision and delete-beats-older-upsert invariants while rotating `operationId`.
 */
function upsertOutboxInTx(outboxStore: IDBObjectStore, incoming: SyncOutboxRecord): void {
  const req = outboxStore.get(incoming.id);
  req.onsuccess = () => {
    const existing = req.result as SyncOutboxRecord | undefined;
    if (!existing) {
      outboxStore.put(incoming);
      return;
    }

    const existingRev = normalizeRevision(existing.revision, 1);
    const incomingRev = normalizeRevision(incoming.revision, 1);

    // Never allow a lower revision operation to overwrite a higher revision operation
    if (existingRev > incomingRev) {
      return;
    }

    // Never allow an upsert at equal or older revision to overwrite a newer delete
    if (
      existing.operation === 'delete' &&
      incoming.operation === 'upsert' &&
      incomingRev <= existingRev
    ) {
      return;
    }

    outboxStore.put({
      ...incoming,
      operationId: createOutboxOperationId(),
      createdAt: existing.createdAt || incoming.createdAt,
      status: 'pending',
      retryCount: 0,
      lastError: null,
      nextRetryAt: null,
      claimedAt: null,
      leaseExpiresAt: null,
      claimedBy: null,
    } satisfies SyncOutboxRecord);
  };
}

function deleteEntityWithRevision(
  entityStore: IDBObjectStore,
  tombstoneStore: IDBObjectStore,
  outboxStore: IDBObjectStore,
  params: {
    entityType: SyncEntityType;
    entityId: string;
    parentId: string | null;
    nowIso: string;
  },
): void {
  const req = entityStore.get(params.entityId);
  req.onsuccess = () => {
    const row = req.result as
      | { revision?: number; ownerUid?: string | null; syncStatus?: SyncStatus }
      | undefined;
    if (!row) {
      // Do not fabricate a revision:1 tombstone when the record does not exist locally
      return;
    }

    const baseRev = normalizeRevision(row.revision, 1);
    const nextRev = baseRev + 1;
    const ownerUid = normalizeOwnerUid(row.ownerUid);
    const syncStatus = normalizeSyncStatus(row.syncStatus);

    entityStore.delete(params.entityId);

    tombstoneStore.put({
      id: createTombstoneId(params.entityType, params.entityId),
      entityType: params.entityType,
      entityId: params.entityId,
      parentId: params.parentId,
      deletedAt: params.nowIso,
      revision: nextRev,
      ownerUid,
      syncStatus,
      acknowledgedAt: null,
    } satisfies SyncTombstoneRecord);

    upsertOutboxInTx(
      outboxStore,
      buildOutboxRecord({
        entityType: params.entityType,
        entityId: params.entityId,
        parentId: params.parentId,
        operation: 'delete',
        revision: nextRev,
        baseRevision: baseRev,
        ownerUid,
        updatedAt: params.nowIso,
        deletedAt: params.nowIso,
      }),
    );
  };
}

function backfillStoreSyncMetadata(
  store: IDBObjectStore,
  defaults: (row: Record<string, unknown>, nowIso: string) => Record<string, unknown> | null,
  nowIso: string,
): void {
  const req = store.getAll();
  req.onsuccess = () => {
    const rows = (req.result as Array<Record<string, unknown>>) ?? [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const updated = defaults(row, nowIso);
      if (updated) {
        store.put(updated);
      }
    }
  };
}

function openDatabase(dbName = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = globalThis.indexedDB;
    if (typeof idb === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser environment.'));
      return;
    }

    const request = idb.open(dbName, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!tx) return;

      // 1. Projects store + indexes
      const projectStore = db.objectStoreNames.contains(STORE_PROJECTS)
        ? tx.objectStore(STORE_PROJECTS)
        : db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      ensureStoreIndex(projectStore, 'updatedAt', 'updatedAt');
      ensureStoreIndex(projectStore, 'createdAt', 'createdAt');
      ensureStoreIndex(projectStore, 'syncStatus', 'syncStatus');
      ensureStoreIndex(projectStore, 'ownerUid', 'ownerUid');

      // 2. Files store + indexes
      const fileStore = db.objectStoreNames.contains(STORE_FILES)
        ? tx.objectStore(STORE_FILES)
        : db.createObjectStore(STORE_FILES, { keyPath: 'id' });
      ensureStoreIndex(fileStore, 'projectId', 'projectId');
      ensureStoreIndex(fileStore, 'path', 'path');
      ensureStoreIndex(fileStore, 'folder', 'folder');
      ensureStoreIndex(fileStore, 'updatedAt', 'updatedAt');
      ensureStoreIndex(fileStore, 'syncStatus', 'syncStatus');
      ensureStoreIndex(fileStore, 'ownerUid', 'ownerUid');

      // 3. Conversations store + indexes
      const convStore = db.objectStoreNames.contains(STORE_CONVERSATIONS)
        ? tx.objectStore(STORE_CONVERSATIONS)
        : db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' });
      ensureStoreIndex(convStore, 'updatedAt', 'updatedAt');
      ensureStoreIndex(convStore, 'kind', 'kind');
      ensureStoreIndex(convStore, 'isPinned', 'isPinned');
      ensureStoreIndex(convStore, 'projectId', 'projectId');
      ensureStoreIndex(convStore, 'syncStatus', 'syncStatus');
      ensureStoreIndex(convStore, 'ownerUid', 'ownerUid');

      // 4. Messages store + indexes
      const msgStore = db.objectStoreNames.contains(STORE_MESSAGES)
        ? tx.objectStore(STORE_MESSAGES)
        : db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
      ensureStoreIndex(msgStore, 'conversationId', 'conversationId');
      ensureStoreIndex(msgStore, 'createdAt', 'createdAt');
      ensureStoreIndex(msgStore, 'updatedAt', 'updatedAt');
      ensureStoreIndex(msgStore, 'source', 'source');
      ensureStoreIndex(msgStore, 'syncStatus', 'syncStatus');
      ensureStoreIndex(msgStore, 'ownerUid', 'ownerUid');

      // 5. Voice Sessions metadata & transcripts store + indexes
      const voiceStore = db.objectStoreNames.contains(STORE_VOICE_SESSIONS)
        ? tx.objectStore(STORE_VOICE_SESSIONS)
        : db.createObjectStore(STORE_VOICE_SESSIONS, { keyPath: 'id' });
      ensureStoreIndex(voiceStore, 'conversationId', 'conversationId');
      ensureStoreIndex(voiceStore, 'startedAt', 'startedAt');
      ensureStoreIndex(voiceStore, 'status', 'status');
      ensureStoreIndex(voiceStore, 'syncStatus', 'syncStatus');
      ensureStoreIndex(voiceStore, 'ownerUid', 'ownerUid');

      // 6. Recently Deleted / Trash store + indexes
      const deletedStore = db.objectStoreNames.contains(STORE_DELETED)
        ? tx.objectStore(STORE_DELETED)
        : db.createObjectStore(STORE_DELETED, { keyPath: 'id' });
      ensureStoreIndex(deletedStore, 'deletedAt', 'deletedAt');
      ensureStoreIndex(deletedStore, 'projectId', 'projectId');
      ensureStoreIndex(deletedStore, 'syncStatus', 'syncStatus');
      ensureStoreIndex(deletedStore, 'ownerUid', 'ownerUid');

      // 7. Settings store + indexes
      const settingsStore = db.objectStoreNames.contains(STORE_SETTINGS)
        ? tx.objectStore(STORE_SETTINGS)
        : db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      ensureStoreIndex(settingsStore, 'updatedAt', 'updatedAt');
      ensureStoreIndex(settingsStore, 'ownerUid', 'ownerUid');

      // 8. Sync Tombstones store + indexes
      const tombstoneStore = db.objectStoreNames.contains(STORE_TOMBSTONES)
        ? tx.objectStore(STORE_TOMBSTONES)
        : db.createObjectStore(STORE_TOMBSTONES, { keyPath: 'id' });
      ensureStoreIndex(tombstoneStore, 'entityType', 'entityType');
      ensureStoreIndex(tombstoneStore, 'entityId', 'entityId');
      ensureStoreIndex(tombstoneStore, 'deletedAt', 'deletedAt');
      ensureStoreIndex(tombstoneStore, 'syncStatus', 'syncStatus');
      ensureStoreIndex(tombstoneStore, 'ownerUid', 'ownerUid');
      ensureStoreIndex(tombstoneStore, 'acknowledgedAt', 'acknowledgedAt');

      // 9. Sync Outbox store + indexes
      const outboxStore = db.objectStoreNames.contains(STORE_OUTBOX)
        ? tx.objectStore(STORE_OUTBOX)
        : db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
      ensureStoreIndex(outboxStore, 'entityType', 'entityType');
      ensureStoreIndex(outboxStore, 'entityId', 'entityId');
      ensureStoreIndex(outboxStore, 'operation', 'operation');
      ensureStoreIndex(outboxStore, 'updatedAt', 'updatedAt');
      ensureStoreIndex(outboxStore, 'status', 'status');
      ensureStoreIndex(outboxStore, 'ownerUid', 'ownerUid');
      ensureStoreIndex(outboxStore, 'nextRetryAt', 'nextRetryAt');
      ensureStoreIndex(outboxStore, 'leaseExpiresAt', 'leaseExpiresAt');
      ensureStoreIndex(outboxStore, 'operationId', 'operationId');

      const nowIso = new Date().toISOString();

      // Safe v1 -> v2/v3/v4 migration with strict null/malformed array guards
      if (event.oldVersion > 0 && event.oldVersion < 2) {
        const projReq = projectStore.getAll();
        projReq.onsuccess = () => {
          const legacyProjects = (projReq.result as Array<unknown>) ?? [];
          for (const rawProj of legacyProjects) {
            if (!rawProj || typeof rawProj !== 'object') continue;
            const legacyProj = rawProj as Partial<Project> & { files?: unknown };
            if (typeof legacyProj.id !== 'string' || !legacyProj.id.trim() || legacyProj.isSample) {
              continue;
            }
            const embeddedFiles = normalizeLegacyFiles(
              legacyProj.files,
              legacyProj.createdAt || nowIso,
              nowIso,
            );
            const rawFolders = Array.isArray(legacyProj.folders) ? legacyProj.folders : [];
            const folderSet = new Set<string>(
              rawFolders.filter((f): f is string => typeof f === 'string' && f.trim().length > 0),
            );
            for (const file of embeddedFiles) {
              folderSet.add(file.folder || 'src');
              fileStore.put(toStoredFileRecord(legacyProj.id, file, nowIso));
            }
            const safeProj: Project = {
              id: legacyProj.id,
              name:
                typeof legacyProj.name === 'string' && legacyProj.name
                  ? legacyProj.name
                  : 'Migrated Project',
              description: typeof legacyProj.description === 'string' ? legacyProj.description : '',
              framework:
                typeof legacyProj.framework === 'string' && legacyProj.framework
                  ? legacyProj.framework
                  : 'HTML · CSS · JS',
              createdAt: legacyProj.createdAt || nowIso,
              updatedAt: legacyProj.updatedAt || legacyProj.createdAt || nowIso,
              entryFileId:
                typeof legacyProj.entryFileId === 'string' && legacyProj.entryFileId
                  ? legacyProj.entryFileId
                  : embeddedFiles[0]?.id ?? '',
              folders: Array.from(folderSet),
              files: embeddedFiles,
              revision: normalizeRevision(legacyProj.revision, 1),
              ownerUid: normalizeOwnerUid(legacyProj.ownerUid),
              syncStatus: normalizeSyncStatus(legacyProj.syncStatus),
              isSample: false,
            };
            projectStore.put(toStoredProjectRecord(safeProj, nowIso));
          }
        };

        const convReq = convStore.getAll();
        convReq.onsuccess = () => {
          const legacyConvs = (convReq.result as Array<unknown>) ?? [];
          for (const rawConv of legacyConvs) {
            if (!rawConv || typeof rawConv !== 'object') continue;
            const legacyConv = rawConv as Partial<Conversation> & { messages?: unknown };
            if (typeof legacyConv.id !== 'string' || !legacyConv.id.trim() || legacyConv.isSample) {
              continue;
            }
            const embeddedMessages = Array.isArray(legacyConv.messages) ? legacyConv.messages : [];
            let orderIndex = 0;
            for (const rawMsg of embeddedMessages) {
              if (!rawMsg || typeof rawMsg !== 'object') continue;
              const msg = rawMsg as Partial<ChatMessage>;
              if (typeof msg.id !== 'string' || !msg.id.trim()) continue;
              const safeMsg: ChatMessage = {
                id: msg.id,
                role: msg.role === 'assistant' || msg.role === 'system' ? msg.role : 'user',
                content: typeof msg.content === 'string' ? msg.content : '',
                timestamp: typeof msg.timestamp === 'string' ? msg.timestamp : '',
                createdAt: msg.createdAt,
                updatedAt: msg.updatedAt,
                revision: normalizeRevision(msg.revision, 1),
                ownerUid: normalizeOwnerUid(msg.ownerUid),
                syncStatus: normalizeSyncStatus(msg.syncStatus),
                source: msg.source === 'voice' ? 'voice' : 'text',
                language: msg.language,
              };
              msgStore.put(
                toStoredMessageRecord(
                  legacyConv.id,
                  orderIndex,
                  safeMsg,
                  legacyConv.createdAt || nowIso,
                ),
              );
              orderIndex += 1;
            }
            const safeConv: Conversation = {
              id: legacyConv.id,
              title:
                typeof legacyConv.title === 'string' && legacyConv.title
                  ? legacyConv.title
                  : 'Migrated Conversation',
              kind: legacyConv.kind === 'voice' ? 'voice' : 'chat',
              projectId: legacyConv.projectId ?? null,
              createdAt: legacyConv.createdAt || nowIso,
              updatedAt: legacyConv.updatedAt || legacyConv.createdAt || nowIso,
              isPinned: Boolean(legacyConv.isPinned),
              durationSeconds: legacyConv.durationSeconds,
              voiceSessionIds: Array.isArray(legacyConv.voiceSessionIds)
                ? legacyConv.voiceSessionIds
                : [],
              summary: typeof legacyConv.summary === 'string' ? legacyConv.summary : '',
              messages: [],
              revision: normalizeRevision(legacyConv.revision, 1),
              ownerUid: normalizeOwnerUid(legacyConv.ownerUid),
              syncStatus: normalizeSyncStatus(legacyConv.syncStatus),
              isSample: false,
            };
            convStore.put(toStoredConversationRecord(safeConv, nowIso));
          }
        };

        if (db.objectStoreNames.contains(LEGACY_STORE_PREFERENCES)) {
          const prefStore = tx.objectStore(LEGACY_STORE_PREFERENCES);
          const prefReq = prefStore.getAll();
          prefReq.onsuccess = () => {
            const rows = (prefReq.result as Array<unknown>) ?? [];
            for (const rawRow of rows) {
              if (!rawRow || typeof rawRow !== 'object') continue;
              const row = rawRow as { key?: unknown; value?: unknown; updatedAt?: string };
              if (typeof row.key !== 'string' || !row.key) continue;
              const logical = resolveSettingLogicalKey({
                key: row.key,
                value: row.value,
                updatedAt: row.updatedAt || nowIso,
              });
              const syncable = logical ? isSettingSyncable(logical) : false;
              settingsStore.put({
                key: row.key,
                settingKey: logical ?? undefined,
                value: row.value,
                updatedAt: row.updatedAt || nowIso,
                revision: 1,
                ownerUid: null,
                syncStatus: 'local_only',
                syncCategory: syncable ? 'account_syncable' : 'device_local',
              } satisfies StoredSettingRecord);
            }
            db.deleteObjectStore(LEGACY_STORE_PREFERENCES);
          };
        }
      } else if (db.objectStoreNames.contains(LEGACY_STORE_PREFERENCES)) {
        db.deleteObjectStore(LEGACY_STORE_PREFERENCES);
      }

      // Additive v2 -> v3/v4 metadata backfill (idempotent & preserves all existing IDs/records)
      if (event.oldVersion >= 2 && event.oldVersion < 4) {
        const ensureSyncMeta = (
          row: Record<string, unknown>,
          fallbackTime: string,
        ): Record<string, unknown> | null => {
          const hasCreated = typeof row.createdAt === 'string' && row.createdAt.length > 0;
          const hasUpdated = typeof row.updatedAt === 'string' && row.updatedAt.length > 0;
          const hasRev = typeof row.revision === 'number' && row.revision > 0;
          const hasOwner = 'ownerUid' in row && (row.ownerUid === null || typeof row.ownerUid === 'string');
          const hasSync =
            row.syncStatus === 'local_only' ||
            row.syncStatus === 'pending' ||
            row.syncStatus === 'synced' ||
            row.syncStatus === 'conflict';

          if (hasCreated && hasUpdated && hasRev && hasOwner && hasSync) return null;
          const createdAt = hasCreated ? (row.createdAt as string) : fallbackTime;
          const updatedAt = hasUpdated ? (row.updatedAt as string) : createdAt;
          return {
            ...row,
            createdAt,
            updatedAt,
            revision: hasRev ? row.revision : 1,
            ownerUid: normalizeOwnerUid(row.ownerUid as string | null | undefined),
            syncStatus: hasSync ? row.syncStatus : 'local_only',
          };
        };

        backfillStoreSyncMetadata(projectStore, (r, t) => ensureSyncMeta(r, t), nowIso);
        backfillStoreSyncMetadata(fileStore, (r, t) => ensureSyncMeta(r, t), nowIso);
        backfillStoreSyncMetadata(convStore, (r, t) => ensureSyncMeta(r, t), nowIso);
        backfillStoreSyncMetadata(msgStore, (r, t) => ensureSyncMeta(r, t), nowIso);
        backfillStoreSyncMetadata(
          voiceStore,
          (r, t) =>
            ensureSyncMeta(
              r,
              typeof r.startedAt === 'string' && r.startedAt ? r.startedAt : t,
            ),
          nowIso,
        );
        backfillStoreSyncMetadata(deletedStore, (r, t) => ensureSyncMeta(r, t), nowIso);
      }

      // Additive v3 -> v4 upgrade: normalize outbox, tombstones, and settings metadata
      if (event.oldVersion > 0 && event.oldVersion < 4) {
        const tombReq = tombstoneStore.getAll();
        tombReq.onsuccess = () => {
          const rows = (tombReq.result as Array<SyncTombstoneRecord>) ?? [];
          for (const row of rows) {
            if (!row || typeof row !== 'object') continue;
            const normalizedOwner = normalizeOwnerUid(row.ownerUid);
            const hasAck = 'acknowledgedAt' in row;
            if (hasAck && row.ownerUid === normalizedOwner) continue;
            tombstoneStore.put({
              ...row,
              ownerUid: normalizedOwner,
              syncStatus: normalizeSyncStatus(row.syncStatus),
              revision: normalizeRevision(row.revision, 1),
              acknowledgedAt: row.acknowledgedAt ?? null,
            });
          }
        };

        const outboxReq = outboxStore.getAll();
        outboxReq.onsuccess = () => {
          const rows = (outboxReq.result as Array<Partial<SyncOutboxRecord>>) ?? [];
          for (const row of rows) {
            if (!row || typeof row !== 'object') continue;
            if (!row.entityType || typeof row.entityId !== 'string') continue;
            const ownerUid = normalizeOwnerUid(row.ownerUid);
            const scopedId = buildScopedOutboxId(ownerUid, row.entityType, row.entityId);
            const updatedAt =
              typeof row.updatedAt === 'string' && row.updatedAt ? row.updatedAt : nowIso;
            const upgraded: SyncOutboxRecord = {
              id: scopedId,
              operationId:
                typeof row.operationId === 'string' && row.operationId
                  ? row.operationId
                  : createOutboxOperationId(),
              entityType: row.entityType,
              entityId: row.entityId,
              parentId: row.parentId ?? null,
              operation: row.operation === 'delete' ? 'delete' : 'upsert',
              revision: normalizeRevision(row.revision, 1),
              baseRevision:
                typeof row.baseRevision === 'number' || row.baseRevision === null
                  ? row.baseRevision
                  : null,
              ownerUid,
              createdAt:
                typeof row.createdAt === 'string' && row.createdAt ? row.createdAt : updatedAt,
              updatedAt,
              deletedAt: row.deletedAt ?? null,
              status: normalizeOutboxStatus(row.status),
              retryCount: typeof row.retryCount === 'number' ? row.retryCount : 0,
              lastError: typeof row.lastError === 'string' ? row.lastError : null,
              nextRetryAt: typeof row.nextRetryAt === 'string' ? row.nextRetryAt : null,
              claimedAt: typeof row.claimedAt === 'string' ? row.claimedAt : null,
              leaseExpiresAt: typeof row.leaseExpiresAt === 'string' ? row.leaseExpiresAt : null,
              claimedBy: typeof row.claimedBy === 'string' ? row.claimedBy : null,
              lastAttemptAt: typeof row.lastAttemptAt === 'string' ? row.lastAttemptAt : null,
            };
            if (typeof row.id === 'string' && row.id && row.id !== scopedId) {
              outboxStore.delete(row.id);
            }
            outboxStore.put(upgraded);
          }
        };

        const settingReq = settingsStore.getAll();
        settingReq.onsuccess = () => {
          const rows = (settingReq.result as Array<StoredSettingRecord>) ?? [];
          for (const row of rows) {
            if (!row || typeof row !== 'object' || typeof row.key !== 'string') continue;
            const logical = resolveSettingLogicalKey(row);
            if (!logical) continue;
            const syncable = isSettingSyncable(logical);
            settingsStore.put({
              ...row,
              settingKey: logical,
              ownerUid: normalizeOwnerUid(row.ownerUid),
              revision: syncable ? normalizeRevision(row.revision, 1) : undefined,
              syncStatus: syncable ? normalizeSyncStatus(row.syncStatus) : undefined,
              syncCategory: getSettingSyncCategory(logical),
            });
          }
        };
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(formatStorageError(request.error, 'Failed to open IndexedDB database.'));
    request.onblocked = () =>
      reject(new Error('IndexedDB upgrade blocked by another open tab. Reload and retry.'));
  });
}

function readAllStore<T>(tx: IDBTransaction, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(formatStorageError(req.error, `Failed reading ${storeName}.`));
  });
}

function runWriteTransaction(
  db: IDBDatabase,
  storeNames: string[],
  work: (tx: IDBTransaction, abortWithError: (err: unknown) => void) => void,
  errorFallback: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readwrite');
    let settled = false;

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(formatStorageError(err, errorFallback));
    };

    const abortWithError = (err: unknown) => {
      fail(err);
      try {
        tx.abort();
      } catch {
        // Ignore abort errors if transaction already closed
      }
    };

    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error || new Error(errorFallback));

    try {
      work(tx, abortWithError);
    } catch (err) {
      abortWithError(err);
    }
  });
}

async function readStorageQuotaAndPersistence(): Promise<{
  usageBytes: number | null;
  quotaBytes: number | null;
  persistedStorage: boolean | null;
}> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return { usageBytes: null, quotaBytes: null, persistedStorage: null };
  }
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  let persistedStorage: boolean | null = null;

  try {
    if (typeof navigator.storage.estimate === 'function') {
      const est = await navigator.storage.estimate();
      usageBytes = typeof est.usage === 'number' ? est.usage : null;
      quotaBytes = typeof est.quota === 'number' ? est.quota : null;
    }
  } catch {
    // Ignore storage estimate restriction
  }

  try {
    if (typeof navigator.storage.persisted === 'function') {
      persistedStorage = await navigator.storage.persisted();
    }
  } catch {
    // Ignore persisted check error
  }

  return { usageBytes, quotaBytes, persistedStorage };
}

function generateUniqueRemappedId(prefix: string, takenIds: Set<string>): string {
  let candidate = '';
  do {
    const suffix =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    candidate = `${prefix}-${suffix}`;
  } while (takenIds.has(candidate));
  takenIds.add(candidate);
  return candidate;
}

export class IndexedDbWorkspaceRepository implements WorkspaceRepository {
  private readonly dbName: string;

  constructor(dbName = DB_NAME) {
    this.dbName = dbName;
  }

  async requestPersistentStorage(): Promise<{ supported: boolean; persisted: boolean }> {
    if (
      typeof navigator === 'undefined' ||
      !navigator.storage ||
      typeof navigator.storage.persist !== 'function'
    ) {
      return { supported: false, persisted: false };
    }
    try {
      const persisted = await navigator.storage.persist();
      return { supported: true, persisted };
    } catch {
      return { supported: true, persisted: false };
    }
  }

  async getStorageStats(options?: { activeOwnerUid?: string | null }): Promise<WorkspaceStorageStats> {
    const scopeOwnerUid = normalizeOwnerUid(options?.activeOwnerUid);
    let db: IDBDatabase | null = null;
    try {
      db = await openDatabase(this.dbName);
      const tx = db.transaction(
        [
          STORE_PROJECTS,
          STORE_FILES,
          STORE_CONVERSATIONS,
          STORE_MESSAGES,
          STORE_VOICE_SESSIONS,
          STORE_DELETED,
          STORE_TOMBSTONES,
          STORE_OUTBOX,
        ],
        'readonly',
      );
      const [
        projectRows,
        fileRows,
        convRows,
        msgRows,
        voiceRows,
        deletedRows,
        tombstoneRows,
        outboxRows,
        quota,
      ] = await Promise.all([
        readAllStore<StoredProjectRecord & { isSample?: boolean }>(tx, STORE_PROJECTS),
        readAllStore<StoredFileRecord>(tx, STORE_FILES),
        readAllStore<StoredConversationRecord & { isSample?: boolean }>(tx, STORE_CONVERSATIONS),
        readAllStore<StoredMessageRecord>(tx, STORE_MESSAGES),
        readAllStore<VoiceSessionRecord>(tx, STORE_VOICE_SESSIONS),
        readAllStore<Conversation>(tx, STORE_DELETED),
        readAllStore<SyncTombstoneRecord>(tx, STORE_TOMBSTONES),
        readAllStore<SyncOutboxRecord>(tx, STORE_OUTBOX),
        readStorageQuotaAndPersistence(),
      ]);

      return {
        projectCount: projectRows.filter(
          (r) => !r.isSample && recordBelongsToOwner(r.ownerUid, scopeOwnerUid),
        ).length,
        fileCount: fileRows.filter((r) => recordBelongsToOwner(r.ownerUid, scopeOwnerUid)).length,
        conversationCount: convRows.filter(
          (r) => !r.isSample && recordBelongsToOwner(r.ownerUid, scopeOwnerUid),
        ).length,
        messageCount: msgRows.filter((r) => recordBelongsToOwner(r.ownerUid, scopeOwnerUid)).length,
        voiceSessionCount: voiceRows.filter((r) =>
          recordBelongsToOwner(r.ownerUid, scopeOwnerUid),
        ).length,
        deletedCount: deletedRows.filter(
          (r) => !r.isSample && recordBelongsToOwner(r.ownerUid, scopeOwnerUid),
        ).length,
        tombstoneCount: tombstoneRows.filter((r) =>
          recordBelongsToOwner(r.ownerUid, scopeOwnerUid),
        ).length,
        outboxCount: outboxRows.filter((r) => recordBelongsToOwner(r.ownerUid, scopeOwnerUid))
          .length,
        usageBytes: quota.usageBytes,
        quotaBytes: quota.quotaBytes,
        persistedStorage: quota.persistedStorage,
        storageError: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to query IndexedDB statistics.';
      return {
        projectCount: 0,
        fileCount: 0,
        conversationCount: 0,
        messageCount: 0,
        voiceSessionCount: 0,
        deletedCount: 0,
        tombstoneCount: 0,
        outboxCount: 0,
        usageBytes: null,
        quotaBytes: null,
        persistedStorage: null,
        storageError: msg,
      };
    } finally {
      db?.close();
    }
  }

  async loadWorkspace(options?: {
    activeOwnerUid?: string | null;
  }): Promise<PersistedWorkspaceSnapshot> {
    const scopeOwnerUid = normalizeOwnerUid(options?.activeOwnerUid);
    const db = await openDatabase(this.dbName);
    try {
      const tx = db.transaction(
        [
          STORE_PROJECTS,
          STORE_FILES,
          STORE_CONVERSATIONS,
          STORE_MESSAGES,
          STORE_VOICE_SESSIONS,
          STORE_DELETED,
          STORE_SETTINGS,
        ],
        'readonly',
      );

      const [
        projectRows,
        fileRows,
        convRows,
        msgRows,
        voiceRows,
        deletedRows,
        settingRows,
      ] = await Promise.all([
        readAllStore<StoredProjectRecord & { files?: ProjectFile[]; isSample?: boolean }>(
          tx,
          STORE_PROJECTS,
        ),
        readAllStore<StoredFileRecord>(tx, STORE_FILES),
        readAllStore<StoredConversationRecord & { messages?: ChatMessage[]; isSample?: boolean }>(
          tx,
          STORE_CONVERSATIONS,
        ),
        readAllStore<StoredMessageRecord>(tx, STORE_MESSAGES),
        readAllStore<VoiceSessionRecord>(tx, STORE_VOICE_SESSIONS),
        readAllStore<Conversation>(tx, STORE_DELETED),
        readAllStore<StoredSettingRecord>(tx, STORE_SETTINGS),
      ]);

      const filesByProject = new Map<string, ProjectFile[]>();
      for (const file of deduplicateById(fileRows)) {
        if (!recordBelongsToOwner(file.ownerUid, scopeOwnerUid)) continue;
        const list = filesByProject.get(file.projectId) ?? [];
        const { projectId: _omit, ...cleanFile } = file;
        list.push(cleanFile);
        filesByProject.set(file.projectId, list);
      }

      const projects: Project[] = deduplicateById(projectRows)
        .filter((p) => !p.isSample && recordBelongsToOwner(p.ownerUid, scopeOwnerUid))
        .map((row) => {
          const files = filesByProject.get(row.id) ?? (Array.isArray(row.files) ? row.files : []);
          const folderSet = new Set<string>(Array.isArray(row.folders) ? row.folders : []);
          for (const f of files) {
            if (f.folder) folderSet.add(f.folder);
          }
          return {
            id: row.id,
            name: row.name,
            description: row.description,
            framework: row.framework,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt ?? null,
            revision: normalizeRevision(row.revision, 1),
            ownerUid: normalizeOwnerUid(row.ownerUid),
            syncStatus: normalizeSyncStatus(row.syncStatus),
            entryFileId: row.entryFileId || files[0]?.id || '',
            folders: Array.from(folderSet),
            files,
            isSample: false,
          };
        });

      const messagesByConv = new Map<string, StoredMessageRecord[]>();
      for (const msg of deduplicateById(msgRows)) {
        if (!recordBelongsToOwner(msg.ownerUid, scopeOwnerUid)) continue;
        const list = messagesByConv.get(msg.conversationId) ?? [];
        list.push(msg);
        messagesByConv.set(msg.conversationId, list);
      }

      const conversations: Conversation[] = deduplicateById(convRows)
        .filter((c) => !c.isSample && recordBelongsToOwner(c.ownerUid, scopeOwnerUid))
        .map((row) => {
          const normalizedMsgs = (messagesByConv.get(row.id) ?? [])
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map(({ conversationId: _c, orderIndex: _o, ...msg }) => msg);

          const fallbackMsgs = Array.isArray(row.messages) ? row.messages : [];
          return {
            id: row.id,
            title: row.title,
            kind: row.kind,
            projectId: row.projectId ?? null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt ?? undefined,
            revision: normalizeRevision(row.revision, 1),
            ownerUid: normalizeOwnerUid(row.ownerUid),
            syncStatus: normalizeSyncStatus(row.syncStatus),
            isPinned: Boolean(row.isPinned),
            durationSeconds: row.durationSeconds,
            voiceSessionIds: row.voiceSessionIds ?? [],
            summary: row.summary ?? '',
            messages: normalizedMsgs.length > 0 ? normalizedMsgs : fallbackMsgs,
            isSample: false,
          };
        });

      const deletedConversations: Conversation[] = deduplicateById(deletedRows)
        .filter((c) => !c.isSample && recordBelongsToOwner(c.ownerUid, scopeOwnerUid))
        .map((c) => ({
          ...c,
          isSample: false,
          revision: normalizeRevision(c.revision, 1),
          ownerUid: normalizeOwnerUid(c.ownerUid),
          syncStatus: normalizeSyncStatus(c.syncStatus),
          messages: Array.isArray(c.messages) ? c.messages : [],
        }));

      const voiceSessions = deduplicateById(voiceRows)
        .filter((session) => recordBelongsToOwner(session.ownerUid, scopeOwnerUid))
        .map((session) => ({
          ...session,
          revision: normalizeRevision(session.revision, 1),
          ownerUid: normalizeOwnerUid(session.ownerUid),
          syncStatus: normalizeSyncStatus(session.syncStatus),
          rawAudioStored: false as const,
          transcripts: Array.isArray(session.transcripts) ? session.transcripts : [],
        }));

      const settingRevisions: Partial<Record<SyncableSettingKey, number>> = {};
      const preferences: PersistedPreferences = { settingRevisions };

      for (const row of settingRows) {
        const logicalKey = resolveSettingLogicalKey(row);
        if (!logicalKey) continue;

        if (isDeviceLocalSetting(logicalKey)) {
          if (logicalKey === 'activeProjectId') preferences.activeProjectId = row.value as string | null;
          if (logicalKey === 'activeConversationId')
            preferences.activeConversationId = row.value as string | null;
          if (logicalKey === 'activeFileId') preferences.activeFileId = row.value as string | null;
          continue;
        }

        if (!recordBelongsToOwner(row.ownerUid, scopeOwnerUid)) {
          continue;
        }
        const rev = normalizeRevision(row.revision, 1);
        settingRevisions[logicalKey] = rev;
        if (logicalKey === 'voiceSettings') preferences.voiceSettings = row.value as VoiceSettings;
        if (logicalKey === 'modelSettings') preferences.modelSettings = row.value as ModelSettings;
        if (logicalKey === 'appSettings') preferences.appSettings = row.value as AppSettings;
      }

      return {
        projects,
        conversations,
        deletedConversations,
        voiceSessions,
        preferences,
      };
    } finally {
      db.close();
    }
  }

  async createProject(project: Project): Promise<void> {
    if (project.isSample) return;
    const db = await openDatabase(this.dbName);
    const nowIso = new Date().toISOString();
    const ownerUid = normalizeOwnerUid(project.ownerUid);
    const rev = normalizeRevision(project.revision, 1);
    try {
      await runWriteTransaction(
        db,
        [STORE_PROJECTS, STORE_FILES, STORE_TOMBSTONES, STORE_OUTBOX],
        (tx) => {
          const projectStore = tx.objectStore(STORE_PROJECTS);
          const fileStore = tx.objectStore(STORE_FILES);
          const tombstoneStore = tx.objectStore(STORE_TOMBSTONES);
          const outboxStore = tx.objectStore(STORE_OUTBOX);

          projectStore.put(toStoredProjectRecord(project, nowIso));
          tombstoneStore.delete(createTombstoneId('project', project.id));
          upsertOutboxInTx(
            outboxStore,
            buildOutboxRecord({
              entityType: 'project',
              entityId: project.id,
              parentId: null,
              operation: 'upsert',
              revision: rev,
              baseRevision: null,
              ownerUid,
              updatedAt: project.updatedAt || nowIso,
            }),
          );

          for (const file of project.files) {
            const fileOwner = normalizeOwnerUid(file.ownerUid ?? ownerUid);
            const fileRev = normalizeRevision(file.revision, 1);
            fileStore.put(
              toStoredFileRecord(project.id, { ...file, ownerUid: fileOwner }, nowIso),
            );
            tombstoneStore.delete(createTombstoneId('file', file.id));
            upsertOutboxInTx(
              outboxStore,
              buildOutboxRecord({
                entityType: 'file',
                entityId: file.id,
                parentId: project.id,
                operation: 'upsert',
                revision: fileRev,
                baseRevision: null,
                ownerUid: fileOwner,
                updatedAt: file.updatedAt || nowIso,
              }),
            );
          }
        },
        'Failed creating project in IndexedDB.',
      );
    } finally {
      db.close();
    }
  }

  async updateProject(project: Project): Promise<void> {
    if (project.isSample) return;
    const db = await openDatabase(this.dbName);
    const nowIso = new Date().toISOString();
    const ownerUid = normalizeOwnerUid(project.ownerUid);
    const rev = normalizeRevision(project.revision, 1);
    try {
      await runWriteTransaction(
        db,
        [STORE_PROJECTS, STORE_OUTBOX],
        (tx) => {
          const projectStore = tx.objectStore(STORE_PROJECTS);
          const outboxStore = tx.objectStore(STORE_OUTBOX);
          const existingReq = projectStore.get(project.id);
          existingReq.onsuccess = () => {
            const existing = existingReq.result as StoredProjectRecord | undefined;
            const baseRev = existing ? normalizeRevision(existing.revision, 1) : null;
            projectStore.put(toStoredProjectRecord(project, nowIso));
            upsertOutboxInTx(
              outboxStore,
              buildOutboxRecord({
                entityType: 'project',
                entityId: project.id,
                parentId: null,
                operation: 'upsert',
                revision: rev,
                baseRevision: baseRev,
                ownerUid,
                updatedAt: project.updatedAt || nowIso,
              }),
            );
          };
        },
        'Failed updating project in IndexedDB.',
      );
    } finally {
      db.close();
    }
  }

  async deleteProject(projectId: string, deletedFileIds: string[] = []): Promise<void> {
    const db = await openDatabase(this.dbName);
    const nowIso = new Date().toISOString();
    try {
      await runWriteTransaction(
        db,
        [STORE_PROJECTS, STORE_FILES, STORE_TOMBSTONES, STORE_OUTBOX],
        (tx) => {
          const projectStore = tx.objectStore(STORE_PROJECTS);
          const fileStore = tx.objectStore(STORE_FILES);
          const tombstoneStore = tx.objectStore(STORE_TOMBSTONES);
          const outboxStore = tx.objectStore(STORE_OUTBOX);

          deleteEntityWithRevision(projectStore, tombstoneStore, outboxStore, {
            entityType: 'project',
            entityId: projectId,
            parentId: null,
            nowIso,
          });

          const processedFileIds = new Set<string>();
          for (const fid of deletedFileIds) {
            if (!fid || processedFileIds.has(fid)) continue;
            processedFileIds.add(fid);
            deleteEntityWithRevision(fileStore, tombstoneStore, outboxStore, {
              entityType: 'file',
              entityId: fid,
              parentId: projectId,
              nowIso,
            });
          }

          const idx = fileStore.index('projectId');
          const req = idx.getAll(projectId);
          req.onsuccess = () => {
            const rows = (req.result as StoredFileRecord[]) ?? [];
            for (const row of rows) {
              if (!row || typeof row.id !== 'string' || processedFileIds.has(row.id)) continue;
              processedFileIds.add(row.id);
              const baseRev = normalizeRevision(row.revision, 1);
              const nextRev = baseRev + 1;
              const ownerUid = normalizeOwnerUid(row.ownerUid);
              const syncStatus = normalizeSyncStatus(row.syncStatus);
              fileStore.delete(row.id);
              tombstoneStore.put({
                id: createTombstoneId('file', row.id),
                entityType: 'file',
                entityId: row.id,
                parentId: projectId,
                deletedAt: nowIso,
                revision: nextRev,
                ownerUid,
                syncStatus,
                acknowledgedAt: null,
              } satisfies SyncTombstoneRecord);
              upsertOutboxInTx(
                outboxStore,
                buildOutboxRecord({
                  entityType: 'file',
                  entityId: row.id,
                  parentId: projectId,
                  operation: 'delete',
                  revision: nextRev,
                  baseRevision: baseRev,
                  ownerUid,
                  updatedAt: nowIso,
                  deletedAt: nowIso,
                }),
              );
            }
          };
        },
        'Failed deleting project from IndexedDB.',
      );
    } finally {
      db.close();
    }
  }

  async upsertFile(projectId: string, file: ProjectFile): Promise<void> {
    const db = await openDatabase(this.dbName);
    const nowIso = new Date().toISOString();
    const ownerUid = normalizeOwnerUid(file.ownerUid);
    const rev = normalizeRevision(file.revision, 1);
    try {
      await runWriteTransaction(
        db,
        [STORE_FILES, STORE_TOMBSTONES, STORE_OUTBOX],
        (tx) => {
          const fileStore = tx.objectStore(STORE_FILES);
          const tombstoneStore = tx.objectStore(STORE_TOMBSTONES);
          const outboxStore = tx.objectStore(STORE_OUTBOX);
          const existingReq = fileStore.get(file.id);
          existingReq.onsuccess = () => {
            const existing = existingReq.result as StoredFileRecord | undefined;
            const baseRev = existing ? normalizeRevision(existing.revision, 1) : null;
            fileStore.put(toStoredFileRecord(projectId, file, nowIso));
            tombstoneStore.delete(createTombstoneId('file', file.id));
            upsertOutboxInTx(
              outboxStore,
              buildOutboxRecord({
                entityType: 'file',
                entityId: file.id,
                parentId: projectId,
                operation: 'upsert',
                revision: rev,
                baseRevision: baseRev,
                ownerUid,
                updatedAt: file.updatedAt || nowIso,
              }),
            );
          };
        },
        'Failed saving file to IndexedDB.',
      );
    } finally {
      db.close();
    }
  }

  async deleteFile(projectId: string, fileId: string): Promise<void> {
    const db = await openDatabase(this.dbName);
    const nowIso = new Date().toISOString();
    try {
      await runWriteTransaction(
        db,
        [STORE_FILES, STORE_TOMBSTONES, STORE_OUTBOX],
        (tx) => {
          deleteEntityWithRevision(
            tx.objectStore(STORE_FILES),
            tx.objectStore(STORE_TOMBSTONES),
            tx.objectStore(STORE_OUTBOX),
            {
              entityType: 'file',
              entityId: fileId,
              parentId: projectId,
              nowIso,
            },
          );
        },
        'Failed deleting file from IndexedDB.',
      );
    } finally {
      db.close();
    }
  }

  async createConversation(conversation: Conversation): Promise<void> {
    if (conversation.isSample) return;
    const db = await openDatabase(this.dbName);
    const nowIso = new Date().toISOString();
    const ownerUid = normalizeOwnerUid(conversation.ownerUid);
    const rev = normalizeRevision(conversation.revision, 1);
    try {
      await runWriteTransaction(
        db,
        [STORE_CONVERSATIONS, STORE_MESSAGES, STORE_TOMBSTONES, STORE_OUTBOX],
        (tx) => {
          const convStore = tx.objectStore(STORE_CONVERSATIONS);
          const msgStore = tx.objectStore(STORE_MESSAGES);
          const tombstoneStore = tx.objectStore(STORE_TOMBSTONES);
          const outboxStore = tx.objectStore(STORE_OUTBOX);

          convStore.put(toStoredConversationRecord(conversation, nowIso));
          tombstoneStore.delete(createTombstoneId('conversation', conversation.id));
          upsertOutboxInTx(
            outboxStore,
            buildOutboxRecord({
              entityType: 'conversation',
              entityId: conversation.id,
              parentId: conversation.projectId,
              operation: 'upsert',
              revision: rev,
              baseRevision: null,
              ownerUid,
              updatedAt: conversation.updatedAt || nowIso,
            }),
          );

          conversation.messages.forEach((msg, idx) => {
            const msgOwner = normalizeOwnerUid(msg.ownerUid ?? ownerUid);
            const msgRev = normalizeRevision(msg.revision, 1);
            msgStore.put(
              toStoredMessageRecord(
                conversation.id,
                idx,
                { ...msg, ownerUid: msgOwner },
                conversation.createdAt || nowIso,
              ),
            );
            tombstoneStore.delete(createTombstoneId('message', msg.id));
            upsertOutboxInTx(
              outboxStore,
              buildOutboxRecord({
                entityType: 'message',
                entityId: msg.id,
                parentId: conversation.id,
                operation: 'upsert',
                revision: msgRev,
                baseRevision: null,
                ownerUid: msgOwner,
                updatedAt: msg.updatedAt || msg.createdAt || nowIso,
              }),
            );
          });
        },
        'Failed creating conversation in IndexedDB.',
      );
    } finally {
      db.close();
    }
  }

  async updateConversation(conversation: Conversation): Promise<void> {
    if (conversation.isSample) return;
    const db = await openDatabase(this.dbName);
    const nowIso = new Date().toISOString();
    const ownerUid = normalizeOwnerUid(conversation.ownerUid);
    const rev = normalizeRevision(conversation.revision, 1);
    try {
      await runWriteTransaction(
        db,
        [STORE_CONVERSATIONS, STORE_OUTBOX],
        (tx) => {
          const convStore = tx.objectStore(STORE_CONVERSATIONS);
          const outboxStore = tx.objectStore(STORE_OUTBOX);
          const existingReq = convStore.get(conversation.id);
          existingReq.onsuccess = () => {
            const existing = existingReq.result as StoredConversationRecord | undefined;
            const baseRev = existing ? normalizeRevision(existing.revision, 1) : null;
            convStore.put(toStoredConversationRecord(conversation, nowIso));
            upsertOutboxInTx(
              outboxStore,
              buildOutboxRecord({
                entityType: 'conversation',
                entityId: conversation.id,
                parentId: conversation.projectId,
                operation: 'upsert',
                revision: rev,
                baseRevision: baseRev,
                ownerUid,
                updatedAt: conversation.updatedAt || nowIso,
              }),
            );
          };
        },
        'Failed updating conversation in IndexedDB.',
      );
    } finally {
      db.close();
    }
  }

  async saveMessages(conversationId: string, messages: ChatMessage[]): Promise<void> {
    const db = await openDatabase(this.dbName);
    const nowIso = new Date().toISOString();
    try {
      await runWriteTransaction(
        db,
        [STORE_MESSAGES, STORE_TOMBSTONES, STORE_OUTBOX],
        (tx) => {
          const msgStore = tx.objectStore(STORE_MESSAGES);
          const tombstoneStore = tx.objectStore(STORE_TOMBSTONES);
          const outboxStore = tx.objectStore(STORE_OUTBOX);
          const nextIds = new Set(messages.map((m) => m.id));

          const existingReq = msgStore.index('conversationId').getAll(conversationId);
          existingReq.onsuccess = () => {
            const existingRows = (existingReq.result as StoredMessageRecord[]) ?? [];
            const existingRevById = new Map<string, number>();
            for (const row of existingRows) {
              if (!row || typeof row.id !== 'string') continue;
              const baseRev = normalizeRevision(row.revision, 1);
              existingRevById.set(row.id, baseRev);

              if (!nextIds.has(row.id)) {
                const nextRev = baseRev + 1;
                const ownerUid = normalizeOwnerUid(row.ownerUid);
                const syncStatus = normalizeSyncStatus(row.syncStatus);
                msgStore.delete(row.id);
                tombstoneStore.put({
                  id: createTombstoneId('message', row.id),
                  entityType: 'message',
                  entityId: row.id,
                  parentId: conversationId,
                  deletedAt: nowIso,
                  revision: nextRev,
                  ownerUid,
                  syncStatus,
                  acknowledgedAt: null,
                } satisfies SyncTombstoneRecord);
                upsertOutboxInTx(
                  outboxStore,
                  buildOutboxRecord({
                    entityType: 'message',
                    entityId: row.id,
                    parentId: conversationId,
                    operation: 'delete',
                    revision: nextRev,
                    baseRevision: baseRev,
                    ownerUid,
                    updatedAt: nowIso,
                    deletedAt: nowIso,
                  }),
                );
              }
            }

            messages.forEach((msg, index) => {
              const ownerUid = normalizeOwnerUid(msg.ownerUid);
              const rev = normalizeRevision(msg.revision, 1);
              const baseRev = existingRevById.get(msg.id) ?? null;
              msgStore.put(toStoredMessageRecord(conversationId, index, msg, nowIso));
              tombstoneStore.delete(createTombstoneId('message', msg.id));
              upsertOutboxInTx(
                outboxStore,
                buildOutboxRecord({
                  entityType: 'message',
                  entityId: msg.id,
                  parentId: conversationId,
                  operation: 'upsert',
                  revision: rev,
                  baseRevision: baseRev,
                  ownerUid,
                  updatedAt: msg.updatedAt || msg.createdAt || nowIso,
                }),
              );
            });
          };
        },
        'Failed saving messages to IndexedDB.',
      );
    } finally {
      db.close();
    }
  }

  async moveConversationToTrash(conversation: Conversation): Promise<void> {
    if (conversation.isSample) return;
    const db = await openDatabase(this.dbName);
    const nowIso = new Date().toISOString();
    const ownerUid = normalizeOwnerUid(conversation.ownerUid);
    const trashed: Conversation = {
      ...conversation,
      isSample: false,
      deletedAt: conversation.deletedAt || nowIso,
      revision: normalizeRevision(conversation.revision, 1),
      ownerUid,
      syncStatus: normalizeSyncStatus(conversation.syncStatus),
    };
    try {
      await runWriteTransaction(
        db,
        [STORE_CONVERSATIONS, STORE_MESSAGES, STORE_DELETED, STORE_OUTBOX],
        (tx) => {
          const convStore = tx.objectStore(STORE_CONVERSATIONS);
          const existingReq = convStore.get(conversation.id);
          existingReq.onsuccess = () => {
            const existing = existingReq.result as StoredConversationRecord | undefined;
            const baseRev = existing ? normalizeRevision(existing.revision, 1) : null;
            convStore.delete(conversation.id);
            const msgStore = tx.objectStore(STORE_MESSAGES);
            const keysReq = msgStore.index('conversationId').getAllKeys(conversation.id);
            keysReq.onsuccess = () => {
              for (const key of keysReq.result ?? []) {
                msgStore.delete(key);
              }
            };
            tx.objectStore(STORE_DELETED).put(trashed);
            upsertOutboxInTx(
              tx.objectStore(STORE_OUTBOX),
              buildOutboxRecord({
                entityType: 'conversation',
                entityId: conversation.id,
                parentId: conversation.projectId,
                operation: 'upsert',
                revision: trashed.revision ?? 1,
                baseRevision: baseRev,
                ownerUid,
                updatedAt: trashed.deletedAt || nowIso,
                deletedAt: trashed.deletedAt || nowIso,
              }),
            );
          };
        },
        'Failed moving conversation to Trash.',
      );
    } finally {
      db.close();
    }
  }

  async restoreDeletedConversation(conversation: Conversation): Promise<void> {
    const db = await openDatabase(this.dbName);
    const nowIso = new Date().toISOString();
    const prevRev = normalizeRevision(conversation.revision, 1);
    const ownerUid = normalizeOwnerUid(conversation.ownerUid);
    const restored: Conversation = {
      ...conversation,
      deletedAt: undefined,
      isSample: false,
      updatedAt: conversation.updatedAt || nowIso,
      revision: prevRev + 1,
      ownerUid,
      syncStatus: normalizeSyncStatus(conversation.syncStatus),
    };
    try {
      await runWriteTransaction(
        db,
        [STORE_DELETED, STORE_CONVERSATIONS, STORE_MESSAGES, STORE_TOMBSTONES, STORE_OUTBOX],
        (tx) => {
          tx.objectStore(STORE_DELETED).delete(conversation.id);
          tx.objectStore(STORE_CONVERSATIONS).put(toStoredConversationRecord(restored, nowIso));
          tx.objectStore(STORE_TOMBSTONES).delete(createTombstoneId('conversation', restored.id));
          upsertOutboxInTx(
            tx.objectStore(STORE_OUTBOX),
            buildOutboxRecord({
              entityType: 'conversation',
              entityId: restored.id,
              parentId: restored.projectId,
              operation: 'upsert',
              revision: restored.revision ?? prevRev + 1,
              baseRevision: prevRev,
              ownerUid,
              updatedAt: restored.updatedAt,
            }),
          );

          const msgStore = tx.objectStore(STORE_MESSAGES);
          restored.messages.forEach((msg, index) => {
            msgStore.put(
              toStoredMessageRecord(
                restored.id,
                index,
                { ...msg, ownerUid: normalizeOwnerUid(msg.ownerUid ?? ownerUid) },
                restored.createdAt || nowIso,
              ),
            );
          });
        },
        'Failed restoring conversation from Trash.',
      );
    } finally {
      db.close();
    }
  }

  async permanentlyDeleteConversation(
    conversationId: string,
    linkedVoiceSessionIds: string[] = [],
  ): Promise<void> {
    const db = await openDatabase(this.dbName);
    const nowIso = new Date().toISOString();
    try {
      await runWriteTransaction(
        db,
        [
          STORE_DELETED,
          STORE_CONVERSATIONS,
          STORE_MESSAGES,
          STORE_VOICE_SESSIONS,
          STORE_TOMBSTONES,
          STORE_OUTBOX,
        ],
        (tx) => {
          const tombstoneStore = tx.objectStore(STORE_TOMBSTONES);
          const outboxStore = tx.objectStore(STORE_OUTBOX);
          const msgStore = tx.objectStore(STORE_MESSAGES);
          const deletedStore = tx.objectStore(STORE_DELETED);
          const convStore = tx.objectStore(STORE_CONVERSATIONS);
          const voiceStore = tx.objectStore(STORE_VOICE_SESSIONS);

          const deletedMessageIds = new Set<string>();
          const emitMessageDelete = (
            msgId: string,
            baseRev: number,
            ownerUid: string | null,
            syncStatus: SyncStatus,
          ) => {
            if (deletedMessageIds.has(msgId)) return;
            deletedMessageIds.add(msgId);
            const nextRev = baseRev + 1;
            msgStore.delete(msgId);
            tombstoneStore.put({
              id: createTombstoneId('message', msgId),
              entityType: 'message',
              entityId: msgId,
              parentId: conversationId,
              deletedAt: nowIso,
              revision: nextRev,
              ownerUid,
              syncStatus,
              acknowledgedAt: null,
            } satisfies SyncTombstoneRecord);
            upsertOutboxInTx(
              outboxStore,
              buildOutboxRecord({
                entityType: 'message',
                entityId: msgId,
                parentId: conversationId,
                operation: 'delete',
                revision: nextRev,
                baseRevision: baseRev,
                ownerUid,
                updatedAt: nowIso,
                deletedAt: nowIso,
              }),
            );
          };

          const trashedReq = deletedStore.get(conversationId);
          const activeReq = convStore.get(conversationId);
          let convHandled = false;
          let trashedRow: Conversation | undefined;
          let activeRow: StoredConversationRecord | undefined;
          let trashedLoaded = false;
          let activeLoaded = false;

          const finalizeConversationDelete = () => {
            if (!trashedLoaded || !activeLoaded || convHandled) return;
            convHandled = true;
            const source = trashedRow ?? activeRow;
            if (!source) return;

            const baseRev = normalizeRevision(source.revision, 1);
            const nextRev = baseRev + 1;
            const ownerUid = normalizeOwnerUid(source.ownerUid);
            const syncStatus = normalizeSyncStatus(source.syncStatus);

            if (trashedRow) {
              deletedStore.delete(conversationId);
              if (Array.isArray(trashedRow.messages)) {
                for (const msg of trashedRow.messages) {
                  if (msg && typeof msg.id === 'string') {
                    emitMessageDelete(
                      msg.id,
                      normalizeRevision(msg.revision, 1),
                      normalizeOwnerUid(msg.ownerUid ?? ownerUid),
                      normalizeSyncStatus(msg.syncStatus ?? syncStatus),
                    );
                  }
                }
              }
            }
            if (activeRow) {
              convStore.delete(conversationId);
            }

            tombstoneStore.put({
              id: createTombstoneId('conversation', conversationId),
              entityType: 'conversation',
              entityId: conversationId,
              parentId: source.projectId ?? null,
              deletedAt: nowIso,
              revision: nextRev,
              ownerUid,
              syncStatus,
              acknowledgedAt: null,
            } satisfies SyncTombstoneRecord);
            upsertOutboxInTx(
              outboxStore,
              buildOutboxRecord({
                entityType: 'conversation',
                entityId: conversationId,
                parentId: source.projectId ?? null,
                operation: 'delete',
                revision: nextRev,
                baseRevision: baseRev,
                ownerUid,
                updatedAt: nowIso,
                deletedAt: nowIso,
              }),
            );
          };

          trashedReq.onsuccess = () => {
            trashedRow = trashedReq.result as Conversation | undefined;
            trashedLoaded = true;
            finalizeConversationDelete();
          };
          activeReq.onsuccess = () => {
            activeRow = activeReq.result as StoredConversationRecord | undefined;
            activeLoaded = true;
            finalizeConversationDelete();
          };

          const msgRowsReq = msgStore.index('conversationId').getAll(conversationId);
          msgRowsReq.onsuccess = () => {
            const rows = (msgRowsReq.result as StoredMessageRecord[]) ?? [];
            for (const row of rows) {
              if (!row || typeof row.id !== 'string') continue;
              emitMessageDelete(
                row.id,
                normalizeRevision(row.revision, 1),
                normalizeOwnerUid(row.ownerUid),
                normalizeSyncStatus(row.syncStatus),
              );
            }
          };

          const deletedVoiceIds = new Set<string>();
          const emitVoiceDelete = (row: VoiceSessionRecord) => {
            if (deletedVoiceIds.has(row.id)) return;
            deletedVoiceIds.add(row.id);
            const baseRev = normalizeRevision(row.revision, 1);
            const nextRev = baseRev + 1;
            const ownerUid = normalizeOwnerUid(row.ownerUid);
            const syncStatus = normalizeSyncStatus(row.syncStatus);
            voiceStore.delete(row.id);
            tombstoneStore.put({
              id: createTombstoneId('voice_session', row.id),
              entityType: 'voice_session',
              entityId: row.id,
              parentId: conversationId,
              deletedAt: nowIso,
              revision: nextRev,
              ownerUid,
              syncStatus,
              acknowledgedAt: null,
            } satisfies SyncTombstoneRecord);
            upsertOutboxInTx(
              outboxStore,
              buildOutboxRecord({
                entityType: 'voice_session',
                entityId: row.id,
                parentId: conversationId,
                operation: 'delete',
                revision: nextRev,
                baseRevision: baseRev,
                ownerUid,
                updatedAt: nowIso,
                deletedAt: nowIso,
              }),
            );
          };

          for (const vid of linkedVoiceSessionIds) {
            if (!vid) continue;
            const vReq = voiceStore.get(vid);
            vReq.onsuccess = () => {
              const row = vReq.result as VoiceSessionRecord | undefined;
              if (row) emitVoiceDelete(row);
            };
          }

          const voiceRowsReq = voiceStore.index('conversationId').getAll(conversationId);
          voiceRowsReq.onsuccess = () => {
            const rows = (voiceRowsReq.result as VoiceSessionRecord[]) ?? [];
            for (const row of rows) {
              if (row && typeof row.id === 'string') {
                emitVoiceDelete(row);
              }
            }
          };
        },
        'Failed permanently deleting conversation.',
      );
    } finally {
      db.close();
    }
  }

  async saveVoiceSession(record: VoiceSessionRecord): Promise<void> {
    const db = await openDatabase(this.dbName);
    const nowIso = new Date().toISOString();
    const ownerUid = normalizeOwnerUid(record.ownerUid);
    const rev = normalizeRevision(record.revision, 1);
    try {
      await runWriteTransaction(
        db,
        [STORE_VOICE_SESSIONS, STORE_OUTBOX],
        (tx) => {
          const voiceStore = tx.objectStore(STORE_VOICE_SESSIONS);
          const outboxStore = tx.objectStore(STORE_OUTBOX);
          const existingReq = voiceStore.get(record.id);
          existingReq.onsuccess = () => {
            const existing = existingReq.result as VoiceSessionRecord | undefined;
            const baseRev = existing ? normalizeRevision(existing.revision, 1) : null;
            const clean = toStoredVoiceSessionRecord(record, record.transcriptsSaved, nowIso);
            voiceStore.put(clean);
            upsertOutboxInTx(
              outboxStore,
              buildOutboxRecord({
                entityType: 'voice_session',
                entityId: record.id,
                parentId: record.conversationId,
                operation: 'upsert',
                revision: rev,
                baseRevision: baseRev,
                ownerUid,
                updatedAt: clean.updatedAt || nowIso,
              }),
            );
          };
        },
        'Failed saving voice session log.',
      );
    } finally {
      db.close();
    }
  }

  async saveSettings(
    preferences: PersistedPreferences,
    keys?: Array<keyof PersistedPreferences>,
    options?: { ownerUid?: string | null },
  ): Promise<void> {
    const targetOwner = normalizeOwnerUid(options?.ownerUid);
    const targetKeys = (keys ??
      ([
        'voiceSettings',
        'modelSettings',
        'appSettings',
        'activeProjectId',
        'activeConversationId',
        'activeFileId',
      ] as Array<keyof PersistedPreferences>)).filter(
      (k): k is PreferenceKey => k !== 'settingRevisions',
    );

    const entries: Array<{ key: PreferenceKey; value: unknown }> = [];
    for (const key of targetKeys) {
      const val = preferences[key];
      if (val === undefined) continue;
      const safeVal =
        key === 'voiceSettings' && typeof val === 'object' && val !== null
          ? { ...(val as VoiceSettings), saveRawAudio: false }
          : val;
      entries.push({ key, value: safeVal });
    }
    if (entries.length === 0) return;

    const db = await openDatabase(this.dbName);
    const nowIso = new Date().toISOString();
    try {
      await runWriteTransaction(
        db,
        [STORE_SETTINGS, STORE_OUTBOX],
        (tx) => {
          const settingsStore = tx.objectStore(STORE_SETTINGS);
          const outboxStore = tx.objectStore(STORE_OUTBOX);

          for (const entry of entries) {
            const settingKey = entry.key;
            if (!isSettingSyncable(settingKey)) {
              // Device-local pointers persist strictly locally and NEVER enter sync_outbox
              settingsStore.put({
                key: settingKey,
                settingKey,
                value: entry.value,
                updatedAt: nowIso,
                ownerUid: targetOwner,
                syncCategory: 'device_local',
              } satisfies StoredSettingRecord);
              continue;
            }

            const storageKey = getSettingStorageKey(settingKey, targetOwner);
            const existingReq = settingsStore.get(storageKey);
            existingReq.onsuccess = () => {
              const existing = existingReq.result as StoredSettingRecord | undefined;
              const prevRev = existing ? normalizeRevision(existing.revision, 1) : 0;
              const explicitRev = preferences.settingRevisions?.[settingKey];
              const nextRev =
                typeof explicitRev === 'number' && explicitRev > prevRev
                  ? Math.floor(explicitRev)
                  : prevRev + 1;
              settingsStore.put({
                key: storageKey,
                settingKey,
                value: entry.value,
                updatedAt: nowIso,
                revision: nextRev,
                ownerUid: targetOwner,
                syncStatus: targetOwner ? 'pending' : 'local_only',
                syncCategory: 'account_syncable',
              } satisfies StoredSettingRecord);
              upsertOutboxInTx(
                outboxStore,
                buildOutboxRecord({
                  entityType: 'setting',
                  entityId: settingKey,
                  parentId: null,
                  operation: 'upsert',
                  revision: nextRev,
                  baseRevision: prevRev > 0 ? prevRev : null,
                  ownerUid: targetOwner,
                  updatedAt: nowIso,
                }),
              );
            };
          }
        },
        'Failed saving settings to IndexedDB.',
      );
    } finally {
      db.close();
    }
  }

  private applyDeltaToTransaction(
    tx: IDBTransaction,
    delta: WorkspaceSnapshotDelta,
    saveTranscripts: boolean,
    nowIso: string,
  ): void {
    const projectStore = tx.objectStore(STORE_PROJECTS);
    const fileStore = tx.objectStore(STORE_FILES);
    const convStore = tx.objectStore(STORE_CONVERSATIONS);
    const msgStore = tx.objectStore(STORE_MESSAGES);
    const voiceStore = tx.objectStore(STORE_VOICE_SESSIONS);
    const deletedStore = tx.objectStore(STORE_DELETED);
    const settingsStore = tx.objectStore(STORE_SETTINGS);
    const tombstoneStore = tx.objectStore(STORE_TOMBSTONES);
    const outboxStore = tx.objectStore(STORE_OUTBOX);

    // Incremental deletes first
    for (const fileRef of delta.deletedFileIds) {
      fileStore.delete(fileRef.id);
    }
    for (const projId of delta.deletedProjectIds) {
      projectStore.delete(projId);
    }
    for (const msgRef of delta.deletedMessageIds) {
      msgStore.delete(msgRef.id);
    }
    for (const convId of delta.deletedConversationIds) {
      convStore.delete(convId);
    }
    for (const trashedId of delta.removedDeletedConversationIds) {
      deletedStore.delete(trashedId);
    }
    for (const voiceId of delta.deletedVoiceSessionIds) {
      voiceStore.delete(voiceId);
    }

    // Incremental upserts
    for (const proj of delta.upsertedProjects) {
      projectStore.put(toStoredProjectRecord(proj, nowIso));
    }
    for (const entry of delta.upsertedFiles) {
      fileStore.put(toStoredFileRecord(entry.projectId, entry.file, nowIso));
    }
    for (const conv of delta.upsertedConversations) {
      convStore.put(toStoredConversationRecord(conv, nowIso));
    }
    for (const entry of delta.upsertedMessages) {
      msgStore.put(
        toStoredMessageRecord(entry.conversationId, entry.orderIndex, entry.message, nowIso),
      );
    }
    for (const trashed of delta.upsertedDeletedConversations) {
      deletedStore.put({
        ...trashed,
        isSample: false,
        revision: normalizeRevision(trashed.revision, 1),
        ownerUid: normalizeOwnerUid(trashed.ownerUid),
        syncStatus: normalizeSyncStatus(trashed.syncStatus),
      });
    }
    for (const session of delta.upsertedVoiceSessions) {
      voiceStore.put(toStoredVoiceSessionRecord(session, saveTranscripts, nowIso));
    }
    for (const setting of delta.changedSettings) {
      if (isDeviceLocalSetting(setting.key)) {
        settingsStore.put({
          key: setting.key,
          settingKey: setting.key,
          value: setting.value,
          updatedAt: nowIso,
          ownerUid: setting.ownerUid,
          syncCategory: 'device_local',
        } satisfies StoredSettingRecord);
      } else {
        const storageKey = getSettingStorageKey(setting.key, setting.ownerUid);
        settingsStore.put({
          key: storageKey,
          settingKey: setting.key,
          value: setting.value,
          updatedAt: nowIso,
          revision: setting.revision,
          ownerUid: setting.ownerUid,
          syncStatus: setting.ownerUid ? 'pending' : 'local_only',
          syncCategory: 'account_syncable',
        } satisfies StoredSettingRecord);
      }
    }

    // Tombstones & coalesced outbox
    for (const tombId of delta.tombstoneIdsToDelete) {
      tombstoneStore.delete(tombId);
    }
    for (const tombstone of delta.tombstonesToPut) {
      tombstoneStore.put({
        ...tombstone,
        acknowledgedAt: tombstone.acknowledgedAt ?? null,
      });
    }
    for (const outbox of delta.outboxEntriesToPut) {
      upsertOutboxInTx(outboxStore, outbox);
    }
  }

  async commitWorkspaceDelta(
    previous: PersistedWorkspaceSnapshot | null,
    next: PersistedWorkspaceSnapshot,
    options?: { nowIso?: string; ownerUid?: string | null },
  ): Promise<WorkspaceStorageStats> {
    const nowIso = options?.nowIso ?? new Date().toISOString();
    const ownerUid = normalizeOwnerUid(options?.ownerUid);
    const delta = computeWorkspaceDelta(previous, next, { nowIso, ownerUid });
    if (delta.isEmpty) {
      return await this.getStorageStats({ activeOwnerUid: ownerUid });
    }

    const saveTranscripts = next.preferences.voiceSettings?.saveTranscripts ?? true;
    const db = await openDatabase(this.dbName);
    try {
      await runWriteTransaction(
        db,
        [
          STORE_PROJECTS,
          STORE_FILES,
          STORE_CONVERSATIONS,
          STORE_MESSAGES,
          STORE_VOICE_SESSIONS,
          STORE_DELETED,
          STORE_SETTINGS,
          STORE_TOMBSTONES,
          STORE_OUTBOX,
        ],
        (tx) => {
          this.applyDeltaToTransaction(tx, delta, saveTranscripts, nowIso);
        },
        'Atomic incremental IndexedDB transaction failed.',
      );
      return await this.getStorageStats({ activeOwnerUid: ownerUid });
    } finally {
      db.close();
    }
  }

  async importWorkspaceSnapshot(
    previous: PersistedWorkspaceSnapshot,
    next: PersistedWorkspaceSnapshot,
    options?: { ownerUid?: string | null },
  ): Promise<WorkspaceStorageStats> {
    return await this.commitWorkspaceDelta(previous, next, { ownerUid: options?.ownerUid });
  }

  async readTombstones(options?: { ownerUid?: string | null }): Promise<SyncTombstoneRecord[]> {
    const filterByOwner = options !== undefined && 'ownerUid' in options;
    const targetOwner = normalizeOwnerUid(options?.ownerUid);
    const db = await openDatabase(this.dbName);
    try {
      const tx = db.transaction([STORE_TOMBSTONES], 'readonly');
      const rows = await readAllStore<SyncTombstoneRecord>(tx, STORE_TOMBSTONES);
      return rows
        .map((r) => ({
          ...r,
          ownerUid: normalizeOwnerUid(r.ownerUid),
          acknowledgedAt: r.acknowledgedAt ?? null,
        }))
        .filter((r) => (filterByOwner ? recordBelongsToOwner(r.ownerUid, targetOwner) : true));
    } finally {
      db.close();
    }
  }

  async readOutbox(options?: { ownerUid?: string | null }): Promise<SyncOutboxRecord[]> {
    const filterByOwner = options !== undefined && 'ownerUid' in options;
    const targetOwner = normalizeOwnerUid(options?.ownerUid);
    const db = await openDatabase(this.dbName);
    try {
      const tx = db.transaction([STORE_OUTBOX], 'readonly');
      const rows = await readAllStore<SyncOutboxRecord>(tx, STORE_OUTBOX);
      return rows
        .filter((r) => (filterByOwner ? recordBelongsToOwner(r.ownerUid, targetOwner) : true))
        .sort((a, b) => {
          const cmp = (a.createdAt || a.updatedAt).localeCompare(b.createdAt || b.updatedAt);
          return cmp !== 0 ? cmp : a.revision - b.revision;
        });
    } finally {
      db.close();
    }
  }

  async readPendingOutbox(options?: {
    ownerUid?: string | null;
    nowIso?: string;
  }): Promise<SyncOutboxRecord[]> {
    const targetOwner = normalizeOwnerUid(options?.ownerUid);
    const nowIso = options?.nowIso ?? new Date().toISOString();
    const rows = await this.readOutbox({ ownerUid: targetOwner });
    return rows.filter((row) => {
      if (row.status === 'pending') return true;
      if (row.status === 'failed' && row.nextRetryAt !== null && row.nextRetryAt <= nowIso) {
        return true;
      }
      return false;
    });
  }

  async claimOutboxOperations(options: {
    workerId: string;
    ownerUid?: string | null;
    limit?: number;
    leaseDurationMs?: number;
    nowIso?: string;
  }): Promise<SyncOutboxRecord[]> {
    const targetOwner = normalizeOwnerUid(options.ownerUid);
    const nowIso = options.nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const leaseDurationMs = Math.max(1000, options.leaseDurationMs ?? 30_000);
    const leaseExpiresAt = new Date(
      (Number.isFinite(nowMs) ? nowMs : Date.now()) + leaseDurationMs,
    ).toISOString();
    const limit = Math.max(1, options.limit ?? 25);

    const db = await openDatabase(this.dbName);
    const claimed: SyncOutboxRecord[] = [];
    try {
      await runWriteTransaction(
        db,
        [STORE_OUTBOX],
        (tx) => {
          const outboxStore = tx.objectStore(STORE_OUTBOX);
          const req = outboxStore.getAll();
          req.onsuccess = () => {
            const rows = ((req.result as SyncOutboxRecord[]) ?? []).filter((r) =>
              recordBelongsToOwner(r.ownerUid, targetOwner),
            );

            // Auto-recover expired leases before claiming
            const eligible: SyncOutboxRecord[] = [];
            for (const row of rows) {
              if (row.status === 'in_flight') {
                if (row.leaseExpiresAt && row.leaseExpiresAt <= nowIso) {
                  const recovered: SyncOutboxRecord = {
                    ...row,
                    status: 'pending',
                    claimedAt: null,
                    leaseExpiresAt: null,
                    claimedBy: null,
                  };
                  outboxStore.put(recovered);
                  eligible.push(recovered);
                }
                continue;
              }
              if (
                row.status === 'pending' ||
                (row.status === 'failed' && row.nextRetryAt !== null && row.nextRetryAt <= nowIso)
              ) {
                eligible.push(row);
              }
            }

            eligible.sort((a, b) => {
              const cmp = (a.createdAt || a.updatedAt).localeCompare(b.createdAt || b.updatedAt);
              return cmp !== 0 ? cmp : a.revision - b.revision;
            });

            const batch = eligible.slice(0, limit);
            for (const item of batch) {
              const leased: SyncOutboxRecord = {
                ...item,
                status: 'in_flight',
                claimedAt: nowIso,
                leaseExpiresAt,
                claimedBy: options.workerId,
                lastAttemptAt: nowIso,
              };
              outboxStore.put(leased);
              claimed.push(leased);
            }
          };
        },
        'Failed claiming outbox operations.',
      );
      return claimed;
    } finally {
      db.close();
    }
  }

  async recoverExpiredOutboxLeases(options?: {
    ownerUid?: string | null;
    nowIso?: string;
  }): Promise<number> {
    const filterByOwner = options !== undefined && 'ownerUid' in options;
    const targetOwner = normalizeOwnerUid(options?.ownerUid);
    const nowIso = options?.nowIso ?? new Date().toISOString();
    const db = await openDatabase(this.dbName);
    let recoveredCount = 0;
    try {
      await runWriteTransaction(
        db,
        [STORE_OUTBOX],
        (tx) => {
          const outboxStore = tx.objectStore(STORE_OUTBOX);
          const req = outboxStore.getAll();
          req.onsuccess = () => {
            const rows = (req.result as SyncOutboxRecord[]) ?? [];
            for (const row of rows) {
              if (filterByOwner && !recordBelongsToOwner(row.ownerUid, targetOwner)) continue;
              if (
                row.status === 'in_flight' &&
                typeof row.leaseExpiresAt === 'string' &&
                row.leaseExpiresAt <= nowIso
              ) {
                outboxStore.put({
                  ...row,
                  status: 'pending',
                  claimedAt: null,
                  leaseExpiresAt: null,
                  claimedBy: null,
                } satisfies SyncOutboxRecord);
                recoveredCount += 1;
              }
            }
          };
        },
        'Failed recovering expired outbox leases.',
      );
      return recoveredCount;
    } finally {
      db.close();
    }
  }

  async markOutboxOperationFailed(
    target: { id: string; operationId: string; ownerUid?: string | null },
    errorMessage: string,
    options?: {
      backoffMs?: number;
      maxRetries?: number;
      permanent?: boolean;
      nowIso?: string;
    },
  ): Promise<SyncOutboxRecord | null> {
    const nowIso = options?.nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const baseBackoffMs = Math.max(500, options?.backoffMs ?? 5000);
    const maxRetries = Math.max(1, options?.maxRetries ?? 5);
    const filterByOwner = 'ownerUid' in target && target.ownerUid !== undefined;
    const expectedOwner = normalizeOwnerUid(target.ownerUid);

    const db = await openDatabase(this.dbName);
    let updatedRecord: SyncOutboxRecord | null = null;
    try {
      await runWriteTransaction(
        db,
        [STORE_OUTBOX],
        (tx) => {
          const outboxStore = tx.objectStore(STORE_OUTBOX);
          const req = outboxStore.get(target.id);
          req.onsuccess = () => {
            const existing = req.result as SyncOutboxRecord | undefined;
            if (!existing) return;
            if (existing.operationId !== target.operationId) return;
            if (filterByOwner && !recordBelongsToOwner(existing.ownerUid, expectedOwner)) return;

            const nextRetryCount = (existing.retryCount ?? 0) + 1;
            const exhaustRetries = Boolean(options?.permanent) || nextRetryCount >= maxRetries;
            const delayMs = baseBackoffMs * Math.pow(2, nextRetryCount - 1);
            const nextRetryAt = exhaustRetries
              ? null
              : new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + delayMs).toISOString();

            const nextRow: SyncOutboxRecord = {
              ...existing,
              status: 'failed',
              retryCount: nextRetryCount,
              lastError: errorMessage,
              nextRetryAt,
              claimedAt: null,
              leaseExpiresAt: null,
              claimedBy: null,
              lastAttemptAt: nowIso,
            };
            outboxStore.put(nextRow);
            updatedRecord = nextRow;
          };
        },
        'Failed marking outbox operation error.',
      );
      return updatedRecord;
    } finally {
      db.close();
    }
  }

  async acknowledgeOutboxOperations(
    acks: Array<{ id: string; operationId: string }>,
    options?: { ownerUid?: string | null; nowIso?: string },
  ): Promise<{ acknowledgedIds: string[]; skippedIds: string[] }> {
    const filterByOwner = options !== undefined && 'ownerUid' in options;
    const expectedOwner = normalizeOwnerUid(options?.ownerUid);
    const nowIso = options?.nowIso ?? new Date().toISOString();
    const acknowledgedIds: string[] = [];
    const skippedIds: string[] = [];

    if (acks.length === 0) {
      return { acknowledgedIds, skippedIds };
    }

    const db = await openDatabase(this.dbName);
    try {
      await runWriteTransaction(
        db,
        [
          STORE_OUTBOX,
          STORE_TOMBSTONES,
          STORE_PROJECTS,
          STORE_FILES,
          STORE_CONVERSATIONS,
          STORE_MESSAGES,
          STORE_VOICE_SESSIONS,
          STORE_DELETED,
          STORE_SETTINGS,
        ],
        (tx) => {
          const outboxStore = tx.objectStore(STORE_OUTBOX);
          const tombstoneStore = tx.objectStore(STORE_TOMBSTONES);

          const markStoreRowSynced = (
            storeName: string,
            key: string,
            ackedRev: number,
          ) => {
            const store = tx.objectStore(storeName);
            const r = store.get(key);
            r.onsuccess = () => {
              const row = r.result as
                | { revision?: number; syncStatus?: SyncStatus }
                | undefined;
              if (!row) return;
              const currentRev = normalizeRevision(row.revision, 1);
              if (currentRev <= ackedRev) {
                store.put({ ...row, syncStatus: 'synced' });
              }
            };
          };

          for (const ack of acks) {
            const req = outboxStore.get(ack.id);
            req.onsuccess = () => {
              const existing = req.result as SyncOutboxRecord | undefined;
              if (
                !existing ||
                existing.operationId !== ack.operationId ||
                (filterByOwner && !recordBelongsToOwner(existing.ownerUid, expectedOwner))
              ) {
                skippedIds.push(ack.id);
                return;
              }

              outboxStore.delete(ack.id);
              acknowledgedIds.push(ack.id);

              if (existing.operation === 'delete') {
                const tombId = createTombstoneId(existing.entityType, existing.entityId);
                const tombReq = tombstoneStore.get(tombId);
                tombReq.onsuccess = () => {
                  const tomb = tombReq.result as SyncTombstoneRecord | undefined;
                  if (tomb && normalizeRevision(tomb.revision, 1) <= existing.revision) {
                    tombstoneStore.put({
                      ...tomb,
                      syncStatus: 'synced',
                      acknowledgedAt: nowIso,
                    } satisfies SyncTombstoneRecord);
                  }
                };
                return;
              }

              // Upsert acknowledgement: mark matching entity synced ONLY if local revision hasn't moved ahead
              switch (existing.entityType) {
                case 'project':
                  markStoreRowSynced(STORE_PROJECTS, existing.entityId, existing.revision);
                  break;
                case 'file':
                  markStoreRowSynced(STORE_FILES, existing.entityId, existing.revision);
                  break;
                case 'conversation':
                  markStoreRowSynced(STORE_CONVERSATIONS, existing.entityId, existing.revision);
                  markStoreRowSynced(STORE_DELETED, existing.entityId, existing.revision);
                  break;
                case 'message':
                  markStoreRowSynced(STORE_MESSAGES, existing.entityId, existing.revision);
                  break;
                case 'voice_session':
                  markStoreRowSynced(STORE_VOICE_SESSIONS, existing.entityId, existing.revision);
                  break;
                case 'setting': {
                  const settingKey = getSettingStorageKey(
                    existing.entityId as PreferenceKey,
                    normalizeOwnerUid(existing.ownerUid),
                  );
                  markStoreRowSynced(STORE_SETTINGS, settingKey, existing.revision);
                  break;
                }
              }
            };
          }
        },
        'Failed acknowledging outbox operations.',
      );
      return { acknowledgedIds, skippedIds };
    } finally {
      db.close();
    }
  }

  async pruneAcknowledgedTombstones(
    olderThanIso: string,
    options?: { ownerUid?: string | null },
  ): Promise<number> {
    const filterByOwner = options !== undefined && 'ownerUid' in options;
    const targetOwner = normalizeOwnerUid(options?.ownerUid);
    const db = await openDatabase(this.dbName);
    let pruned = 0;
    try {
      await runWriteTransaction(
        db,
        [STORE_TOMBSTONES],
        (tx) => {
          const tombstoneStore = tx.objectStore(STORE_TOMBSTONES);
          const req = tombstoneStore.getAll();
          req.onsuccess = () => {
            const rows = (req.result as SyncTombstoneRecord[]) ?? [];
            for (const row of rows) {
              if (filterByOwner && !recordBelongsToOwner(row.ownerUid, targetOwner)) continue;
              // Never purge unacknowledged tombstones
              if (
                typeof row.acknowledgedAt === 'string' &&
                row.acknowledgedAt.length > 0 &&
                row.acknowledgedAt <= olderThanIso
              ) {
                tombstoneStore.delete(row.id);
                pruned += 1;
              }
            }
          };
        },
        'Failed pruning acknowledged tombstones.',
      );
      return pruned;
    } finally {
      db.close();
    }
  }

  async getOutboxDiagnostics(options?: {
    ownerUid?: string | null;
    nowIso?: string;
  }): Promise<OutboxDiagnostics> {
    const targetOwner = normalizeOwnerUid(options?.ownerUid);
    const nowIso = options?.nowIso ?? new Date().toISOString();
    const [outboxRows, tombstoneRows] = await Promise.all([
      this.readOutbox({ ownerUid: targetOwner }),
      this.readTombstones({ ownerUid: targetOwner }),
    ]);

    let pendingCount = 0;
    let inFlightCount = 0;
    let failedCount = 0;
    let expiredLeaseCount = 0;
    let retryReadyCount = 0;
    let oldestPendingAt: string | null = null;

    for (const row of outboxRows) {
      if (row.status === 'pending') {
        pendingCount += 1;
        const ts = row.createdAt || row.updatedAt;
        if (!oldestPendingAt || ts < oldestPendingAt) oldestPendingAt = ts;
      } else if (row.status === 'in_flight') {
        inFlightCount += 1;
        if (typeof row.leaseExpiresAt === 'string' && row.leaseExpiresAt <= nowIso) {
          expiredLeaseCount += 1;
        }
      } else if (row.status === 'failed') {
        failedCount += 1;
        if (typeof row.nextRetryAt === 'string' && row.nextRetryAt <= nowIso) {
          retryReadyCount += 1;
        }
      }
    }

    let unacknowledgedTombstoneCount = 0;
    let acknowledgedTombstoneCount = 0;
    for (const tomb of tombstoneRows) {
      if (typeof tomb.acknowledgedAt === 'string' && tomb.acknowledgedAt.length > 0) {
        acknowledgedTombstoneCount += 1;
      } else {
        unacknowledgedTombstoneCount += 1;
      }
    }

    return {
      ownerUid: targetOwner,
      totalCount: outboxRows.length,
      pendingCount,
      inFlightCount,
      failedCount,
      expiredLeaseCount,
      retryReadyCount,
      oldestPendingAt,
      unacknowledgedTombstoneCount,
      acknowledgedTombstoneCount,
    };
  }

  async getOwnershipSummary(activeOwnerUid?: string | null): Promise<OwnershipSummary> {
    const activeUid = normalizeOwnerUid(activeOwnerUid);
    const db = await openDatabase(this.dbName);
    try {
      const tx = db.transaction(
        [
          STORE_PROJECTS,
          STORE_FILES,
          STORE_CONVERSATIONS,
          STORE_MESSAGES,
          STORE_VOICE_SESSIONS,
          STORE_DELETED,
          STORE_SETTINGS,
          STORE_OUTBOX,
        ],
        'readonly',
      );
      const [
        projects,
        files,
        convs,
        msgs,
        voices,
        deleted,
        settings,
        outbox,
      ] = await Promise.all([
        readAllStore<{ ownerUid?: string | null; isSample?: boolean }>(tx, STORE_PROJECTS),
        readAllStore<{ ownerUid?: string | null }>(tx, STORE_FILES),
        readAllStore<{ ownerUid?: string | null; isSample?: boolean }>(tx, STORE_CONVERSATIONS),
        readAllStore<{ ownerUid?: string | null }>(tx, STORE_MESSAGES),
        readAllStore<{ ownerUid?: string | null }>(tx, STORE_VOICE_SESSIONS),
        readAllStore<{ ownerUid?: string | null; isSample?: boolean }>(tx, STORE_DELETED),
        readAllStore<StoredSettingRecord>(tx, STORE_SETTINGS),
        readAllStore<SyncOutboxRecord>(tx, STORE_OUTBOX),
      ]);

      let unclaimedCount = 0;
      let activeAccountCount = 0;
      let otherAccountCount = 0;
      const otherUids = new Set<string>();

      const tallyOwner = (rawUid?: string | null) => {
        const uid = normalizeOwnerUid(rawUid);
        if (uid === null) {
          unclaimedCount += 1;
        } else if (activeUid !== null && uid === activeUid) {
          activeAccountCount += 1;
        } else {
          otherAccountCount += 1;
          otherUids.add(uid);
        }
      };

      for (const r of projects) if (!r.isSample) tallyOwner(r.ownerUid);
      for (const r of files) tallyOwner(r.ownerUid);
      for (const r of convs) if (!r.isSample) tallyOwner(r.ownerUid);
      for (const r of msgs) tallyOwner(r.ownerUid);
      for (const r of voices) tallyOwner(r.ownerUid);
      for (const r of deleted) if (!r.isSample) tallyOwner(r.ownerUid);
      for (const r of settings) {
        const logical = resolveSettingLogicalKey(r);
        if (logical && isSettingSyncable(logical)) {
          tallyOwner(r.ownerUid);
        }
      }

      let unclaimedOutboxCount = 0;
      let activeAccountOutboxCount = 0;
      let otherAccountOutboxCount = 0;
      for (const row of outbox) {
        const uid = normalizeOwnerUid(row.ownerUid);
        if (uid === null) {
          unclaimedOutboxCount += 1;
        } else if (activeUid !== null && uid === activeUid) {
          activeAccountOutboxCount += 1;
        } else {
          otherAccountOutboxCount += 1;
          otherUids.add(uid);
        }
      }

      return {
        activeOwnerUid: activeUid,
        unclaimedCount,
        activeAccountCount,
        otherAccountCount,
        otherAccountUids: Array.from(otherUids).sort(),
        unclaimedOutboxCount,
        activeAccountOutboxCount,
        otherAccountOutboxCount,
      };
    } finally {
      db.close();
    }
  }

  async claimUnclaimedLocalData(
    targetOwnerUid: string,
    options?: {
      strategy?: ClaimCollisionStrategy;
      nowIso?: string;
      existingTargetIds?: {
        projects?: string[];
        files?: string[];
        conversations?: string[];
        messages?: string[];
        voiceSessions?: string[];
      };
    },
  ): Promise<ClaimLocalDataResult> {
    const targetUid = normalizeOwnerUid(targetOwnerUid);
    if (!targetUid) {
      throw new Error('Cannot claim local data without a valid target account UID.');
    }
    const strategy: ClaimCollisionStrategy = options?.strategy ?? 'abort_on_collision';
    const nowIso = options?.nowIso ?? new Date().toISOString();
    const externalTargetProjects = new Set(options?.existingTargetIds?.projects ?? []);
    const externalTargetFiles = new Set(options?.existingTargetIds?.files ?? []);
    const externalTargetConvs = new Set(options?.existingTargetIds?.conversations ?? []);
    const externalTargetMsgs = new Set(options?.existingTargetIds?.messages ?? []);
    const externalTargetVoices = new Set(options?.existingTargetIds?.voiceSessions ?? []);

    const result: ClaimLocalDataResult = {
      claimedCount: 0,
      remappedProjectIds: {},
      remappedFileIds: {},
      remappedConversationIds: {},
      remappedMessageIds: {},
      remappedVoiceSessionIds: {},
      targetOwnerUid: targetUid,
    };

    const db = await openDatabase(this.dbName);
    try {
      await runWriteTransaction(
        db,
        [
          STORE_PROJECTS,
          STORE_FILES,
          STORE_CONVERSATIONS,
          STORE_MESSAGES,
          STORE_VOICE_SESSIONS,
          STORE_DELETED,
          STORE_SETTINGS,
          STORE_TOMBSTONES,
          STORE_OUTBOX,
        ],
        (tx, abortWithError) => {
          const projectStore = tx.objectStore(STORE_PROJECTS);
          const fileStore = tx.objectStore(STORE_FILES);
          const convStore = tx.objectStore(STORE_CONVERSATIONS);
          const msgStore = tx.objectStore(STORE_MESSAGES);
          const voiceStore = tx.objectStore(STORE_VOICE_SESSIONS);
          const deletedStore = tx.objectStore(STORE_DELETED);
          const settingsStore = tx.objectStore(STORE_SETTINGS);
          const tombstoneStore = tx.objectStore(STORE_TOMBSTONES);
          const outboxStore = tx.objectStore(STORE_OUTBOX);

          const rProj = projectStore.getAll();
          const rFile = fileStore.getAll();
          const rConv = convStore.getAll();
          const rMsg = msgStore.getAll();
          const rVoice = voiceStore.getAll();
          const rDel = deletedStore.getAll();
          const rSet = settingsStore.getAll();
          const rTomb = tombstoneStore.getAll();
          const rOut = outboxStore.getAll();

          let remaining = 9;
          let projects: StoredProjectRecord[] = [];
          let files: StoredFileRecord[] = [];
          let convs: StoredConversationRecord[] = [];
          let msgs: StoredMessageRecord[] = [];
          let voices: VoiceSessionRecord[] = [];
          let deleted: Conversation[] = [];
          let settings: StoredSettingRecord[] = [];
          let tombstones: SyncTombstoneRecord[] = [];
          let outboxRows: SyncOutboxRecord[] = [];

          const proceed = () => {
            remaining -= 1;
            if (remaining > 0) return;

            const takenProjectIds = new Set<string>([
              ...projects.map((p) => p.id),
              ...externalTargetProjects,
            ]);
            const takenFileIds = new Set<string>([
              ...files.map((f) => f.id),
              ...externalTargetFiles,
            ]);
            const takenConvIds = new Set<string>([
              ...convs.map((c) => c.id),
              ...deleted.map((d) => d.id),
              ...externalTargetConvs,
            ]);
            const takenMsgIds = new Set<string>([
              ...msgs.map((m) => m.id),
              ...externalTargetMsgs,
            ]);
            const takenVoiceIds = new Set<string>([
              ...voices.map((v) => v.id),
              ...externalTargetVoices,
            ]);

            const targetOwnedKeys = new Set<string>();
            for (const t of tombstones) {
              if (normalizeOwnerUid(t.ownerUid) === targetUid) {
                targetOwnedKeys.add(`${t.entityType}:${t.entityId}`);
              }
            }
            for (const o of outboxRows) {
              if (normalizeOwnerUid(o.ownerUid) === targetUid) {
                targetOwnedKeys.add(`${o.entityType}:${o.entityId}`);
              }
            }

            const unclaimedProjects = projects.filter((p) => normalizeOwnerUid(p.ownerUid) === null);
            const unclaimedFiles = files.filter((f) => normalizeOwnerUid(f.ownerUid) === null);
            const unclaimedConvs = convs.filter((c) => normalizeOwnerUid(c.ownerUid) === null);
            const unclaimedDeleted = deleted.filter((d) => normalizeOwnerUid(d.ownerUid) === null);
            const unclaimedMsgs = msgs.filter((m) => normalizeOwnerUid(m.ownerUid) === null);
            const unclaimedVoices = voices.filter((v) => normalizeOwnerUid(v.ownerUid) === null);

            const hasProjectCollision = (id: string) =>
              externalTargetProjects.has(id) || targetOwnedKeys.has(`project:${id}`);
            const hasFileCollision = (id: string) =>
              externalTargetFiles.has(id) || targetOwnedKeys.has(`file:${id}`);
            const hasConvCollision = (id: string) =>
              externalTargetConvs.has(id) || targetOwnedKeys.has(`conversation:${id}`);
            const hasMsgCollision = (id: string) =>
              externalTargetMsgs.has(id) || targetOwnedKeys.has(`message:${id}`);
            const hasVoiceCollision = (id: string) =>
              externalTargetVoices.has(id) || targetOwnedKeys.has(`voice_session:${id}`);

            const collisions: string[] = [];
            for (const p of unclaimedProjects) if (hasProjectCollision(p.id)) collisions.push(`project:${p.id}`);
            for (const f of unclaimedFiles) if (hasFileCollision(f.id)) collisions.push(`file:${f.id}`);
            for (const c of unclaimedConvs) if (hasConvCollision(c.id)) collisions.push(`conversation:${c.id}`);
            for (const d of unclaimedDeleted) if (hasConvCollision(d.id)) collisions.push(`conversation:${d.id}`);
            for (const m of unclaimedMsgs) if (hasMsgCollision(m.id)) collisions.push(`message:${m.id}`);
            for (const v of unclaimedVoices) if (hasVoiceCollision(v.id)) collisions.push(`voice_session:${v.id}`);

            if (collisions.length > 0 && strategy === 'abort_on_collision') {
              abortWithError(
                new Error(
                  `Ownership claim aborted due to ID collision with target account (${collisions[0]}).`,
                ),
              );
              return;
            }

            for (const p of unclaimedProjects) {
              if (hasProjectCollision(p.id)) {
                result.remappedProjectIds[p.id] = generateUniqueRemappedId('proj', takenProjectIds);
              }
            }
            for (const f of unclaimedFiles) {
              if (hasFileCollision(f.id)) {
                result.remappedFileIds[f.id] = generateUniqueRemappedId('file', takenFileIds);
              }
            }
            for (const c of unclaimedConvs) {
              if (hasConvCollision(c.id)) {
                result.remappedConversationIds[c.id] = generateUniqueRemappedId('conv', takenConvIds);
              }
            }
            for (const d of unclaimedDeleted) {
              if (hasConvCollision(d.id) && !result.remappedConversationIds[d.id]) {
                result.remappedConversationIds[d.id] = generateUniqueRemappedId('conv', takenConvIds);
              }
            }
            for (const m of unclaimedMsgs) {
              if (hasMsgCollision(m.id)) {
                result.remappedMessageIds[m.id] = generateUniqueRemappedId('msg', takenMsgIds);
              }
            }
            for (const v of unclaimedVoices) {
              if (hasVoiceCollision(v.id)) {
                result.remappedVoiceSessionIds[v.id] = generateUniqueRemappedId('voice', takenVoiceIds);
              }
            }

            const mapProjId = (id: string) => result.remappedProjectIds[id] ?? id;
            const mapFileId = (id: string) => result.remappedFileIds[id] ?? id;
            const mapConvId = (id: string) => result.remappedConversationIds[id] ?? id;
            const mapMsgId = (id: string) => result.remappedMessageIds[id] ?? id;
            const mapVoiceId = (id: string) => result.remappedVoiceSessionIds[id] ?? id;

            // Remove stale local outbox entries only for entities owned by null
            for (const o of outboxRows) {
              if (normalizeOwnerUid(o.ownerUid) === null) {
                outboxStore.delete(o.id);
              }
            }

            for (const p of unclaimedProjects) {
              const newId = mapProjId(p.id);
              if (newId !== p.id) projectStore.delete(p.id);
              const rev = normalizeRevision(p.revision, 1);
              projectStore.put({
                ...p,
                id: newId,
                entryFileId: p.entryFileId ? mapFileId(p.entryFileId) : p.entryFileId,
                ownerUid: targetUid,
                syncStatus: 'pending',
                updatedAt: p.updatedAt || nowIso,
              });
              upsertOutboxInTx(
                outboxStore,
                buildOutboxRecord({
                  entityType: 'project',
                  entityId: newId,
                  parentId: null,
                  operation: 'upsert',
                  revision: rev,
                  baseRevision: null,
                  ownerUid: targetUid,
                  updatedAt: p.updatedAt || nowIso,
                }),
              );
              result.claimedCount += 1;
            }

            for (const f of unclaimedFiles) {
              const newId = mapFileId(f.id);
              const newProjId = mapProjId(f.projectId);
              if (newId !== f.id) fileStore.delete(f.id);
              const rev = normalizeRevision(f.revision, 1);
              fileStore.put({
                ...f,
                id: newId,
                projectId: newProjId,
                ownerUid: targetUid,
                syncStatus: 'pending',
                updatedAt: f.updatedAt || nowIso,
              });
              upsertOutboxInTx(
                outboxStore,
                buildOutboxRecord({
                  entityType: 'file',
                  entityId: newId,
                  parentId: newProjId,
                  operation: 'upsert',
                  revision: rev,
                  baseRevision: null,
                  ownerUid: targetUid,
                  updatedAt: f.updatedAt || nowIso,
                }),
              );
              result.claimedCount += 1;
            }

            for (const c of unclaimedConvs) {
              const newId = mapConvId(c.id);
              if (newId !== c.id) convStore.delete(c.id);
              const newProjId = c.projectId ? mapProjId(c.projectId) : null;
              const rev = normalizeRevision(c.revision, 1);
              convStore.put({
                ...c,
                id: newId,
                projectId: newProjId,
                voiceSessionIds: (c.voiceSessionIds ?? []).map(mapVoiceId),
                ownerUid: targetUid,
                syncStatus: 'pending',
                updatedAt: c.updatedAt || nowIso,
              });
              upsertOutboxInTx(
                outboxStore,
                buildOutboxRecord({
                  entityType: 'conversation',
                  entityId: newId,
                  parentId: newProjId,
                  operation: 'upsert',
                  revision: rev,
                  baseRevision: null,
                  ownerUid: targetUid,
                  updatedAt: c.updatedAt || nowIso,
                }),
              );
              result.claimedCount += 1;
            }

            for (const d of unclaimedDeleted) {
              const newId = mapConvId(d.id);
              if (newId !== d.id) deletedStore.delete(d.id);
              const newProjId = d.projectId ? mapProjId(d.projectId) : null;
              const rev = normalizeRevision(d.revision, 1);
              deletedStore.put({
                ...d,
                id: newId,
                projectId: newProjId,
                voiceSessionIds: (d.voiceSessionIds ?? []).map(mapVoiceId),
                messages: Array.isArray(d.messages)
                  ? d.messages.map((m) => ({
                      ...m,
                      id: mapMsgId(m.id),
                      ownerUid: targetUid,
                      syncStatus: 'pending',
                    }))
                  : [],
                ownerUid: targetUid,
                syncStatus: 'pending',
                updatedAt: d.updatedAt || nowIso,
              });
              upsertOutboxInTx(
                outboxStore,
                buildOutboxRecord({
                  entityType: 'conversation',
                  entityId: newId,
                  parentId: newProjId,
                  operation: 'upsert',
                  revision: rev,
                  baseRevision: null,
                  ownerUid: targetUid,
                  updatedAt: d.deletedAt || d.updatedAt || nowIso,
                  deletedAt: d.deletedAt || nowIso,
                }),
              );
              result.claimedCount += 1;
            }

            for (const m of unclaimedMsgs) {
              const newId = mapMsgId(m.id);
              const newConvId = mapConvId(m.conversationId);
              if (newId !== m.id) msgStore.delete(m.id);
              const rev = normalizeRevision(m.revision, 1);
              msgStore.put({
                ...m,
                id: newId,
                conversationId: newConvId,
                ownerUid: targetUid,
                syncStatus: 'pending',
                updatedAt: m.updatedAt || nowIso,
              });
              upsertOutboxInTx(
                outboxStore,
                buildOutboxRecord({
                  entityType: 'message',
                  entityId: newId,
                  parentId: newConvId,
                  operation: 'upsert',
                  revision: rev,
                  baseRevision: null,
                  ownerUid: targetUid,
                  updatedAt: m.updatedAt || nowIso,
                }),
              );
              result.claimedCount += 1;
            }

            for (const v of unclaimedVoices) {
              const newId = mapVoiceId(v.id);
              const newConvId = v.conversationId ? mapConvId(v.conversationId) : null;
              if (newId !== v.id) voiceStore.delete(v.id);
              const rev = normalizeRevision(v.revision, 1);
              voiceStore.put({
                ...v,
                id: newId,
                conversationId: newConvId,
                ownerUid: targetUid,
                syncStatus: 'pending',
                updatedAt: v.updatedAt || nowIso,
              });
              upsertOutboxInTx(
                outboxStore,
                buildOutboxRecord({
                  entityType: 'voice_session',
                  entityId: newId,
                  parentId: newConvId,
                  operation: 'upsert',
                  revision: rev,
                  baseRevision: null,
                  ownerUid: targetUid,
                  updatedAt: v.updatedAt || nowIso,
                }),
              );
              result.claimedCount += 1;
            }

            // Claim unclaimed syncable settings (device_local keys stay untouched on the device)
            const existingSettingKeys = new Set(settings.map((s) => s.key));
            for (const s of settings) {
              if (normalizeOwnerUid(s.ownerUid) !== null) continue;
              const logical = resolveSettingLogicalKey(s);
              if (!logical || !isSettingSyncable(logical)) continue;
              const targetKey = getSettingStorageKey(logical, targetUid);
              settingsStore.delete(s.key);
              if (!existingSettingKeys.has(targetKey)) {
                const rev = normalizeRevision(s.revision, 1);
                settingsStore.put({
                  ...s,
                  key: targetKey,
                  settingKey: logical,
                  ownerUid: targetUid,
                  syncStatus: 'pending',
                  syncCategory: 'account_syncable',
                });
                upsertOutboxInTx(
                  outboxStore,
                  buildOutboxRecord({
                    entityType: 'setting',
                    entityId: logical,
                    parentId: null,
                    operation: 'upsert',
                    revision: rev,
                    baseRevision: null,
                    ownerUid: targetUid,
                    updatedAt: s.updatedAt || nowIso,
                  }),
                );
                result.claimedCount += 1;
              }
            }

            // Claim unclaimed tombstones (unless remapped/overwritten)
            for (const t of tombstones) {
              if (normalizeOwnerUid(t.ownerUid) !== null) continue;
              const rev = normalizeRevision(t.revision, 1);
              tombstoneStore.put({
                ...t,
                ownerUid: targetUid,
                syncStatus: 'pending',
              });
              upsertOutboxInTx(
                outboxStore,
                buildOutboxRecord({
                  entityType: t.entityType,
                  entityId: t.entityId,
                  parentId: t.parentId ?? null,
                  operation: 'delete',
                  revision: rev,
                  baseRevision: null,
                  ownerUid: targetUid,
                  updatedAt: t.deletedAt || nowIso,
                  deletedAt: t.deletedAt || nowIso,
                }),
              );
            }
          };

          rProj.onsuccess = () => {
            projects = (rProj.result as StoredProjectRecord[]) ?? [];
            proceed();
          };
          rFile.onsuccess = () => {
            files = (rFile.result as StoredFileRecord[]) ?? [];
            proceed();
          };
          rConv.onsuccess = () => {
            convs = (rConv.result as StoredConversationRecord[]) ?? [];
            proceed();
          };
          rMsg.onsuccess = () => {
            msgs = (rMsg.result as StoredMessageRecord[]) ?? [];
            proceed();
          };
          rVoice.onsuccess = () => {
            voices = (rVoice.result as VoiceSessionRecord[]) ?? [];
            proceed();
          };
          rDel.onsuccess = () => {
            deleted = (rDel.result as Conversation[]) ?? [];
            proceed();
          };
          rSet.onsuccess = () => {
            settings = (rSet.result as StoredSettingRecord[]) ?? [];
            proceed();
          };
          rTomb.onsuccess = () => {
            tombstones = (rTomb.result as SyncTombstoneRecord[]) ?? [];
            proceed();
          };
          rOut.onsuccess = () => {
            outboxRows = (rOut.result as SyncOutboxRecord[]) ?? [];
            proceed();
          };
        },
        'Failed claiming unclaimed local workspace data.',
      );
      return result;
    } finally {
      db.close();
    }
  }

  async applyRemoteSyncChanges(input: ApplyRemoteSyncInput): Promise<WorkspaceStorageStats> {
    const targetUid = normalizeOwnerUid(input.ownerUid);
    if (!targetUid) {
      throw new Error('Cannot apply remote sync changes without a valid owner UID.');
    }
    const nowIso = input.nowIso ?? new Date().toISOString();
    const db = await openDatabase(this.dbName);
    try {
      await runWriteTransaction(
        db,
        [
          STORE_PROJECTS,
          STORE_FILES,
          STORE_CONVERSATIONS,
          STORE_MESSAGES,
          STORE_VOICE_SESSIONS,
          STORE_DELETED,
          STORE_SETTINGS,
          STORE_TOMBSTONES,
          STORE_OUTBOX,
        ],
        (tx) => {
          const projectStore = tx.objectStore(STORE_PROJECTS);
          const fileStore = tx.objectStore(STORE_FILES);
          const convStore = tx.objectStore(STORE_CONVERSATIONS);
          const msgStore = tx.objectStore(STORE_MESSAGES);
          const voiceStore = tx.objectStore(STORE_VOICE_SESSIONS);
          const deletedStore = tx.objectStore(STORE_DELETED);
          const settingsStore = tx.objectStore(STORE_SETTINGS);
          const tombstoneStore = tx.objectStore(STORE_TOMBSTONES);
          const outboxStore = tx.objectStore(STORE_OUTBOX);

          // 1. Delete remotely tombstoned entities (zero outbox echo)
          for (const fileId of input.deleteFileIds ?? []) {
            fileStore.delete(fileId);
          }
          for (const projectId of input.deleteProjectIds ?? []) {
            projectStore.delete(projectId);
          }
          for (const msgId of input.deleteMessageIds ?? []) {
            msgStore.delete(msgId);
          }
          for (const convId of input.deleteConversationIds ?? []) {
            convStore.delete(convId);
            deletedStore.delete(convId);
          }
          for (const voiceId of input.deleteVoiceSessionIds ?? []) {
            voiceStore.delete(voiceId);
          }

          // 2. Store acknowledged remote tombstones locally
          for (const tomb of input.acknowledgedTombstones ?? []) {
            tombstoneStore.put({
              ...tomb,
              ownerUid: targetUid,
              syncStatus: 'synced',
              acknowledgedAt: tomb.acknowledgedAt ?? nowIso,
            } satisfies SyncTombstoneRecord);
          }

          // 3. Apply synced remote upserts (zero outbox echo)
          for (const proj of input.upsertProjects ?? []) {
            projectStore.put(
              toStoredProjectRecord(
                { ...proj, ownerUid: targetUid, syncStatus: 'synced' },
                nowIso,
              ),
            );
            tombstoneStore.delete(createTombstoneId('project', proj.id));
          }
          for (const entry of input.upsertFiles ?? []) {
            fileStore.put(
              toStoredFileRecord(
                entry.projectId,
                { ...entry.file, ownerUid: targetUid, syncStatus: 'synced' },
                nowIso,
              ),
            );
            tombstoneStore.delete(createTombstoneId('file', entry.file.id));
          }
          for (const conv of input.upsertConversations ?? []) {
            deletedStore.delete(conv.id);
            convStore.put(
              toStoredConversationRecord(
                { ...conv, deletedAt: undefined, ownerUid: targetUid, syncStatus: 'synced' },
                nowIso,
              ),
            );
            tombstoneStore.delete(createTombstoneId('conversation', conv.id));
          }
          for (const trashed of input.upsertDeletedConversations ?? []) {
            convStore.delete(trashed.id);
            deletedStore.put({
              ...trashed,
              isSample: false,
              deletedAt: trashed.deletedAt || nowIso,
              revision: normalizeRevision(trashed.revision, 1),
              ownerUid: targetUid,
              syncStatus: 'synced',
              messages: Array.isArray(trashed.messages)
                ? trashed.messages.map((m) => ({
                    ...m,
                    ownerUid: targetUid,
                    syncStatus: 'synced',
                  }))
                : [],
            });
            tombstoneStore.delete(createTombstoneId('conversation', trashed.id));
          }
          for (const entry of input.upsertMessages ?? []) {
            msgStore.put(
              toStoredMessageRecord(
                entry.conversationId,
                entry.orderIndex,
                { ...entry.message, ownerUid: targetUid, syncStatus: 'synced' },
                nowIso,
              ),
            );
            tombstoneStore.delete(createTombstoneId('message', entry.message.id));
          }
          for (const session of input.upsertVoiceSessions ?? []) {
            voiceStore.put(
              toStoredVoiceSessionRecord(
                { ...session, ownerUid: targetUid, syncStatus: 'synced' },
                session.transcriptsSaved,
                nowIso,
              ),
            );
            tombstoneStore.delete(createTombstoneId('voice_session', session.id));
          }
          for (const setting of input.upsertSettings ?? []) {
            if (!isSettingSyncable(setting.key)) continue;
            const storageKey = getSettingStorageKey(setting.key, targetUid);
            const safeVal =
              setting.key === 'voiceSettings'
                ? { ...(setting.value as VoiceSettings), saveRawAudio: false }
                : setting.value;
            settingsStore.put({
              key: storageKey,
              settingKey: setting.key,
              value: safeVal,
              updatedAt: setting.updatedAt || nowIso,
              revision: normalizeRevision(setting.revision, 1),
              ownerUid: targetUid,
              syncStatus: 'synced',
              syncCategory: 'account_syncable',
            } satisfies StoredSettingRecord);
          }

          // 4. Write preserved conflict copies (queued into outbox so cloud stays complete)
          for (const proj of input.conflictCopyProjects ?? []) {
            const copyProj: Project = {
              ...proj,
              ownerUid: targetUid,
              syncStatus: 'pending',
            };
            projectStore.put(toStoredProjectRecord(copyProj, nowIso));
            upsertOutboxInTx(
              outboxStore,
              buildOutboxRecord({
                entityType: 'project',
                entityId: copyProj.id,
                parentId: null,
                operation: 'upsert',
                revision: normalizeRevision(copyProj.revision, 1),
                baseRevision: null,
                ownerUid: targetUid,
                updatedAt: copyProj.updatedAt || nowIso,
              }),
            );
          }
          for (const entry of input.conflictCopyFiles ?? []) {
            const copyFile: ProjectFile = {
              ...entry.file,
              ownerUid: targetUid,
              syncStatus: 'pending',
            };
            fileStore.put(toStoredFileRecord(entry.projectId, copyFile, nowIso));
            upsertOutboxInTx(
              outboxStore,
              buildOutboxRecord({
                entityType: 'file',
                entityId: copyFile.id,
                parentId: entry.projectId,
                operation: 'upsert',
                revision: normalizeRevision(copyFile.revision, 1),
                baseRevision: null,
                ownerUid: targetUid,
                updatedAt: copyFile.updatedAt || nowIso,
              }),
            );
          }
          for (const conv of input.conflictCopyConversations ?? []) {
            const copyConv: Conversation = {
              ...conv,
              ownerUid: targetUid,
              syncStatus: 'pending',
            };
            convStore.put(toStoredConversationRecord(copyConv, nowIso));
            upsertOutboxInTx(
              outboxStore,
              buildOutboxRecord({
                entityType: 'conversation',
                entityId: copyConv.id,
                parentId: copyConv.projectId,
                operation: 'upsert',
                revision: normalizeRevision(copyConv.revision, 1),
                baseRevision: null,
                ownerUid: targetUid,
                updatedAt: copyConv.updatedAt || nowIso,
              }),
            );
          }
          for (const entry of input.conflictCopyMessages ?? []) {
            const copyMsg: ChatMessage = {
              ...entry.message,
              ownerUid: targetUid,
              syncStatus: 'pending',
            };
            msgStore.put(
              toStoredMessageRecord(entry.conversationId, entry.orderIndex, copyMsg, nowIso),
            );
            upsertOutboxInTx(
              outboxStore,
              buildOutboxRecord({
                entityType: 'message',
                entityId: copyMsg.id,
                parentId: entry.conversationId,
                operation: 'upsert',
                revision: normalizeRevision(copyMsg.revision, 1),
                baseRevision: null,
                ownerUid: targetUid,
                updatedAt: copyMsg.updatedAt || copyMsg.createdAt || nowIso,
              }),
            );
          }

          // 5. Acknowledge resolved/superseded outbox operations atomically
          for (const ack of input.outboxAcks ?? []) {
            const req = outboxStore.get(ack.id);
            req.onsuccess = () => {
              const existing = req.result as SyncOutboxRecord | undefined;
              if (
                existing &&
                existing.operationId === ack.operationId &&
                recordBelongsToOwner(existing.ownerUid, targetUid)
              ) {
                outboxStore.delete(ack.id);
              }
            };
          }
        },
        'Failed applying remote sync reconciliation changes.',
      );
      return await this.getStorageStats({ activeOwnerUid: targetUid });
    } finally {
      db.close();
    }
  }

  async deleteAccountLocalData(ownerUid: string): Promise<WorkspaceStorageStats> {
    const targetUid = normalizeOwnerUid(ownerUid);
    if (!targetUid) {
      return await this.getStorageStats({ activeOwnerUid: null });
    }
    const db = await openDatabase(this.dbName);
    try {
      await runWriteTransaction(
        db,
        [
          STORE_PROJECTS,
          STORE_FILES,
          STORE_CONVERSATIONS,
          STORE_MESSAGES,
          STORE_VOICE_SESSIONS,
          STORE_DELETED,
          STORE_SETTINGS,
          STORE_TOMBSTONES,
          STORE_OUTBOX,
        ],
        (tx) => {
          const deleteMatching = <T extends { ownerUid?: string | null }>(
            storeName: string,
            getKey: (row: T) => IDBValidKey,
            extraFilter?: (row: T) => boolean,
          ) => {
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => {
              const rows = (req.result as T[]) ?? [];
              for (const row of rows) {
                if (!row || !recordBelongsToOwner(row.ownerUid, targetUid)) continue;
                if (extraFilter && !extraFilter(row)) continue;
                store.delete(getKey(row));
              }
            };
          };

          deleteMatching<StoredProjectRecord>(STORE_PROJECTS, (r) => r.id);
          deleteMatching<StoredFileRecord>(STORE_FILES, (r) => r.id);
          deleteMatching<StoredConversationRecord>(STORE_CONVERSATIONS, (r) => r.id);
          deleteMatching<StoredMessageRecord>(STORE_MESSAGES, (r) => r.id);
          deleteMatching<VoiceSessionRecord>(STORE_VOICE_SESSIONS, (r) => r.id);
          deleteMatching<Conversation>(STORE_DELETED, (r) => r.id);
          deleteMatching<SyncTombstoneRecord>(STORE_TOMBSTONES, (r) => r.id);
          deleteMatching<SyncOutboxRecord>(STORE_OUTBOX, (r) => r.id);
          deleteMatching<StoredSettingRecord>(
            STORE_SETTINGS,
            (r) => r.key,
            (r) => {
              const logical = resolveSettingLogicalKey(r);
              return Boolean(logical && isSettingSyncable(logical));
            },
          );
        },
        'Failed removing account-scoped IndexedDB data.',
      );
      return await this.getStorageStats({ activeOwnerUid: null });
    } finally {
      db.close();
    }
  }

  async clearAllData(): Promise<WorkspaceStorageStats> {
    const db = await openDatabase(this.dbName);
    try {
      await runWriteTransaction(
        db,
        [
          STORE_PROJECTS,
          STORE_FILES,
          STORE_CONVERSATIONS,
          STORE_MESSAGES,
          STORE_VOICE_SESSIONS,
          STORE_DELETED,
          STORE_SETTINGS,
          STORE_TOMBSTONES,
          STORE_OUTBOX,
        ],
        (tx) => {
          tx.objectStore(STORE_PROJECTS).clear();
          tx.objectStore(STORE_FILES).clear();
          tx.objectStore(STORE_CONVERSATIONS).clear();
          tx.objectStore(STORE_MESSAGES).clear();
          tx.objectStore(STORE_VOICE_SESSIONS).clear();
          tx.objectStore(STORE_DELETED).clear();
          tx.objectStore(STORE_SETTINGS).clear();
          tx.objectStore(STORE_TOMBSTONES).clear();
          tx.objectStore(STORE_OUTBOX).clear();
        },
        'Failed clearing local IndexedDB data.',
      );
      return await this.getStorageStats();
    } finally {
      db.close();
    }
  }
}

export const workspaceRepository: WorkspaceRepository = new IndexedDbWorkspaceRepository();

// Backwards-compatible helper exports delegating to the repository (never clearing stores on normal save)
export function requestPersistentStorage(): Promise<{ supported: boolean; persisted: boolean }> {
  return workspaceRepository.requestPersistentStorage();
}

export function getWorkspaceStorageStats(): Promise<WorkspaceStorageStats> {
  return workspaceRepository.getStorageStats();
}

export function loadWorkspaceFromIndexedDb(): Promise<PersistedWorkspaceSnapshot> {
  return workspaceRepository.loadWorkspace();
}

export function clearAllIndexedDbData(): Promise<WorkspaceStorageStats> {
  return workspaceRepository.clearAllData();
}
