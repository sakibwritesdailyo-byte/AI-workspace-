import type {
  AppSettings,
  ChatMessage,
  ClaimCollisionStrategy,
  ClaimLocalDataResult,
  Conversation,
  ModelSettings,
  OutboxDiagnostics,
  OwnershipSummary,
  Project,
  ProjectFile,
  SyncOutboxRecord,
  SyncStatus,
  SyncTombstoneRecord,
  VoiceSessionRecord,
  VoiceSettings,
  WorkspaceStorageStats,
} from '../types/workspace';
import { buildScopedOutboxId, normalizeOwnerUid } from './ownershipPolicy';
import { isSettingSyncable, type PreferenceKey, type SyncableSettingKey } from './settingsPolicy';

export interface PersistedPreferences {
  voiceSettings?: VoiceSettings;
  modelSettings?: ModelSettings;
  appSettings?: AppSettings;
  activeProjectId?: string | null;
  activeConversationId?: string | null;
  activeFileId?: string | null;
  /** Per-key revision counters for account-syncable settings (never includes device-local pointers) */
  settingRevisions?: Partial<Record<SyncableSettingKey, number>>;
}

export interface PersistedWorkspaceSnapshot {
  projects: Project[];
  conversations: Conversation[];
  deletedConversations: Conversation[];
  voiceSessions: VoiceSessionRecord[];
  preferences: PersistedPreferences;
}

export interface ChangedSettingDelta {
  key: PreferenceKey;
  value: unknown;
  syncable: boolean;
  revision: number;
  ownerUid: string | null;
}

export interface WorkspaceSnapshotDelta {
  upsertedProjects: Project[];
  deletedProjectIds: string[];
  upsertedFiles: Array<{ projectId: string; file: ProjectFile }>;
  deletedFileIds: Array<{ id: string; projectId: string }>;
  upsertedConversations: Conversation[];
  deletedConversationIds: string[];
  upsertedMessages: Array<{ conversationId: string; orderIndex: number; message: ChatMessage }>;
  deletedMessageIds: Array<{ id: string; conversationId: string }>;
  upsertedDeletedConversations: Conversation[];
  removedDeletedConversationIds: string[];
  upsertedVoiceSessions: VoiceSessionRecord[];
  deletedVoiceSessionIds: string[];
  changedSettings: ChangedSettingDelta[];
  tombstonesToPut: SyncTombstoneRecord[];
  tombstoneIdsToDelete: string[];
  outboxEntriesToPut: SyncOutboxRecord[];
  isEmpty: boolean;
}

export interface WorkspaceRepository {
  loadWorkspace(options?: { activeOwnerUid?: string | null }): Promise<PersistedWorkspaceSnapshot>;
  getStorageStats(options?: { activeOwnerUid?: string | null }): Promise<WorkspaceStorageStats>;
  requestPersistentStorage(): Promise<{ supported: boolean; persisted: boolean }>;

  createProject(project: Project): Promise<void>;
  updateProject(project: Project): Promise<void>;
  deleteProject(projectId: string, deletedFileIds?: string[]): Promise<void>;

  upsertFile(projectId: string, file: ProjectFile): Promise<void>;
  deleteFile(projectId: string, fileId: string): Promise<void>;

  createConversation(conversation: Conversation): Promise<void>;
  updateConversation(conversation: Conversation): Promise<void>;
  saveMessages(conversationId: string, messages: ChatMessage[]): Promise<void>;

  moveConversationToTrash(conversation: Conversation): Promise<void>;
  restoreDeletedConversation(conversation: Conversation): Promise<void>;
  permanentlyDeleteConversation(
    conversationId: string,
    linkedVoiceSessionIds?: string[],
  ): Promise<void>;

  saveVoiceSession(record: VoiceSessionRecord): Promise<void>;
  saveSettings(
    preferences: PersistedPreferences,
    keys?: Array<keyof PersistedPreferences>,
    options?: { ownerUid?: string | null },
  ): Promise<void>;

