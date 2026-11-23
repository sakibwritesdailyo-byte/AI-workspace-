import { generateStableId, normalizeFolderPath } from '../../state/workspaceReducer';
import type {
  AppSettings,
  ChatMessage,
  CloudSyncConflict,
  Conversation,
  ModelSettings,
  Project,
  ProjectFile,
  SyncOutboxRecord,
  SyncTombstoneRecord,
  VoiceSessionRecord,
  VoiceSettings,
} from '../../types/workspace';
import type { SyncableSettingKey } from '../settingsPolicy';
import type {
  ApplyRemoteSyncInput,
  PersistedWorkspaceSnapshot,
} from '../workspaceRepository';

export interface RemoteSettingRecord {
  key: SyncableSettingKey;
  value: VoiceSettings | ModelSettings | AppSettings;
  revision: number;
  updatedAt: string;
}

export interface RemoteWorkspaceSnapshot {
  projects: Project[];
  files: Array<{ projectId: string; file: ProjectFile }>;
  conversations: Conversation[];
  messages: Array<{ conversationId: string; orderIndex: number; message: ChatMessage }>;
  voiceSessions: VoiceSessionRecord[];
  settings: RemoteSettingRecord[];
  tombstones: SyncTombstoneRecord[];
}

export interface ReconciliationResult {
  applyInput: ApplyRemoteSyncInput;
  conflicts: CloudSyncConflict[];
  hasChanges: boolean;
}

function stableJson(val: unknown): string {
  return JSON.stringify(val ?? null);
}

function makeConflictCopyFilename(
  originalName: string,
  folder: string,
  takenPathsLower: Set<string>,
): { name: string; path: string } {
  const dotIdx = originalName.lastIndexOf('.');
  const stem = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  const ext = dotIdx > 0 ? originalName.slice(dotIdx) : '';
  const normFolder = normalizeFolderPath(folder);

  let attempt = 0;
  while (attempt < 100) {
    const suffix = attempt === 0 ? '.conflict-copy' : `.conflict-copy-${attempt + 1}`;
    const candidateName = `${stem}${suffix}${ext}`;
    const candidatePath = `${normFolder}/${candidateName}`;
    if (!takenPathsLower.has(candidatePath.toLowerCase())) {
      takenPathsLower.add(candidatePath.toLowerCase());
      return { name: candidateName, path: candidatePath };
    }
    attempt += 1;
  }
  const fallbackName = `${stem}.conflict-${Date.now()}${ext}`;
  const fallbackPath = `${normFolder}/${fallbackName}`;
  takenPathsLower.add(fallbackPath.toLowerCase());
  return { name: fallbackName, path: fallbackPath };
}

function pickNewerTimestamp(a?: string | null, b?: string | null): number {
  const ta = a ? Date.parse(a) : 0;
  const tb = b ? Date.parse(b) : 0;
  if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
  if (!Number.isFinite(ta)) return -1;
  if (!Number.isFinite(tb)) return 1;
  return ta === tb ? 0 : ta > tb ? 1 : -1;
}