  commitWorkspaceDelta(
    previous: PersistedWorkspaceSnapshot | null,
    next: PersistedWorkspaceSnapshot,
    options?: { nowIso?: string; ownerUid?: string | null },
  ): Promise<WorkspaceStorageStats>;

  importWorkspaceSnapshot(
    previous: PersistedWorkspaceSnapshot,
    next: PersistedWorkspaceSnapshot,
    options?: { ownerUid?: string | null },
  ): Promise<WorkspaceStorageStats>;

  readTombstones(options?: { ownerUid?: string | null }): Promise<SyncTombstoneRecord[]>;
  readOutbox(options?: { ownerUid?: string | null }): Promise<SyncOutboxRecord[]>;
  readPendingOutbox(options?: {
    ownerUid?: string | null;
    nowIso?: string;
  }): Promise<SyncOutboxRecord[]>;
  claimOutboxOperations(options: {
    workerId: string;
    ownerUid?: string | null;
    limit?: number;
    leaseDurationMs?: number;
    nowIso?: string;
  }): Promise<SyncOutboxRecord[]>;
  recoverExpiredOutboxLeases(options?: {
    ownerUid?: string | null;
    nowIso?: string;
  }): Promise<number>;
  markOutboxOperationFailed(
    target: { id: string; operationId: string; ownerUid?: string | null },
    errorMessage: string,
    options?: {
      backoffMs?: number;
      maxRetries?: number;
      permanent?: boolean;
      nowIso?: string;
    },
  ): Promise<SyncOutboxRecord | null>;
  acknowledgeOutboxOperations(
    acks: Array<{ id: string; operationId: string }>,
    options?: { ownerUid?: string | null; nowIso?: string },
  ): Promise<{ acknowledgedIds: string[]; skippedIds: string[] }>;
  pruneAcknowledgedTombstones(
    olderThanIso: string,
    options?: { ownerUid?: string | null },
  ): Promise<number>;
  getOutboxDiagnostics(options?: {
    ownerUid?: string | null;
    nowIso?: string;
  }): Promise<OutboxDiagnostics>;
  getOwnershipSummary(activeOwnerUid?: string | null): Promise<OwnershipSummary>;
  claimUnclaimedLocalData(
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
  ): Promise<ClaimLocalDataResult>;
  applyRemoteSyncChanges(input: ApplyRemoteSyncInput): Promise<WorkspaceStorageStats>;
  deleteAccountLocalData(ownerUid: string): Promise<WorkspaceStorageStats>;
  clearAllData(): Promise<WorkspaceStorageStats>;
}

export interface ApplyRemoteSyncInput {
  ownerUid: string;
  nowIso?: string;
  upsertProjects?: Project[];
  upsertFiles?: Array<{ projectId: string; file: ProjectFile }>;
  upsertConversations?: Conversation[];
  upsertDeletedConversations?: Conversation[];
  upsertMessages?: Array<{ conversationId: string; orderIndex: number; message: ChatMessage }>;
  upsertVoiceSessions?: VoiceSessionRecord[];
  upsertSettings?: Array<{
    key: SyncableSettingKey;
    value: VoiceSettings | ModelSettings | AppSettings;
    revision: number;
    updatedAt: string;
  }>;
  deleteProjectIds?: string[];
  deleteFileIds?: string[];
  deleteConversationIds?: string[];
  deleteMessageIds?: string[];
  deleteVoiceSessionIds?: string[];
  acknowledgedTombstones?: SyncTombstoneRecord[];
  conflictCopyProjects?: Project[];
  conflictCopyFiles?: Array<{ projectId: string; file: ProjectFile }>;
  conflictCopyConversations?: Conversation[];
  conflictCopyMessages?: Array<{ conversationId: string; orderIndex: number; message: ChatMessage }>;
  outboxAcks?: Array<{ id: string; operationId: string }>;
}

const PREF_KEYS: PreferenceKey[] = [
  'voiceSettings',
  'modelSettings',
  'appSettings',
  'activeProjectId',
  'activeConversationId',
  'activeFileId',
];

export function createOutboxOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `op-${crypto.randomUUID()}`;
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildOutboxRecord(input: {
  entityType: SyncOutboxRecord['entityType'];
  entityId: string;
  parentId?: string | null;
  operation: 'upsert' | 'delete';
  revision: number;
  baseRevision: number | null;
  ownerUid?: string | null;
  createdAt?: string;
  updatedAt: string;
  deletedAt?: string | null;
}): SyncOutboxRecord {
  const ownerUid = normalizeOwnerUid(input.ownerUid);
  return {
    id: buildScopedOutboxId(ownerUid, input.entityType, input.entityId),
    operationId: createOutboxOperationId(),
    entityType: input.entityType,
    entityId: input.entityId,
    parentId: input.parentId ?? null,
    operation: input.operation,
    revision: Math.max(1, input.revision),
    baseRevision: input.baseRevision,
    ownerUid,
    createdAt: input.createdAt || input.updatedAt,
    updatedAt: input.updatedAt,
    deletedAt: input.deletedAt ?? null,
    status: 'pending',
    retryCount: 0,
    lastError: null,
    nextRetryAt: null,
    claimedAt: null,
    leaseExpiresAt: null,
    claimedBy: null,
    lastAttemptAt: null,
  };
}

function serializeValue(val: unknown): string {
  return JSON.stringify(val ?? null);
}

function projectMetadataChanged(a: Project, b: Project): boolean {
  if (a === b) return false;
  return (
    a.name !== b.name ||
    a.description !== b.description ||
    a.framework !== b.framework ||
    a.entryFileId !== b.entryFileId ||
    a.updatedAt !== b.updatedAt ||
    (a.revision ?? 1) !== (b.revision ?? 1) ||
    (a.syncStatus ?? 'local_only') !== (b.syncStatus ?? 'local_only') ||
    (a.ownerUid ?? null) !== (b.ownerUid ?? null) ||
    serializeValue(a.folders ?? []) !== serializeValue(b.folders ?? [])
  );
}

function fileChanged(a: ProjectFile, b: ProjectFile): boolean {
  if (a === b) return false;
  return (
    a.name !== b.name ||
    a.path !== b.path ||
    a.folder !== b.folder ||
    a.language !== b.language ||
    a.content !== b.content ||
    a.updatedAt !== b.updatedAt ||
    (a.revision ?? 1) !== (b.revision ?? 1) ||
    (a.syncStatus ?? 'local_only') !== (b.syncStatus ?? 'local_only')
  );
}

function conversationMetadataChanged(a: Conversation, b: Conversation): boolean {
  if (a === b) return false;
  return (
    a.title !== b.title ||
    a.kind !== b.kind ||
    a.projectId !== b.projectId ||
    a.updatedAt !== b.updatedAt ||
    a.isPinned !== b.isPinned ||
    a.durationSeconds !== b.durationSeconds ||
    a.summary !== b.summary ||
    (a.revision ?? 1) !== (b.revision ?? 1) ||
    (a.syncStatus ?? 'local_only') !== (b.syncStatus ?? 'local_only') ||
    serializeValue(a.voiceSessionIds ?? []) !== serializeValue(b.voiceSessionIds ?? [])
  );
}

function messageChanged(
  a: { orderIndex: number; message: ChatMessage },
  b: { orderIndex: number; message: ChatMessage },
): boolean {
  if (a.orderIndex !== b.orderIndex) return true;
  if (a.message === b.message) return false;
  return (
    a.message.content !== b.message.content ||
    a.message.role !== b.message.role ||
    a.message.timestamp !== b.message.timestamp ||
    (a.message.updatedAt ?? '') !== (b.message.updatedAt ?? '') ||
    (a.message.revision ?? 1) !== (b.message.revision ?? 1) ||
    a.message.source !== b.message.source ||
    a.message.language !== b.message.language
  );
}

function voiceSessionChanged(a: VoiceSessionRecord, b: VoiceSessionRecord): boolean {
  if (a === b) return false;
  return serializeValue(a) !== serializeValue(b);
}