export function reconcileCloudAndLocalWorkspace(input: {
  ownerUid: string;
  localSnapshot: PersistedWorkspaceSnapshot;
  localOutbox: SyncOutboxRecord[];
  localTombstones: SyncTombstoneRecord[];
  remote: RemoteWorkspaceSnapshot;
  nowIso?: string;
}): ReconciliationResult {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const { ownerUid, localSnapshot, localOutbox, localTombstones, remote } = input;

  const outboxByEntity = new Map<string, SyncOutboxRecord>();
  for (const row of localOutbox) {
    outboxByEntity.set(`${row.entityType}:${row.entityId}`, row);
  }

  const localTombstoneMap = new Map<string, SyncTombstoneRecord>();
  for (const t of localTombstones) {
    localTombstoneMap.set(`${t.entityType}:${t.entityId}`, t);
  }

  const remoteTombstoneMap = new Map<string, SyncTombstoneRecord>();
  for (const t of remote.tombstones) {
    remoteTombstoneMap.set(`${t.entityType}:${t.entityId}`, t);
  }

  const conflicts: CloudSyncConflict[] = [];
  const upsertProjects: Project[] = [];
  const upsertFiles: Array<{ projectId: string; file: ProjectFile }> = [];
  const upsertConversations: Conversation[] = [];
  const upsertDeletedConversations: Conversation[] = [];
  const upsertMessages: Array<{ conversationId: string; orderIndex: number; message: ChatMessage }> =
    [];
  const upsertVoiceSessions: VoiceSessionRecord[] = [];
  const upsertSettings: RemoteSettingRecord[] = [];

  const deleteProjectIds: string[] = [];
  const deleteFileIds: string[] = [];
  const deleteConversationIds: string[] = [];
  const deleteMessageIds: string[] = [];
  const deleteVoiceSessionIds: string[] = [];
  const acknowledgedTombstones: SyncTombstoneRecord[] = [];

  const conflictCopyProjects: Project[] = [];
  const conflictCopyFiles: Array<{ projectId: string; file: ProjectFile }> = [];
  const conflictCopyConversations: Conversation[] = [];
  const conflictCopyMessages: Array<{
    conversationId: string;
    orderIndex: number;
    message: ChatMessage;
  }> = [];

  const outboxAcks: Array<{ id: string; operationId: string }> = [];

  // Index local entities
  const localProjectMap = new Map(localSnapshot.projects.map((p) => [p.id, p]));
  const localFileMap = new Map<string, { projectId: string; file: ProjectFile }>();
  const filePathsByProject = new Map<string, Set<string>>();

  for (const p of localSnapshot.projects) {
    const pathSet = new Set<string>();
    for (const f of p.files) {
      localFileMap.set(f.id, { projectId: p.id, file: f });
      pathSet.add(`${normalizeFolderPath(f.folder)}/${f.name}`.toLowerCase());
    }
    filePathsByProject.set(p.id, pathSet);
  }
  for (const entry of remote.files) {
    let set = filePathsByProject.get(entry.projectId);
    if (!set) {
      set = new Set<string>();
      filePathsByProject.set(entry.projectId, set);
    }
    set.add(`${normalizeFolderPath(entry.file.folder)}/${entry.file.name}`.toLowerCase());
  }

  const localActiveConvMap = new Map(localSnapshot.conversations.map((c) => [c.id, c]));
  const localDeletedConvMap = new Map(localSnapshot.deletedConversations.map((c) => [c.id, c]));
  const localMsgMap = new Map<string, { conversationId: string; message: ChatMessage }>();
  for (const c of localSnapshot.conversations) {
    for (const m of c.messages) {
      localMsgMap.set(m.id, { conversationId: c.id, message: m });
    }
  }
  const localVoiceMap = new Map(localSnapshot.voiceSessions.map((v) => [v.id, v]));

  // Remote lookup maps
  const remoteProjectMap = new Map(remote.projects.map((p) => [p.id, p]));
  const remoteFileMap = new Map(remote.files.map((e) => [e.file.id, e]));
  const remoteConvMap = new Map(remote.conversations.map((c) => [c.id, c]));
  const remoteMessagesByConv = new Map<
    string,
    Array<{ conversationId: string; orderIndex: number; message: ChatMessage }>
  >();
  for (const entry of remote.messages) {
    const list = remoteMessagesByConv.get(entry.conversationId) ?? [];
    list.push(entry);
    remoteMessagesByConv.set(entry.conversationId, list);
  }
  const remoteMsgMap = new Map(remote.messages.map((m) => [m.message.id, m]));
  const remoteVoiceMap = new Map(remote.voiceSessions.map((v) => [v.id, v]));

  // Track projects preserved as copies when remote deleted original
  const preservedProjectIds = new Set<string>();

  // --- 1. Reconcile Projects ---
  for (const remoteProj of remote.projects) {
    const localProj = localProjectMap.get(remoteProj.id);
    const outbox = outboxByEntity.get(`project:${remoteProj.id}`);

    if (outbox?.operation === 'delete') {
      const baseRev = outbox.baseRevision ?? outbox.revision;
      if ((remoteProj.revision ?? 1) > baseRev) {
        // Remote moved ahead after our delete base: preserve remote to avoid silent loss
        upsertProjects.push({ ...remoteProj, ownerUid, syncStatus: 'synced' });
        outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
        conflicts.push({
          id: `conflict-proj-${remoteProj.id}-${nowIso}`,
          entityType: 'project',
          entityId: remoteProj.id,
          title: remoteProj.name,
          reason: 'delete_vs_edit',
          resolution: 'remote_kept',
          localRevision: outbox.revision,
          remoteRevision: remoteProj.revision ?? 1,
          localUpdatedAt: outbox.updatedAt,
          remoteUpdatedAt: remoteProj.updatedAt,
          detectedAt: nowIso,
        });
      }
      continue;
    }

    if (!localProj) {
      upsertProjects.push({ ...remoteProj, ownerUid, syncStatus: 'synced' });
      continue;
    }

    const sameMeta =
      localProj.name === remoteProj.name &&
      localProj.description === remoteProj.description &&
      localProj.framework === remoteProj.framework &&
      localProj.entryFileId === remoteProj.entryFileId &&
      stableJson(localProj.folders ?? []) === stableJson(remoteProj.folders ?? []);

    if (!outbox) {
      if (!sameMeta || (remoteProj.revision ?? 1) > (localProj.revision ?? 1)) {
        upsertProjects.push({ ...remoteProj, ownerUid, syncStatus: 'synced' });
      }
      continue;
    }

    // Pending local upsert
    if (sameMeta) {
      if ((remoteProj.revision ?? 1) >= (localProj.revision ?? 1)) {
        upsertProjects.push({ ...remoteProj, ownerUid, syncStatus: 'synced' });
        outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      }
      continue;
    }

    const baseRev = outbox.baseRevision ?? 0;
    if (baseRev >= (remoteProj.revision ?? 1)) {
      // Fast-forward local edit; keep pending outbox for push
      continue;
    }

    // Concurrent project metadata conflict: apply remote & preserve local metadata/files copy
    upsertProjects.push({ ...remoteProj, ownerUid, syncStatus: 'synced' });
    outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });

    const copyProjId = generateStableId('proj');
    let copyEntryId = '';
    const copiedFiles: ProjectFile[] = localProj.files.map((lf) => {
      const nfId = generateStableId('file');
      if (lf.id === localProj.entryFileId) copyEntryId = nfId;
      return {
        ...lf,
        id: nfId,
        revision: 1,
        ownerUid,
        syncStatus: 'pending',
        updatedAt: nowIso,
      };
    });
    const copyProj: Project = {
      ...localProj,
      id: copyProjId,
      name: `${localProj.name} (Conflict Copy)`,
      revision: 1,
      ownerUid,
      syncStatus: 'pending',
      entryFileId: copyEntryId || copiedFiles[0]?.id || '',
      files: copiedFiles,
      updatedAt: nowIso,
    };
    conflictCopyProjects.push(copyProj);
    for (const cf of copiedFiles) {
      conflictCopyFiles.push({ projectId: copyProjId, file: cf });
    }
    conflicts.push({
      id: `conflict-proj-${remoteProj.id}-${nowIso}`,
      entityType: 'project',
      entityId: remoteProj.id,
      title: remoteProj.name,
      reason: 'concurrent_edit',
      resolution: 'preserved_both',
      localRevision: localProj.revision ?? 1,
      remoteRevision: remoteProj.revision ?? 1,
      localUpdatedAt: localProj.updatedAt,
      remoteUpdatedAt: remoteProj.updatedAt,
      preservedCopyId: copyProjId,
      preservedCopyLabel: copyProj.name,
      detectedAt: nowIso,
    });
  }

  // Remote project tombstones
  for (const tomb of remote.tombstones) {
    if (tomb.entityType !== 'project') continue;
    const localProj = localProjectMap.get(tomb.entityId);
    const outbox = outboxByEntity.get(`project:${tomb.entityId}`);

    if (!localProj) {
      acknowledgedTombstones.push({ ...tomb, ownerUid, syncStatus: 'synced', acknowledgedAt: nowIso });
      if (outbox?.operation === 'delete') {
        outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      }
      continue;
    }

    const hasPendingLocalChanges =
      outbox?.operation === 'upsert' ||
      localProj.files.some((f) => outboxByEntity.get(`file:${f.id}`)?.operation === 'upsert');

    if (hasPendingLocalChanges) {
      // Preserve local edited project as restored copy, remove deleted ID
      const restoredProjId = generateStableId('proj');
      let restoredEntryId = '';
      const restoredFiles = localProj.files.map((lf) => {
        const nfId = generateStableId('file');
        if (lf.id === localProj.entryFileId) restoredEntryId = nfId;
        const fOutbox = outboxByEntity.get(`file:${lf.id}`);
        if (fOutbox) outboxAcks.push({ id: fOutbox.id, operationId: fOutbox.operationId });
        return {
          ...lf,
          id: nfId,
          revision: 1,
          ownerUid,
          syncStatus: 'pending' as const,
          updatedAt: nowIso,
        };
      });
      const restoredProj: Project = {
        ...localProj,
        id: restoredProjId,
        name: `${localProj.name} (Restored Copy)`,
        revision: 1,
        ownerUid,
        syncStatus: 'pending',
        entryFileId: restoredEntryId || restoredFiles[0]?.id || '',
        files: restoredFiles,
        updatedAt: nowIso,
      };
      preservedProjectIds.add(tomb.entityId);
      conflictCopyProjects.push(restoredProj);
      for (const rf of restoredFiles) {
        conflictCopyFiles.push({ projectId: restoredProjId, file: rf });
      }
      if (outbox) outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      conflicts.push({
        id: `conflict-proj-del-${tomb.entityId}-${nowIso}`,
        entityType: 'project',
        entityId: tomb.entityId,
        title: localProj.name,
        reason: 'delete_vs_edit',
        resolution: 'preserved_both',
        localRevision: localProj.revision ?? 1,
        remoteRevision: tomb.revision,
        localUpdatedAt: localProj.updatedAt,
        remoteUpdatedAt: tomb.deletedAt,
        preservedCopyId: restoredProjId,
        preservedCopyLabel: restoredProj.name,
        detectedAt: nowIso,
      });
    }

    deleteProjectIds.push(tomb.entityId);
    for (const lf of localProj.files) {
      deleteFileIds.push(lf.id);
    }
    acknowledgedTombstones.push({ ...tomb, ownerUid, syncStatus: 'synced', acknowledgedAt: nowIso });
  }

  // --- 2. Reconcile Files ---
  for (const remoteEntry of remote.files) {
    const { projectId, file: remoteFile } = remoteEntry;
    const localEntry = localFileMap.get(remoteFile.id);
    const outbox = outboxByEntity.get(`file:${remoteFile.id}`);

    if (outbox?.operation === 'delete') {
      const baseRev = outbox.baseRevision ?? outbox.revision;
      if ((remoteFile.revision ?? 1) > baseRev) {
        upsertFiles.push({ projectId, file: { ...remoteFile, ownerUid, syncStatus: 'synced' } });
        outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
        conflicts.push({
          id: `conflict-file-${remoteFile.id}-${nowIso}`,
          entityType: 'file',
          entityId: remoteFile.id,
          title: remoteFile.path,
          reason: 'delete_vs_edit',
          resolution: 'remote_kept',
          localRevision: outbox.revision,
          remoteRevision: remoteFile.revision ?? 1,
          localUpdatedAt: outbox.updatedAt,
          remoteUpdatedAt: remoteFile.updatedAt,
          detectedAt: nowIso,
        });
      }
      continue;
    }

    if (!localEntry) {
      upsertFiles.push({ projectId, file: { ...remoteFile, ownerUid, syncStatus: 'synced' } });
      continue;
    }

    const sameFile =
      localEntry.projectId === projectId &&
      localEntry.file.name === remoteFile.name &&
      localEntry.file.path === remoteFile.path &&
      localEntry.file.folder === remoteFile.folder &&
      localEntry.file.language === remoteFile.language &&
      localEntry.file.content === remoteFile.content;

    if (!outbox) {
      if (!sameFile || (remoteFile.revision ?? 1) > (localEntry.file.revision ?? 1)) {
        upsertFiles.push({ projectId, file: { ...remoteFile, ownerUid, syncStatus: 'synced' } });
      }
      continue;
    }

    if (sameFile) {
      if ((remoteFile.revision ?? 1) >= (localEntry.file.revision ?? 1)) {
        upsertFiles.push({ projectId, file: { ...remoteFile, ownerUid, syncStatus: 'synced' } });
        outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      }
      continue;
    }

    const baseRev = outbox.baseRevision ?? 0;
    if (baseRev >= (remoteFile.revision ?? 1)) {
      continue;
    }

    // Concurrent file edit conflict: preserve both safely inside project
    upsertFiles.push({ projectId, file: { ...remoteFile, ownerUid, syncStatus: 'synced' } });
    outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });

    let takenPaths = filePathsByProject.get(projectId);
    if (!takenPaths) {
      takenPaths = new Set<string>();
      filePathsByProject.set(projectId, takenPaths);
    }
    const copyPathInfo = makeConflictCopyFilename(
      localEntry.file.name,
      localEntry.file.folder,
      takenPaths,
    );
    const copyFileId = generateStableId('file');
    const copyFile: ProjectFile = {
      ...localEntry.file,
      id: copyFileId,
      name: copyPathInfo.name,
      path: copyPathInfo.path,
      revision: 1,
      ownerUid,
      syncStatus: 'pending',
      updatedAt: nowIso,
    };
    conflictCopyFiles.push({ projectId, file: copyFile });
    conflicts.push({
      id: `conflict-file-${remoteFile.id}-${nowIso}`,
      entityType: 'file',
      entityId: remoteFile.id,
      title: remoteFile.path,
      reason: 'concurrent_edit',
      resolution: 'preserved_both',
      localRevision: localEntry.file.revision ?? 1,
      remoteRevision: remoteFile.revision ?? 1,
      localUpdatedAt: localEntry.file.updatedAt,
      remoteUpdatedAt: remoteFile.updatedAt,
      preservedCopyId: copyFileId,
      preservedCopyLabel: copyPathInfo.path,
      detectedAt: nowIso,
    });
  }

  // Remote file tombstones (skip files already handled inside preserved deleted project)
  for (const tomb of remote.tombstones) {
    if (tomb.entityType !== 'file') continue;
    const localEntry = localFileMap.get(tomb.entityId);
    const outbox = outboxByEntity.get(`file:${tomb.entityId}`);

    if (!localEntry || (tomb.parentId && preservedProjectIds.has(tomb.parentId))) {
      acknowledgedTombstones.push({ ...tomb, ownerUid, syncStatus: 'synced', acknowledgedAt: nowIso });
      if (outbox?.operation === 'delete') {
        outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      }
      continue;
    }

    const parentDeleted =
      tomb.parentId && remoteTombstoneMap.has(`project:${tomb.parentId}`);
    if (outbox?.operation === 'upsert' && !parentDeleted) {
      let takenPaths = filePathsByProject.get(localEntry.projectId);
      if (!takenPaths) {
        takenPaths = new Set<string>();
        filePathsByProject.set(localEntry.projectId, takenPaths);
      }
      const copyPathInfo = makeConflictCopyFilename(
        localEntry.file.name,
        localEntry.file.folder,
        takenPaths,
      );
      const copyFileId = generateStableId('file');
      const copyFile: ProjectFile = {
        ...localEntry.file,
        id: copyFileId,
        name: copyPathInfo.name,
        path: copyPathInfo.path,
        revision: 1,
        ownerUid,
        syncStatus: 'pending',
        updatedAt: nowIso,
      };
      conflictCopyFiles.push({ projectId: localEntry.projectId, file: copyFile });
      outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      conflicts.push({
        id: `conflict-file-del-${tomb.entityId}-${nowIso}`,
        entityType: 'file',
        entityId: tomb.entityId,
        title: localEntry.file.path,
        reason: 'delete_vs_edit',
        resolution: 'preserved_both',
        localRevision: localEntry.file.revision ?? 1,
        remoteRevision: tomb.revision,
        localUpdatedAt: localEntry.file.updatedAt,
        remoteUpdatedAt: tomb.deletedAt,
        preservedCopyId: copyFileId,
        preservedCopyLabel: copyPathInfo.path,
        detectedAt: nowIso,
      });
    }

    deleteFileIds.push(tomb.entityId);
    acknowledgedTombstones.push({ ...tomb, ownerUid, syncStatus: 'synced', acknowledgedAt: nowIso });
  }

  // --- 3. Reconcile Conversations (active & soft-deleted trash) ---
  for (const remoteConv of remote.conversations) {
    const localConv = localActiveConvMap.get(remoteConv.id) ?? localDeletedConvMap.get(remoteConv.id);
    const outbox = outboxByEntity.get(`conversation:${remoteConv.id}`);
    const attachedRemoteMsgs = (remoteMessagesByConv.get(remoteConv.id) ?? [])
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((m) => ({ ...m.message, ownerUid, syncStatus: 'synced' as const }));

    const pushRemoteConv = (conv: Conversation) => {
      if (conv.deleted || conv.deletedAt) {
        upsertDeletedConversations.push({
          ...conv,
          deleted: true,
          ownerUid,
          syncStatus: 'synced',
          messages: attachedRemoteMsgs.length > 0 ? attachedRemoteMsgs : conv.messages ?? [],
        });
      } else {
        upsertConversations.push({
          ...conv,
          deleted: false,
          deletedAt: undefined,
          ownerUid,
          syncStatus: 'synced',
        });
      }
    };

    if (outbox?.operation === 'delete') {
      // A permanent local delete wins unless the remote entity has a later timestamp.
      if (pickNewerTimestamp(remoteConv.updatedAt, outbox.updatedAt) > 0) {
        pushRemoteConv(remoteConv);
        outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      }
      continue;
    }

    if (!localConv) {
      pushRemoteConv(remoteConv);
      continue;
    }

    const localIsDeleted = Boolean(localConv.deleted || localConv.deletedAt);
    const remoteIsDeleted = Boolean(remoteConv.deleted || remoteConv.deletedAt);
    if (localIsDeleted || remoteIsDeleted) {
      // Deletion state is reconciled by Last Write Wins; never fork a deleted conversation.
      const timestampOrder = pickNewerTimestamp(localConv.updatedAt, remoteConv.updatedAt);
      const localWins = timestampOrder > 0 || (timestampOrder === 0 && localIsDeleted);
      if (!localWins) {
        pushRemoteConv(remoteConv);
        if (outbox) outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      }
      continue;
    }

    const sameConv =
      localConv.title === remoteConv.title &&
      localConv.kind === remoteConv.kind &&
      (localConv.projectId ?? null) === (remoteConv.projectId ?? null) &&
      Boolean(localConv.isPinned) === Boolean(remoteConv.isPinned) &&
      (localConv.summary ?? '') === (remoteConv.summary ?? '') &&
      (localConv.deletedAt ?? null) === (remoteConv.deletedAt ?? null);

    if (!outbox) {
      if (!sameConv || (remoteConv.revision ?? 1) > (localConv.revision ?? 1)) {
        pushRemoteConv(remoteConv);
      }
      continue;
    }

    if (sameConv) {
      if ((remoteConv.revision ?? 1) >= (localConv.revision ?? 1)) {
        pushRemoteConv(remoteConv);
        outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      }
      continue;
    }

    const baseRev = outbox.baseRevision ?? 0;
    if (baseRev >= (remoteConv.revision ?? 1)) {
      continue;
    }

    // Concurrent conversation conflict: keep remote & preserve local metadata+messages as Conflict Copy
    pushRemoteConv(remoteConv);
    outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });

    const copyConvId = generateStableId('conv');
    const copyConv: Conversation = {
      ...localConv,
      id: copyConvId,
      title: `${localConv.title} (Conflict Copy)`,
      deletedAt: undefined,
      revision: 1,
      ownerUid,
      syncStatus: 'pending',
      updatedAt: nowIso,
      messages: [],
    };
    conflictCopyConversations.push(copyConv);
    localConv.messages.forEach((m, index) => {
      conflictCopyMessages.push({
        conversationId: copyConvId,
        orderIndex: index,
        message: {
          ...m,
          id: generateStableId('msg'),
          revision: 1,
          ownerUid,
          syncStatus: 'pending',
          updatedAt: nowIso,
        },
      });
    });
    conflicts.push({
      id: `conflict-conv-${remoteConv.id}-${nowIso}`,
      entityType: 'conversation',
      entityId: remoteConv.id,
      title: remoteConv.title,
      reason: 'concurrent_edit',
      resolution: 'preserved_both',
      localRevision: localConv.revision ?? 1,
      remoteRevision: remoteConv.revision ?? 1,
      localUpdatedAt: localConv.updatedAt,
      remoteUpdatedAt: remoteConv.updatedAt,
      preservedCopyId: copyConvId,
      preservedCopyLabel: copyConv.title,
      detectedAt: nowIso,
    });
  }

  // Remote conversation tombstones
  for (const tomb of remote.tombstones) {
    if (tomb.entityType !== 'conversation') continue;
    const localConv = localActiveConvMap.get(tomb.entityId) ?? localDeletedConvMap.get(tomb.entityId);
    const outbox = outboxByEntity.get(`conversation:${tomb.entityId}`);

    if (!localConv) {
      acknowledgedTombstones.push({ ...tomb, ownerUid, syncStatus: 'synced', acknowledgedAt: nowIso });
      if (outbox?.operation === 'delete') {
        outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      }
      continue;
    }

    // A remote tombstone is authoritative: discard local state without making a restored copy.
    if (outbox) outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
    for (const message of localConv.messages) {
      const messageOutbox = outboxByEntity.get(`message:${message.id}`);
      if (messageOutbox) outboxAcks.push({ id: messageOutbox.id, operationId: messageOutbox.operationId });
    }

    deleteConversationIds.push(tomb.entityId);
    for (const m of localConv.messages) {
      deleteMessageIds.push(m.id);
    }
    acknowledgedTombstones.push({ ...tomb, ownerUid, syncStatus: 'synced', acknowledgedAt: nowIso });
  }

  // --- 4. Reconcile Messages (for active conversations) ---
  for (const remoteEntry of remote.messages) {
    const parentRemoteConv = remoteConvMap.get(remoteEntry.conversationId);
    if (parentRemoteConv?.deleted || parentRemoteConv?.deletedAt) {
      // Soft-deleted conversation messages belong inside upsertDeletedConversations, not active msgStore
      continue;
    }
    const localEntry = localMsgMap.get(remoteEntry.message.id);
    const outbox = outboxByEntity.get(`message:${remoteEntry.message.id}`);

    if (outbox?.operation === 'delete') {
      const baseRev = outbox.baseRevision ?? outbox.revision;
      if ((remoteEntry.message.revision ?? 1) > baseRev) {
        upsertMessages.push({
          ...remoteEntry,
          message: { ...remoteEntry.message, ownerUid, syncStatus: 'synced' },
        });
        outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      }
      continue;
    }

    if (!localEntry) {
      upsertMessages.push({
        ...remoteEntry,
        message: { ...remoteEntry.message, ownerUid, syncStatus: 'synced' },
      });
      continue;
    }

    const sameMsg =
      localEntry.conversationId === remoteEntry.conversationId &&
      localEntry.message.content === remoteEntry.message.content &&
      localEntry.message.role === remoteEntry.message.role;

    if (!outbox) {
      if (!sameMsg || (remoteEntry.message.revision ?? 1) > (localEntry.message.revision ?? 1)) {
        upsertMessages.push({
          ...remoteEntry,
          message: { ...remoteEntry.message, ownerUid, syncStatus: 'synced' },
        });
      }
      continue;
    }

    if (sameMsg) {
      if ((remoteEntry.message.revision ?? 1) >= (localEntry.message.revision ?? 1)) {
        upsertMessages.push({
          ...remoteEntry,
          message: { ...remoteEntry.message, ownerUid, syncStatus: 'synced' },
        });
        outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      }
      continue;
    }

    const baseRev = outbox.baseRevision ?? 0;
    if (baseRev >= (remoteEntry.message.revision ?? 1)) {
      continue;
    }

    // Message content conflict on identical ID: apply remote & preserve local as sibling message
    upsertMessages.push({
      ...remoteEntry,
      message: { ...remoteEntry.message, ownerUid, syncStatus: 'synced' },
    });
    outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
    const copyMsgId = generateStableId('msg');
    conflictCopyMessages.push({
      conversationId: remoteEntry.conversationId,
      orderIndex: remoteEntry.orderIndex + 1,
      message: {
        ...localEntry.message,
        id: copyMsgId,
        revision: 1,
        ownerUid,
        syncStatus: 'pending',
        updatedAt: nowIso,
      },
    });
    conflicts.push({
      id: `conflict-msg-${remoteEntry.message.id}-${nowIso}`,
      entityType: 'message',
      entityId: remoteEntry.message.id,
      title: 'Conversation message',
      reason: 'concurrent_edit',
      resolution: 'preserved_both',
      localRevision: localEntry.message.revision ?? 1,
      remoteRevision: remoteEntry.message.revision ?? 1,
      localUpdatedAt: localEntry.message.updatedAt ?? localEntry.message.createdAt ?? null,
      remoteUpdatedAt: remoteEntry.message.updatedAt ?? remoteEntry.message.createdAt ?? null,
      preservedCopyId: copyMsgId,
      detectedAt: nowIso,
    });
  }

  for (const tomb of remote.tombstones) {
    if (tomb.entityType !== 'message') continue;
    const localEntry = localMsgMap.get(tomb.entityId);
    const outbox = outboxByEntity.get(`message:${tomb.entityId}`);
    if (!localEntry) {
      acknowledgedTombstones.push({ ...tomb, ownerUid, syncStatus: 'synced', acknowledgedAt: nowIso });
      if (outbox?.operation === 'delete') {
        outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      }
      continue;
    }
    deleteMessageIds.push(tomb.entityId);
    acknowledgedTombstones.push({ ...tomb, ownerUid, syncStatus: 'synced', acknowledgedAt: nowIso });
  }

  // --- 5. Reconcile Voice Sessions ---
  for (const remoteVoice of remote.voiceSessions) {
    const localVoice = localVoiceMap.get(remoteVoice.id);
    const outbox = outboxByEntity.get(`voice_session:${remoteVoice.id}`);
    if (outbox?.operation === 'delete') {
      continue;
    }
    if (!localVoice || (!outbox && (remoteVoice.revision ?? 1) >= (localVoice.revision ?? 1))) {
      upsertVoiceSessions.push({
        ...remoteVoice,
        rawAudioStored: false,
        ownerUid,
        syncStatus: 'synced',
      });
    } else if (outbox && (remoteVoice.revision ?? 1) >= (localVoice.revision ?? 1)) {
      if (stableJson(localVoice.transcripts) === stableJson(remoteVoice.transcripts)) {
        upsertVoiceSessions.push({
          ...remoteVoice,
          rawAudioStored: false,
          ownerUid,
          syncStatus: 'synced',
        });
        outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      }
    }
  }

  for (const tomb of remote.tombstones) {
    if (tomb.entityType !== 'voice_session') continue;
    deleteVoiceSessionIds.push(tomb.entityId);
    acknowledgedTombstones.push({ ...tomb, ownerUid, syncStatus: 'synced', acknowledgedAt: nowIso });
    const outbox = outboxByEntity.get(`voice_session:${tomb.entityId}`);
    if (outbox?.operation === 'delete') {
      outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
    }
  }

  // --- 6. Reconcile Account-Syncable Settings (device_local pointers are NEVER included) ---
  for (const remoteSetting of remote.settings) {
    const outbox = outboxByEntity.get(`setting:${remoteSetting.key}`);
    const localRev = localSnapshot.preferences.settingRevisions?.[remoteSetting.key] ?? 0;
    const localVal = localSnapshot.preferences[remoteSetting.key];

    if (!outbox) {
      if (
        remoteSetting.revision > localRev ||
        (localRev === 0 && stableJson(localVal) !== stableJson(remoteSetting.value))
      ) {
        upsertSettings.push(remoteSetting);
      }
      continue;
    }

    if (stableJson(localVal) === stableJson(remoteSetting.value)) {
      upsertSettings.push(remoteSetting);
      outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      continue;
    }

    const baseRev = outbox.baseRevision ?? 0;
    if (baseRev >= remoteSetting.revision) {
      // Local setting moved ahead cleanly -> keep local & push
      continue;
    }

    // Concurrent setting divergence: deterministic winner by revision then timestamp
    const remoteWins =
      remoteSetting.revision > outbox.revision ||
      (remoteSetting.revision === outbox.revision &&
        pickNewerTimestamp(remoteSetting.updatedAt, outbox.updatedAt) > 0);

    if (remoteWins) {
      upsertSettings.push(remoteSetting);
      outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      conflicts.push({
        id: `conflict-setting-${remoteSetting.key}-${nowIso}`,
        entityType: 'setting',
        entityId: remoteSetting.key,
        title: remoteSetting.key,
        reason: 'setting_divergence',
        resolution: 'remote_kept',
        localRevision: outbox.revision,
        remoteRevision: remoteSetting.revision,
        localUpdatedAt: outbox.updatedAt,
        remoteUpdatedAt: remoteSetting.updatedAt,
        detectedAt: nowIso,
      });
    } else {
      conflicts.push({
        id: `conflict-setting-${remoteSetting.key}-${nowIso}`,
        entityType: 'setting',
        entityId: remoteSetting.key,
        title: remoteSetting.key,
        reason: 'setting_divergence',
        resolution: 'local_kept',
        localRevision: outbox.revision,
        remoteRevision: remoteSetting.revision,
        localUpdatedAt: outbox.updatedAt,
        remoteUpdatedAt: remoteSetting.updatedAt,
        detectedAt: nowIso,
      });
    }
  }

  // Acknowledge local delete tombstones already absent in remote
  for (const localTomb of localTombstoneMap.values()) {
    if (localTomb.acknowledgedAt) continue;
    const outbox = outboxByEntity.get(`${localTomb.entityType}:${localTomb.entityId}`);
    if (outbox?.operation !== 'delete') continue;
    const existsRemotely =
      (localTomb.entityType === 'project' && remoteProjectMap.has(localTomb.entityId)) ||
      (localTomb.entityType === 'file' && remoteFileMap.has(localTomb.entityId)) ||
      (localTomb.entityType === 'conversation' && remoteConvMap.has(localTomb.entityId)) ||
      (localTomb.entityType === 'message' && remoteMsgMap.has(localTomb.entityId)) ||
      (localTomb.entityType === 'voice_session' && remoteVoiceMap.has(localTomb.entityId));

    if (!existsRemotely && remoteTombstoneMap.has(`${localTomb.entityType}:${localTomb.entityId}`)) {
      outboxAcks.push({ id: outbox.id, operationId: outbox.operationId });
      acknowledgedTombstones.push({
        ...localTomb,
        ownerUid,
        syncStatus: 'synced',
        acknowledgedAt: nowIso,
      });
    }
  }

  const applyInput: ApplyRemoteSyncInput = {
    ownerUid,
    nowIso,
    upsertProjects,
    upsertFiles,
    upsertConversations,
    upsertDeletedConversations,
    upsertMessages,
    upsertVoiceSessions,
    upsertSettings,
    deleteProjectIds,
    deleteFileIds,
    deleteConversationIds,
    deleteMessageIds,
    deleteVoiceSessionIds,
    acknowledgedTombstones,
    conflictCopyProjects,
    conflictCopyFiles,
    conflictCopyConversations,
    conflictCopyMessages,
    outboxAcks,
  };

  const hasChanges =
    upsertProjects.length > 0 ||
    upsertFiles.length > 0 ||
    upsertConversations.length > 0 ||
    upsertDeletedConversations.length > 0 ||
    upsertMessages.length > 0 ||
    upsertVoiceSessions.length > 0 ||
    upsertSettings.length > 0 ||
    deleteProjectIds.length > 0 ||
    deleteFileIds.length > 0 ||
    deleteConversationIds.length > 0 ||
    deleteMessageIds.length > 0 ||
    deleteVoiceSessionIds.length > 0 ||
    conflictCopyProjects.length > 0 ||
    conflictCopyFiles.length > 0 ||
    conflictCopyConversations.length > 0 ||
    conflictCopyMessages.length > 0 ||
    outboxAcks.length > 0;

  return { applyInput, conflicts, hasChanges };
}