export function createTombstoneId(entityType: SyncTombstoneRecord['entityType'], entityId: string): string {
  return `${entityType}:${entityId}`;
}

export function computeWorkspaceDelta(
  previous: PersistedWorkspaceSnapshot | null,
  next: PersistedWorkspaceSnapshot,
  options?: { nowIso?: string; ownerUid?: string | null },
): WorkspaceSnapshotDelta {
  const nowIso = options?.nowIso ?? new Date().toISOString();
  const defaultOwnerUid = normalizeOwnerUid(options?.ownerUid);

  const prevProjects = (previous?.projects ?? []).filter((p) => !p.isSample);
  const nextProjects = next.projects.filter((p) => !p.isSample);
  const prevConvs = (previous?.conversations ?? []).filter((c) => !c.isSample);
  const nextConvs = next.conversations.filter((c) => !c.isSample);
  const prevDeleted = (previous?.deletedConversations ?? []).filter((c) => !c.isSample);
  const nextDeleted = next.deletedConversations.filter((c) => !c.isSample);
  const prevVoice = previous?.voiceSessions ?? [];
  const nextVoice = next.voiceSessions ?? [];

  const upsertedProjects: Project[] = [];
  const deletedProjectIds: string[] = [];
  const upsertedFiles: Array<{ projectId: string; file: ProjectFile }> = [];
  const deletedFileIds: Array<{ id: string; projectId: string }> = [];

  const upsertedConversations: Conversation[] = [];
  const deletedConversationIds: string[] = [];
  const upsertedMessages: Array<{ conversationId: string; orderIndex: number; message: ChatMessage }> = [];
  const deletedMessageIds: Array<{ id: string; conversationId: string }> = [];

  const upsertedDeletedConversations: Conversation[] = [];
  const removedDeletedConversationIds: string[] = [];

  const upsertedVoiceSessions: VoiceSessionRecord[] = [];
  const deletedVoiceSessionIds: string[] = [];

  const tombstonesToPut: SyncTombstoneRecord[] = [];
  const tombstoneIdsToDelete: string[] = [];
  const outboxEntriesToPut: SyncOutboxRecord[] = [];

  const enqueueUpsert = (
    entityType: SyncOutboxRecord['entityType'],
    entityId: string,
    revision: number,
    baseRevision: number | null,
    updatedAt: string,
    parentId?: string | null,
    deletedAt?: string | null,
    ownerUid?: string | null,
  ) => {
    const resolvedOwner = normalizeOwnerUid(ownerUid ?? defaultOwnerUid);
    outboxEntriesToPut.push(
      buildOutboxRecord({
        entityType,
        entityId,
        parentId: parentId ?? null,
        operation: 'upsert',
        revision,
        baseRevision,
        ownerUid: resolvedOwner,
        updatedAt,
        deletedAt: deletedAt ?? null,
      }),
    );
    if (!deletedAt) {
      tombstoneIdsToDelete.push(createTombstoneId(entityType, entityId));
    }
  };

  const enqueueDelete = (
    entityType: SyncTombstoneRecord['entityType'],
    entityId: string,
    revision: number,
    baseRevision: number | null,
    parentId?: string | null,
    ownerUid?: string | null,
    syncStatus: SyncStatus = 'local_only',
  ) => {
    const resolvedOwner = normalizeOwnerUid(ownerUid ?? defaultOwnerUid);
    const tombId = createTombstoneId(entityType, entityId);
    tombstonesToPut.push({
      id: tombId,
      entityType,
      entityId,
      parentId: parentId ?? null,
      deletedAt: nowIso,
      revision,
      ownerUid: resolvedOwner,
      syncStatus,
      acknowledgedAt: null,
    });
    outboxEntriesToPut.push(
      buildOutboxRecord({
        entityType,
        entityId,
        parentId: parentId ?? null,
        operation: 'delete',
        revision,
        baseRevision,
        ownerUid: resolvedOwner,
        updatedAt: nowIso,
        deletedAt: nowIso,
      }),
    );
  };

  // --- Projects & Files ---
  const prevProjectMap = new Map(prevProjects.map((p) => [p.id, p]));
  const nextProjectMap = new Map(nextProjects.map((p) => [p.id, p]));

  const prevFileMap = new Map<string, { projectId: string; file: ProjectFile }>();
  for (const proj of prevProjects) {
    for (const file of proj.files) {
      if (!prevFileMap.has(file.id)) {
        prevFileMap.set(file.id, { projectId: proj.id, file });
      }
    }
  }

  const nextFileMap = new Map<string, { projectId: string; file: ProjectFile }>();
  for (const proj of nextProjects) {
    const prevProj = prevProjectMap.get(proj.id);
    if (!prevProj || projectMetadataChanged(prevProj, proj)) {
      upsertedProjects.push(proj);
      enqueueUpsert(
        'project',
        proj.id,
        proj.revision ?? 1,
        prevProj ? (prevProj.revision ?? 1) : null,
        proj.updatedAt || nowIso,
        null,
        null,
        proj.ownerUid ?? defaultOwnerUid,
      );
    }
    for (const file of proj.files) {
      if (!nextFileMap.has(file.id)) {
        nextFileMap.set(file.id, { projectId: proj.id, file });
      }
      const prevEntry = prevFileMap.get(file.id);
      if (!prevEntry || prevEntry.projectId !== proj.id || fileChanged(prevEntry.file, file)) {
        upsertedFiles.push({ projectId: proj.id, file });
        enqueueUpsert(
          'file',
          file.id,
          file.revision ?? 1,
          prevEntry ? (prevEntry.file.revision ?? 1) : null,
          file.updatedAt || nowIso,
          proj.id,
          null,
          file.ownerUid ?? proj.ownerUid ?? defaultOwnerUid,
        );
      }
    }
  }

  for (const [fileId, prevEntry] of prevFileMap.entries()) {
    if (!nextFileMap.has(fileId)) {
      const prevRev = prevEntry.file.revision ?? 1;
      deletedFileIds.push({ id: fileId, projectId: prevEntry.projectId });
      enqueueDelete(
        'file',
        fileId,
        prevRev + 1,
        prevRev,
        prevEntry.projectId,
        prevEntry.file.ownerUid ?? defaultOwnerUid,
        prevEntry.file.syncStatus ?? 'local_only',
      );
    }
  }

  for (const [projectId, prevProj] of prevProjectMap.entries()) {
    if (!nextProjectMap.has(projectId)) {
      const prevRev = prevProj.revision ?? 1;
      deletedProjectIds.push(projectId);
      enqueueDelete(
        'project',
        projectId,
        prevRev + 1,
        prevRev,
        null,
        prevProj.ownerUid ?? defaultOwnerUid,
        prevProj.syncStatus ?? 'local_only',
      );
    }
  }

  // --- Conversations, Messages, and Trash ---
  const prevConvMap = new Map(prevConvs.map((c) => [c.id, c]));
  const nextConvMap = new Map(nextConvs.map((c) => [c.id, c]));
  const prevDeletedMap = new Map(prevDeleted.map((c) => [c.id, c]));
  const nextDeletedMap = new Map(nextDeleted.map((c) => [c.id, c]));

  const prevMsgMap = new Map<string, { conversationId: string; orderIndex: number; message: ChatMessage }>();
  for (const conv of prevConvs) {
    conv.messages.forEach((message, orderIndex) => {
      if (!prevMsgMap.has(message.id)) {
        prevMsgMap.set(message.id, { conversationId: conv.id, orderIndex, message });
      }
    });
  }

  const nextMsgMap = new Map<string, { conversationId: string; orderIndex: number; message: ChatMessage }>();
  for (const conv of nextConvs) {
    const prevConv = prevConvMap.get(conv.id);
    if (!prevConv || conversationMetadataChanged(prevConv, conv)) {
      upsertedConversations.push(conv);
      enqueueUpsert(
        'conversation',
        conv.id,
        conv.revision ?? 1,
        prevConv ? (prevConv.revision ?? 1) : null,
        conv.updatedAt || nowIso,
        conv.projectId,
        null,
        conv.ownerUid ?? defaultOwnerUid,
      );
    }
    conv.messages.forEach((message, orderIndex) => {
      const nextEntry = { conversationId: conv.id, orderIndex, message };
      if (!nextMsgMap.has(message.id)) {
        nextMsgMap.set(message.id, nextEntry);
      }
      const prevEntry = prevMsgMap.get(message.id);
      if (!prevEntry || prevEntry.conversationId !== conv.id || messageChanged(prevEntry, nextEntry)) {
        upsertedMessages.push(nextEntry);
        enqueueUpsert(
          'message',
          message.id,
          message.revision ?? 1,
          prevEntry ? (prevEntry.message.revision ?? 1) : null,
          message.updatedAt || message.createdAt || conv.updatedAt || nowIso,
          conv.id,
          null,
          message.ownerUid ?? conv.ownerUid ?? defaultOwnerUid,
        );
      }
    });
  }

  // Active messages removed: create tombstones only if their parent conversation was NOT merely soft-deleted to trash
  for (const [msgId, prevEntry] of prevMsgMap.entries()) {
    if (!nextMsgMap.has(msgId)) {
      deletedMessageIds.push({ id: msgId, conversationId: prevEntry.conversationId });
      const movedToTrash = nextDeletedMap.has(prevEntry.conversationId);
      if (!movedToTrash) {
        const prevRev = prevEntry.message.revision ?? 1;
        enqueueDelete(
          'message',
          msgId,
          prevRev + 1,
          prevRev,
          prevEntry.conversationId,
          prevEntry.message.ownerUid ?? defaultOwnerUid,
          prevEntry.message.syncStatus ?? 'local_only',
        );
      }
    }
  }

  // Active conversations removed (either moved to trash or permanently deleted)
  for (const [convId, prevConv] of prevConvMap.entries()) {
    if (!nextConvMap.has(convId)) {
      deletedConversationIds.push(convId);
      if (!nextDeletedMap.has(convId)) {
        const prevRev = prevConv.revision ?? 1;
        enqueueDelete(
          'conversation',
          convId,
          prevRev + 1,
          prevRev,
          prevConv.projectId,
          prevConv.ownerUid ?? defaultOwnerUid,
          prevConv.syncStatus ?? 'local_only',
        );
      }
    }
  }

  // Trashed conversations upserts
  for (const trashed of nextDeleted) {
    const prevTrashed = prevDeletedMap.get(trashed.id);
    if (!prevTrashed || serializeValue(prevTrashed) !== serializeValue(trashed)) {
      upsertedDeletedConversations.push(trashed);
      enqueueUpsert(
        'conversation',
        trashed.id,
        trashed.revision ?? 1,
        prevTrashed ? (prevTrashed.revision ?? 1) : null,
        trashed.deletedAt || trashed.updatedAt || nowIso,
        trashed.projectId,
        trashed.deletedAt || nowIso,
        trashed.ownerUid ?? defaultOwnerUid,
      );
    }
  }

  // Trashed conversations removed (either restored to active or permanently deleted)
  for (const [trashedId, prevTrashed] of prevDeletedMap.entries()) {
    if (!nextDeletedMap.has(trashedId)) {
      removedDeletedConversationIds.push(trashedId);
      if (!nextConvMap.has(trashedId)) {
        const prevRev = prevTrashed.revision ?? 1;
        enqueueDelete(
          'conversation',
          trashedId,
          prevRev + 1,
          prevRev,
          prevTrashed.projectId,
          prevTrashed.ownerUid ?? defaultOwnerUid,
          prevTrashed.syncStatus ?? 'local_only',
        );
        for (const msg of prevTrashed.messages) {
          const prevMsgRev = msg.revision ?? 1;
          enqueueDelete(
            'message',
            msg.id,
            prevMsgRev + 1,
            prevMsgRev,
            trashedId,
            msg.ownerUid ?? prevTrashed.ownerUid ?? defaultOwnerUid,
            msg.syncStatus ?? prevTrashed.syncStatus ?? 'local_only',
          );
        }
      }
    }
  }

  // --- Voice Sessions ---
  const prevVoiceMap = new Map(prevVoice.map((v) => [v.id, v]));
  const nextVoiceMap = new Map(nextVoice.map((v) => [v.id, v]));

  for (const session of nextVoice) {
    const prevSession = prevVoiceMap.get(session.id);
    if (!prevSession || voiceSessionChanged(prevSession, session)) {
      upsertedVoiceSessions.push(session);
      enqueueUpsert(
        'voice_session',
        session.id,
        session.revision ?? 1,
        prevSession ? (prevSession.revision ?? 1) : null,
        session.updatedAt || session.endedAt || session.startedAt || nowIso,
        session.conversationId,
        null,
        session.ownerUid ?? defaultOwnerUid,
      );
    }
  }

  for (const [sessionId, prevSession] of prevVoiceMap.entries()) {
    if (!nextVoiceMap.has(sessionId)) {
      const prevRev = prevSession.revision ?? 1;
      deletedVoiceSessionIds.push(sessionId);
      enqueueDelete(
        'voice_session',
        sessionId,
        prevRev + 1,
        prevRev,
        prevSession.conversationId,
        prevSession.ownerUid ?? defaultOwnerUid,
        prevSession.syncStatus ?? 'local_only',
      );
    }
  }

  // --- Settings (explicit sync policy: device_local pointers vs account_syncable preferences) ---
  const changedSettings: ChangedSettingDelta[] = [];
  for (const key of PREF_KEYS) {
    const nextRaw = next.preferences[key];
    if (nextRaw === undefined) continue;
    const nextVal =
      key === 'voiceSettings' && typeof nextRaw === 'object' && nextRaw !== null
        ? { ...(nextRaw as VoiceSettings), saveRawAudio: false }
        : nextRaw;
    const prevVal = previous?.preferences[key];
    if (!previous || serializeValue(prevVal) !== serializeValue(nextVal)) {
      const syncable = isSettingSyncable(key);
      const prevRev = syncable
        ? (previous?.preferences.settingRevisions?.[key] ?? 0)
        : 0;
      const nextRev = syncable
        ? Math.max(
            next.preferences.settingRevisions?.[key] ?? 0,
            previous ? prevRev + 1 : 1,
          )
        : 1;
      changedSettings.push({
        key,
        value: nextVal,
        syncable,
        revision: nextRev,
        ownerUid: defaultOwnerUid,
      });
      // Only account_syncable settings enqueue an outbox sync operation; device_local pointers never do
      if (syncable) {
        enqueueUpsert(
          'setting',
          key,
          nextRev,
          previous && prevRev > 0 ? prevRev : null,
          nowIso,
          null,
          null,
          defaultOwnerUid,
        );
      }
    }
  }

  const isEmpty =
    upsertedProjects.length === 0 &&
    deletedProjectIds.length === 0 &&
    upsertedFiles.length === 0 &&
    deletedFileIds.length === 0 &&
    upsertedConversations.length === 0 &&
    deletedConversationIds.length === 0 &&
    upsertedMessages.length === 0 &&
    deletedMessageIds.length === 0 &&
    upsertedDeletedConversations.length === 0 &&
    removedDeletedConversationIds.length === 0 &&
    upsertedVoiceSessions.length === 0 &&
    deletedVoiceSessionIds.length === 0 &&
    changedSettings.length === 0;

  return {
    upsertedProjects,
    deletedProjectIds,
    upsertedFiles,
    deletedFileIds,
    upsertedConversations,
    deletedConversationIds,
    upsertedMessages,
    deletedMessageIds,
    upsertedDeletedConversations,
    removedDeletedConversationIds,
    upsertedVoiceSessions,
    deletedVoiceSessionIds,
    changedSettings,
    tombstonesToPut,
    tombstoneIdsToDelete,
    outboxEntriesToPut,
    isEmpty,
  };
}
