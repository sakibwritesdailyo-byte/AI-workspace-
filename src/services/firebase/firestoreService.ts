import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type {
  AppSettings,
  AuthUserProfile,
  ChatMessage,
  Conversation,
  ModelSettings,
  Project,
  ProjectFile,
  SyncEntityType,
  SyncTombstoneRecord,
  VoiceSessionRecord,
  VoiceSettings,
} from '../../types/workspace';
import {
  sanitizeAppSettings,
  sanitizeModelSettings,
  sanitizeVoiceSettings,
} from '../backupService';
import { isSettingSyncable, type PreferenceKey, type SyncableSettingKey } from '../settingsPolicy';
import { createTombstoneId } from '../workspaceRepository';
import { getFirebaseServices, type FirebaseServiceHandles } from './firebaseConfig';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';
import type { RemoteSettingRecord, RemoteWorkspaceSnapshot } from './conflictResolution';

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

function assertValidFirestoreId(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128 || !VALID_ID_REGEX.test(trimmed)) {
    throw new Error(`Invalid Firestore ${label} ID "${value}".`);
  }
  return trimmed;
}

function clampString(value: unknown, maxLen: number, fallback = ''): string {
  const str = typeof value === 'string' ? value : fallback;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function clampIso(value: unknown, fallbackIso: string): string {
  const s = clampString(value, 64, fallbackIso).trim();
  return s || fallbackIso;
}

function normalizeInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function toFirestoreTombstoneDocId(entityType: SyncEntityType, entityId: string): string {
  return assertValidFirestoreId(`${entityType}__${entityId}`, 'tombstone');
}

export function serializeProjectForFirestore(
  uid: string,
  project: Project,
  nowIso = new Date().toISOString(),
) {
  const safeId = assertValidFirestoreId(project.id, 'project');
  const safeOwner = assertValidFirestoreId(uid, 'ownerUid');
  const createdAt = clampIso(project.createdAt, nowIso);
  const updatedAt = clampIso(project.updatedAt, createdAt);
  const folders = Array.isArray(project.folders)
    ? project.folders
        .filter((f): f is string => typeof f === 'string' && f.length > 0)
        .slice(0, 200)
        .map((f) => clampString(f, 255))
    : [];

  return {
    createData: {
      id: safeId,
      ownerUid: safeOwner,
      name: clampString(project.name || 'Untitled Project', 200, 'Untitled Project'),
      description: clampString(project.description ?? '', 2000),
      framework: clampString(project.framework || 'HTML · CSS · JS', 120, 'HTML · CSS · JS'),
      entryFileId: clampString(project.entryFileId ?? '', 128),
      folders,
      revision: normalizeInt(project.revision, 1, 10_000_000, 1),
      syncStatus: 'synced' as const,
      createdAt,
      updatedAt,
      deletedAt: project.deletedAt ? clampIso(project.deletedAt, updatedAt) : null,
    },
    updatePatch: {
      name: clampString(project.name || 'Untitled Project', 200, 'Untitled Project'),
      description: clampString(project.description ?? '', 2000),
      framework: clampString(project.framework || 'HTML · CSS · JS', 120, 'HTML · CSS · JS'),
      entryFileId: clampString(project.entryFileId ?? '', 128),
      folders,
      revision: normalizeInt(project.revision, 1, 10_000_000, 1),
      syncStatus: 'synced' as const,
      updatedAt,
      deletedAt: project.deletedAt ? clampIso(project.deletedAt, updatedAt) : null,
    },
  };
}

export function serializeFileForFirestore(
  uid: string,
  projectId: string,
  file: ProjectFile,
  nowIso = new Date().toISOString(),
) {
  const safeId = assertValidFirestoreId(file.id, 'file');
  const safeProjectId = assertValidFirestoreId(projectId, 'projectId');
  const safeOwner = assertValidFirestoreId(uid, 'ownerUid');
  const updatedAt = clampIso(file.updatedAt, nowIso);
  const createdAt = clampIso(file.createdAt, updatedAt);

  const safeContent = clampString(file.content ?? '', 750_000);
  return {
    createData: {
      id: safeId,
      projectId: safeProjectId,
      ownerUid: safeOwner,
      name: clampString(file.name || 'file.txt', 255, 'file.txt'),
      path: clampString(file.path || `${file.folder || 'src'}/${file.name || 'file.txt'}`, 512),
      folder: clampString(file.folder ?? 'src', 255),
      language: file.language,
      content: safeContent,
      revision: normalizeInt(file.revision, 1, 10_000_000, 1),
      syncStatus: 'synced' as const,
      createdAt,
      updatedAt,
      deletedAt: file.deletedAt ? clampIso(file.deletedAt, updatedAt) : null,
    },
    updatePatch: {
      projectId: safeProjectId,
      name: clampString(file.name || 'file.txt', 255, 'file.txt'),
      path: clampString(file.path || `${file.folder || 'src'}/${file.name || 'file.txt'}`, 512),
      folder: clampString(file.folder ?? 'src', 255),
      language: file.language,
      content: safeContent,
      revision: normalizeInt(file.revision, 1, 10_000_000, 1),
      syncStatus: 'synced' as const,
      updatedAt,
      deletedAt: file.deletedAt ? clampIso(file.deletedAt, updatedAt) : null,
    },
  };
}

export function serializeConversationForFirestore(
  uid: string,
  conv: Conversation,
  nowIso = new Date().toISOString(),
) {
  const safeId = assertValidFirestoreId(conv.id, 'conversation');
  const safeOwner = assertValidFirestoreId(uid, 'ownerUid');
  const createdAt = clampIso(conv.createdAt, nowIso);
  const updatedAt = clampIso(conv.updatedAt, createdAt);
  const safeProjectId = conv.projectId ? assertValidFirestoreId(conv.projectId, 'projectId') : null;
  const voiceSessionIds = Array.isArray(conv.voiceSessionIds)
    ? conv.voiceSessionIds
        .filter((v): v is string => typeof v === 'string' && VALID_ID_REGEX.test(v))
        .slice(0, 200)
    : [];

  return {
    createData: {
      id: safeId,
      ownerUid: safeOwner,
      title: clampString(conv.title || 'Untitled Conversation', 300, 'Untitled Conversation'),
      kind: conv.kind === 'voice' ? ('voice' as const) : ('chat' as const),
      projectId: safeProjectId,
      isPinned: Boolean(conv.isPinned),
      summary: clampString(conv.summary ?? '', 2000),
      durationSeconds:
        typeof conv.durationSeconds === 'number'
          ? normalizeInt(conv.durationSeconds, 0, 86_400, 0)
          : null,
      voiceSessionIds,
      deletedAt: conv.deletedAt ? clampIso(conv.deletedAt, updatedAt) : null,
      revision: normalizeInt(conv.revision, 1, 10_000_000, 1),
      syncStatus: 'synced' as const,
      createdAt,
      updatedAt,
    },
    updatePatch: {
      title: clampString(conv.title || 'Untitled Conversation', 300, 'Untitled Conversation'),
      kind: conv.kind === 'voice' ? ('voice' as const) : ('chat' as const),
      projectId: safeProjectId,
      isPinned: Boolean(conv.isPinned),
      summary: clampString(conv.summary ?? '', 2000),
      durationSeconds:
        typeof conv.durationSeconds === 'number'
          ? normalizeInt(conv.durationSeconds, 0, 86_400, 0)
          : null,
      voiceSessionIds,
      deletedAt: conv.deletedAt ? clampIso(conv.deletedAt, updatedAt) : null,
      revision: normalizeInt(conv.revision, 1, 10_000_000, 1),
      syncStatus: 'synced' as const,
      updatedAt,
    },
  };
}

export function serializeMessageForFirestore(
  uid: string,
  conversationId: string,
  orderIndex: number,
  msg: ChatMessage,
  nowIso = new Date().toISOString(),
) {
  const safeId = assertValidFirestoreId(msg.id, 'message');
  const safeConvId = assertValidFirestoreId(conversationId, 'conversationId');
  const safeOwner = assertValidFirestoreId(uid, 'ownerUid');
  const createdAt = clampIso(msg.createdAt, nowIso);
  const updatedAt = clampIso(msg.updatedAt, createdAt);

  return {
    createData: {
      id: safeId,
      conversationId: safeConvId,
      ownerUid: safeOwner,
      orderIndex: normalizeInt(orderIndex, 0, 100_000, 0),
      role: msg.role,
      content: clampString(msg.content ?? '', 120_000),
      timestamp: clampString(msg.timestamp ?? '', 32),
      source: msg.source === 'voice' ? ('voice' as const) : ('text' as const),
      language: msg.language ?? null,
      deletedAt: msg.deletedAt ? clampIso(msg.deletedAt, updatedAt) : null,
      revision: normalizeInt(msg.revision, 1, 10_000_000, 1),
      syncStatus: 'synced' as const,
      createdAt,
      updatedAt,
    },
    updatePatch: {
      conversationId: safeConvId,
      orderIndex: normalizeInt(orderIndex, 0, 100_000, 0),
      role: msg.role,
      content: clampString(msg.content ?? '', 120_000),
      timestamp: clampString(msg.timestamp ?? '', 32),
      source: msg.source === 'voice' ? ('voice' as const) : ('text' as const),
      language: msg.language ?? null,
      deletedAt: msg.deletedAt ? clampIso(msg.deletedAt, updatedAt) : null,
      revision: normalizeInt(msg.revision, 1, 10_000_000, 1),
      syncStatus: 'synced' as const,
      updatedAt,
    },
  };
}

export function serializeVoiceSessionForFirestore(
  uid: string,
  session: VoiceSessionRecord,
  nowIso = new Date().toISOString(),
) {
  const safeId = assertValidFirestoreId(session.id, 'voiceSession');
  const safeOwner = assertValidFirestoreId(uid, 'ownerUid');
  const startedAt = clampIso(session.startedAt, nowIso);
  const createdAt = clampIso(session.createdAt, startedAt);
  const updatedAt = clampIso(session.updatedAt || session.endedAt, createdAt);
  const safeConvId = session.conversationId
    ? assertValidFirestoreId(session.conversationId, 'conversationId')
    : null;
  const safeTranscripts = Array.isArray(session.transcripts)
    ? session.transcripts.slice(0, 500).map((t) => ({
        id: clampString(t.id, 128),
        speaker: t.speaker === 'assistant' ? 'assistant' : 'user',
        text: clampString(t.text, 4000),
        timestamp: clampString(t.timestamp, 32),
      }))
    : [];

  return {
    createData: {
      id: safeId,
      ownerUid: safeOwner,
      conversationId: safeConvId,
      model: clampString(session.model || '', 120),
      languageMode: session.languageMode,
      status: clampString(session.status, 40),
      micPermission: clampString(session.micPermission, 40),
      startedAt,
      endedAt: session.endedAt ? clampIso(session.endedAt, updatedAt) : null,
      durationSeconds: normalizeInt(session.durationSeconds, 0, 86_400, 0),
      errorMessage: session.errorMessage ? clampString(session.errorMessage, 1000) : null,
      transcriptsSaved: Boolean(session.transcriptsSaved && safeTranscripts.length > 0),
      transcripts: safeTranscripts,
      rawAudioStored: false as const,
      deletedAt: session.deletedAt ? clampIso(session.deletedAt, updatedAt) : null,
      revision: normalizeInt(session.revision, 1, 10_000_000, 1),
      syncStatus: 'synced' as const,
      createdAt,
      updatedAt,
    },
    updatePatch: {
      conversationId: safeConvId,
      model: clampString(session.model || '', 120),
      languageMode: session.languageMode,
      status: clampString(session.status, 40),
      micPermission: clampString(session.micPermission, 40),
      startedAt,
      endedAt: session.endedAt ? clampIso(session.endedAt, updatedAt) : null,
      durationSeconds: normalizeInt(session.durationSeconds, 0, 86_400, 0),
      errorMessage: session.errorMessage ? clampString(session.errorMessage, 1000) : null,
      transcriptsSaved: Boolean(session.transcriptsSaved && safeTranscripts.length > 0),
      transcripts: safeTranscripts,
      rawAudioStored: false as const,
      deletedAt: session.deletedAt ? clampIso(session.deletedAt, updatedAt) : null,
      revision: normalizeInt(session.revision, 1, 10_000_000, 1),
      syncStatus: 'synced' as const,
      updatedAt,
    },
  };
}

export function serializePreferenceForFirestore(
  uid: string,
  settingKey: PreferenceKey,
  value: VoiceSettings | ModelSettings | AppSettings,
  revision: number,
  updatedAt: string,
) {
  if (!isSettingSyncable(settingKey)) {
    throw new Error(`Refusing to upload device_local preference "${settingKey}" to Firestore.`);
  }
  const safeOwner = assertValidFirestoreId(uid, 'ownerUid');
  const sanitizedValue =
    settingKey === 'voiceSettings'
      ? sanitizeVoiceSettings(value)
      : settingKey === 'modelSettings'
        ? sanitizeModelSettings(value)
        : sanitizeAppSettings(value);

  return {
    createData: {
      settingKey,
      ownerUid: safeOwner,
      revision: normalizeInt(revision, 1, 10_000_000, 1),
      syncStatus: 'synced' as const,
      value: sanitizedValue,
      updatedAt: clampIso(updatedAt, new Date().toISOString()),
    },
    updatePatch: {
      revision: normalizeInt(revision, 1, 10_000_000, 1),
      syncStatus: 'synced' as const,
      value: sanitizedValue,
      updatedAt: clampIso(updatedAt, new Date().toISOString()),
    },
  };
}

function requireFirestore(): { db: Firestore; auth: FirebaseServiceHandles['auth'] } {
  const services = getFirebaseServices();
  if (!services) {
    throw new Error('Firebase services are not initialized.');
  }
  return { db: services.db, auth: services.auth };
}

export interface UpsertDocResult {
  conflictDetected: boolean;
  remoteRevision?: number;
}

async function upsertDocSafely(
  path: string,
  createData: Record<string, unknown>,
  updatePatch: Record<string, unknown>,
  options?: { expectedBaseRevision?: number | null },
): Promise<UpsertDocResult> {
  const { db, auth } = requireFirestore();
  const ref = doc(db, path);
  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        ...createData,
        serverCreatedAt: serverTimestamp(),
        serverUpdatedAt: serverTimestamp(),
      });
      return { conflictDetected: false };
    }

    const existingData = existingSnap.data() as { revision?: number };
    const remoteRev = typeof existingData.revision === 'number' ? existingData.revision : 1;
    if (
      options?.expectedBaseRevision !== undefined &&
      options.expectedBaseRevision !== null &&
      remoteRev > options.expectedBaseRevision
    ) {
      return { conflictDetected: true, remoteRevision: remoteRev };
    }

    await updateDoc(ref, {
      ...updatePatch,
      serverUpdatedAt: serverTimestamp(),
    });
    return { conflictDetected: false };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path, auth);
  }
}

export const firestoreService = {
  async ensureUserProfile(user: AuthUserProfile): Promise<void> {
    const uid = assertValidFirestoreId(user.uid, 'uid');
    const path = `users/${uid}`;
    const nowIso = new Date().toISOString();
    await upsertDocSafely(
      path,
      {
        uid,
        email: user.email ? clampString(user.email, 320) : null,
        displayName: user.displayName ? clampString(user.displayName, 120) : null,
        photoURL: user.photoURL ? clampString(user.photoURL, 1024) : null,
        schemaVersion: 4,
        createdAt: nowIso,
        updatedAt: nowIso,
        lastSyncAt: nowIso,
      },
      {
        email: user.email ? clampString(user.email, 320) : null,
        displayName: user.displayName ? clampString(user.displayName, 120) : null,
        photoURL: user.photoURL ? clampString(user.photoURL, 1024) : null,
        schemaVersion: 4,
        updatedAt: nowIso,
        lastSyncAt: nowIso,
      },
    );
  },

  async updateSyncMeta(uid: string, patch: { lastPushAt?: string; lastPullAt?: string }): Promise<void> {
    const safeUid = assertValidFirestoreId(uid, 'uid');
    const path = `users/${safeUid}/syncMeta/state`;
    await upsertDocSafely(
      path,
      {
        ownerUid: safeUid,
        schemaVersion: 4,
        lastPushAt: patch.lastPushAt ?? null,
        lastPullAt: patch.lastPullAt ?? null,
      },
      {
        schemaVersion: 4,
        ...(patch.lastPushAt ? { lastPushAt: patch.lastPushAt } : {}),
        ...(patch.lastPullAt ? { lastPullAt: patch.lastPullAt } : {}),
      },
    );
  },

  async upsertProject(
    uid: string,
    project: Project,
    options?: { expectedBaseRevision?: number | null },
  ): Promise<UpsertDocResult> {
    const safeUid = assertValidFirestoreId(uid, 'uid');
    const { createData, updatePatch } = serializeProjectForFirestore(safeUid, project);
    return await upsertDocSafely(
      `users/${safeUid}/projects/${createData.id}`,
      createData,
      updatePatch,
      options,
    );
  },

  async upsertFile(
    uid: string,
    projectId: string,
    file: ProjectFile,
    options?: { expectedBaseRevision?: number | null; ensureParentProject?: Project | null },
  ): Promise<UpsertDocResult> {
    const safeUid = assertValidFirestoreId(uid, 'uid');
    const { db, auth } = requireFirestore();
    const { createData, updatePatch } = serializeFileForFirestore(safeUid, projectId, file);
    const filePath = `users/${safeUid}/files/${createData.id}`;
    const projectPath = `users/${safeUid}/projects/${createData.projectId}`;

    try {
      const parentSnap = await getDoc(doc(db, projectPath));
      if (!parentSnap.exists()) {
        if (!options?.ensureParentProject) {
          throw new Error(`Parent project "${projectId}" does not exist in cloud storage.`);
        }
        const projSerialized = serializeProjectForFirestore(safeUid, options.ensureParentProject);
        const batch = writeBatch(db);
        batch.set(doc(db, projectPath), {
          ...projSerialized.createData,
          serverCreatedAt: serverTimestamp(),
          serverUpdatedAt: serverTimestamp(),
        });
        batch.set(doc(db, filePath), {
          ...createData,
          serverCreatedAt: serverTimestamp(),
          serverUpdatedAt: serverTimestamp(),
        });
        await batch.commit();
        return { conflictDetected: false };
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, filePath, auth);
    }

    return await upsertDocSafely(filePath, createData, updatePatch, options);
  },

  async upsertConversation(
    uid: string,
    conversation: Conversation,
    options?: { expectedBaseRevision?: number | null },
  ): Promise<UpsertDocResult> {
    const safeUid = assertValidFirestoreId(uid, 'uid');
    const { createData, updatePatch } = serializeConversationForFirestore(safeUid, conversation);
    return await upsertDocSafely(
      `users/${safeUid}/conversations/${createData.id}`,
      createData,
      updatePatch,
      options,
    );
  },

  async upsertMessage(
    uid: string,
    conversationId: string,
    orderIndex: number,
    message: ChatMessage,
    options?: {
      expectedBaseRevision?: number | null;
      ensureParentConversation?: Conversation | null;
    },
  ): Promise<UpsertDocResult> {
    const safeUid = assertValidFirestoreId(uid, 'uid');
    const { db, auth } = requireFirestore();
    const { createData, updatePatch } = serializeMessageForFirestore(
      safeUid,
      conversationId,
      orderIndex,
      message,
    );
    const msgPath = `users/${safeUid}/messages/${createData.id}`;
    const convPath = `users/${safeUid}/conversations/${createData.conversationId}`;

    try {
      const parentSnap = await getDoc(doc(db, convPath));
      if (!parentSnap.exists()) {
        if (!options?.ensureParentConversation) {
          throw new Error(`Parent conversation "${conversationId}" does not exist in cloud storage.`);
        }
        const convSerialized = serializeConversationForFirestore(
          safeUid,
          options.ensureParentConversation,
        );
        const batch = writeBatch(db);
        batch.set(doc(db, convPath), {
          ...convSerialized.createData,
          serverCreatedAt: serverTimestamp(),
          serverUpdatedAt: serverTimestamp(),
        });
        batch.set(doc(db, msgPath), {
          ...createData,
          serverCreatedAt: serverTimestamp(),
          serverUpdatedAt: serverTimestamp(),
        });
        await batch.commit();
        return { conflictDetected: false };
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, msgPath, auth);
    }

    return await upsertDocSafely(msgPath, createData, updatePatch, options);
  },

  async upsertVoiceSession(
    uid: string,
    session: VoiceSessionRecord,
    options?: { expectedBaseRevision?: number | null },
  ): Promise<UpsertDocResult> {
    const safeUid = assertValidFirestoreId(uid, 'uid');
    const { createData, updatePatch } = serializeVoiceSessionForFirestore(safeUid, session);
    return await upsertDocSafely(
      `users/${safeUid}/voiceSessions/${createData.id}`,
      createData,
      updatePatch,
      options,
    );
  },

  async upsertPreference(
    uid: string,
    settingKey: PreferenceKey,
    value: VoiceSettings | ModelSettings | AppSettings,
    revision: number,
    updatedAt: string,
    options?: { expectedBaseRevision?: number | null },
  ): Promise<UpsertDocResult> {
    const safeUid = assertValidFirestoreId(uid, 'uid');
    const { createData, updatePatch } = serializePreferenceForFirestore(
      safeUid,
      settingKey,
      value,
      revision,
      updatedAt,
    );
    return await upsertDocSafely(
      `users/${safeUid}/preferences/${createData.settingKey}`,
      createData,
      updatePatch,
      options,
    );
  },

  async deleteEntityWithTombstone(
    uid: string,
    input: {
      entityType: SyncEntityType;
      entityId: string;
      parentId?: string | null;
      revision: number;
      deletedAt: string;
    },
  ): Promise<void> {
    const safeUid = assertValidFirestoreId(uid, 'uid');
    const safeEntityId = assertValidFirestoreId(input.entityId, input.entityType);
    const { db, auth } = requireFirestore();

    const collectionMap: Record<SyncEntityType, string> = {
      project: 'projects',
      file: 'files',
      conversation: 'conversations',
      message: 'messages',
      voice_session: 'voiceSessions',
      setting: 'preferences',
    };
    const colName = collectionMap[input.entityType];
    const entityPath = `users/${safeUid}/${colName}/${safeEntityId}`;
    const tombDocId = toFirestoreTombstoneDocId(input.entityType, safeEntityId);
    const tombPath = `users/${safeUid}/tombstones/${tombDocId}`;

    try {
      const tombRef = doc(db, tombPath);
      const tombSnap = await getDoc(tombRef);
      const batch = writeBatch(db);
      batch.delete(doc(db, entityPath));

      const safeParent = input.parentId
        ? assertValidFirestoreId(input.parentId, 'parentId')
        : null;
      const safeDeletedAt = clampIso(input.deletedAt, new Date().toISOString());
      const safeRev = normalizeInt(input.revision, 1, 10_000_000, 1);

      if (!tombSnap.exists()) {
        batch.set(tombRef, {
          id: tombDocId,
          ownerUid: safeUid,
          entityType: input.entityType,
          entityId: safeEntityId,
          parentId: safeParent,
          deletedAt: safeDeletedAt,
          revision: safeRev,
          serverCreatedAt: serverTimestamp(),
          serverUpdatedAt: serverTimestamp(),
        });
      } else {
        batch.update(tombRef, {
          parentId: safeParent,
          deletedAt: safeDeletedAt,
          revision: safeRev,
          serverUpdatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, entityPath, auth);
    }
  },

  async fetchUserCloudSnapshot(uid: string): Promise<RemoteWorkspaceSnapshot> {
    const safeUid = assertValidFirestoreId(uid, 'uid');
    const { db, auth } = requireFirestore();

    const listOwnedDocs = async (subcollection: string) => {
      const path = `users/${safeUid}/${subcollection}`;
      try {
        const q = query(collection(db, path), where('ownerUid', '==', safeUid));
        const snap = await getDocs(q);
        return snap.docs.map((d) => d.data());
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, path, auth);
      }
    };

    const [
      projDocs,
      fileDocs,
      convDocs,
      msgDocs,
      voiceDocs,
      prefDocs,
      tombDocs,
    ] = await Promise.all([
      listOwnedDocs('projects'),
      listOwnedDocs('files'),
      listOwnedDocs('conversations'),
      listOwnedDocs('messages'),
      listOwnedDocs('voiceSessions'),
      listOwnedDocs('preferences'),
      listOwnedDocs('tombstones'),
    ]);

    const files: Array<{ projectId: string; file: ProjectFile }> = [];
    const filesByProject = new Map<string, ProjectFile[]>();
    for (const raw of fileDocs) {
      const projectId = String(raw.projectId ?? '');
      const file: ProjectFile = {
        id: String(raw.id),
        name: String(raw.name),
        path: String(raw.path),
        folder: String(raw.folder ?? 'src'),
        language: raw.language as ProjectFile['language'],
        content: String(raw.content ?? ''),
        createdAt: String(raw.createdAt ?? raw.updatedAt ?? ''),
        updatedAt: String(raw.updatedAt ?? ''),
        deletedAt: typeof raw.deletedAt === 'string' ? raw.deletedAt : null,
        revision: typeof raw.revision === 'number' ? raw.revision : 1,
        ownerUid: safeUid,
        syncStatus: 'synced',
      };
      files.push({ projectId, file });
      const list = filesByProject.get(projectId) ?? [];
      list.push(file);
      filesByProject.set(projectId, list);
    }

    const projects: Project[] = projDocs.map((raw) => {
      const projFiles = filesByProject.get(String(raw.id)) ?? [];
      return {
        id: String(raw.id),
        name: String(raw.name ?? 'Untitled Project'),
        description: String(raw.description ?? ''),
        framework: String(raw.framework ?? 'HTML · CSS · JS'),
        createdAt: String(raw.createdAt ?? ''),
        updatedAt: String(raw.updatedAt ?? ''),
        deletedAt: typeof raw.deletedAt === 'string' ? raw.deletedAt : null,
        revision: typeof raw.revision === 'number' ? raw.revision : 1,
        ownerUid: safeUid,
        syncStatus: 'synced',
        entryFileId: String(raw.entryFileId ?? projFiles[0]?.id ?? ''),
        folders: Array.isArray(raw.folders) ? raw.folders.map(String) : ['src'],
        files: projFiles,
        isSample: false,
      };
    });

    const messages: Array<{ conversationId: string; orderIndex: number; message: ChatMessage }> = [];
    const msgsByConv = new Map<string, Array<{ orderIndex: number; message: ChatMessage }>>();
    for (const raw of msgDocs) {
      const conversationId = String(raw.conversationId ?? '');
      const orderIndex = typeof raw.orderIndex === 'number' ? raw.orderIndex : 0;
      const msg: ChatMessage = {
        id: String(raw.id),
        role: raw.role as ChatMessage['role'],
        content: String(raw.content ?? ''),
        timestamp: String(raw.timestamp ?? ''),
        createdAt: String(raw.createdAt ?? ''),
        updatedAt: String(raw.updatedAt ?? ''),
        deletedAt: typeof raw.deletedAt === 'string' ? raw.deletedAt : null,
        revision: typeof raw.revision === 'number' ? raw.revision : 1,
        ownerUid: safeUid,
        syncStatus: 'synced',
        source: raw.source === 'voice' ? 'voice' : 'text',
        language:
          raw.language === 'en' || raw.language === 'bn' || raw.language === 'mixed'
            ? raw.language
            : undefined,
      };
      messages.push({ conversationId, orderIndex, message: msg });
      const list = msgsByConv.get(conversationId) ?? [];
      list.push({ orderIndex, message: msg });
      msgsByConv.set(conversationId, list);
    }

    const conversations: Conversation[] = convDocs.map((raw) => {
      const convMsgs = (msgsByConv.get(String(raw.id)) ?? [])
        .slice()
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((m) => m.message);
      return {
        id: String(raw.id),
        title: String(raw.title ?? 'Untitled Conversation'),
        kind: raw.kind === 'voice' ? 'voice' : 'chat',
        projectId: typeof raw.projectId === 'string' ? raw.projectId : null,
        createdAt: String(raw.createdAt ?? ''),
        updatedAt: String(raw.updatedAt ?? ''),
        deletedAt: typeof raw.deletedAt === 'string' ? raw.deletedAt : undefined,
        revision: typeof raw.revision === 'number' ? raw.revision : 1,
        ownerUid: safeUid,
        syncStatus: 'synced',
        isPinned: Boolean(raw.isPinned),
        durationSeconds: typeof raw.durationSeconds === 'number' ? raw.durationSeconds : undefined,
        voiceSessionIds: Array.isArray(raw.voiceSessionIds)
          ? raw.voiceSessionIds.map(String)
          : [],
        summary: String(raw.summary ?? ''),
        messages: convMsgs,
        isSample: false,
      };
    });

    const voiceSessions: VoiceSessionRecord[] = voiceDocs.map((raw) => ({
      id: String(raw.id),
      conversationId: typeof raw.conversationId === 'string' ? raw.conversationId : null,
      model: String(raw.model ?? ''),
      languageMode: (raw.languageMode as VoiceSessionRecord['languageMode']) || 'bilingual',
      status: (raw.status as VoiceSessionRecord['status']) || 'disconnected',
      micPermission: (raw.micPermission as VoiceSessionRecord['micPermission']) || 'unknown',
      startedAt: String(raw.startedAt ?? ''),
      endedAt: typeof raw.endedAt === 'string' ? raw.endedAt : undefined,
      createdAt: String(raw.createdAt ?? ''),
      updatedAt: String(raw.updatedAt ?? ''),
      deletedAt: typeof raw.deletedAt === 'string' ? raw.deletedAt : null,
      revision: typeof raw.revision === 'number' ? raw.revision : 1,
      ownerUid: safeUid,
      syncStatus: 'synced',
      durationSeconds: typeof raw.durationSeconds === 'number' ? raw.durationSeconds : 0,
      errorMessage: typeof raw.errorMessage === 'string' ? raw.errorMessage : null,
      transcriptsSaved: Boolean(raw.transcriptsSaved),
      transcripts: Array.isArray(raw.transcripts) ? raw.transcripts : [],
      rawAudioStored: false,
    }));

    const settings: RemoteSettingRecord[] = [];
    for (const raw of prefDocs) {
      const key = String(raw.settingKey ?? '') as SyncableSettingKey;
      if (key !== 'voiceSettings' && key !== 'modelSettings' && key !== 'appSettings') continue;
      const sanitized =
        key === 'voiceSettings'
          ? sanitizeVoiceSettings(raw.value)
          : key === 'modelSettings'
            ? sanitizeModelSettings(raw.value)
            : sanitizeAppSettings(raw.value);
      settings.push({
        key,
        value: sanitized,
        revision: typeof raw.revision === 'number' ? raw.revision : 1,
        updatedAt: String(raw.updatedAt ?? ''),
      });
    }

    const tombstones: SyncTombstoneRecord[] = tombDocs.map((raw) => {
      const entityType = raw.entityType as SyncEntityType;
      const entityId = String(raw.entityId ?? '');
      return {
        id: createTombstoneId(entityType, entityId),
        entityType,
        entityId,
        parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
        deletedAt: String(raw.deletedAt ?? ''),
        revision: typeof raw.revision === 'number' ? raw.revision : 1,
        ownerUid: safeUid,
        syncStatus: 'synced',
        acknowledgedAt: new Date().toISOString(),
      };
    });

    return {
      projects,
      files,
      conversations,
      messages,
      voiceSessions,
      settings,
      tombstones,
    };
  },

  async fetchExistingEntityIds(uid: string): Promise<{
    projects: string[];
    files: string[];
    conversations: string[];
    messages: string[];
    voiceSessions: string[];
  }> {
    const snapshot = await this.fetchUserCloudSnapshot(uid);
    return {
      projects: snapshot.projects.map((p) => p.id),
      files: snapshot.files.map((f) => f.file.id),
      conversations: snapshot.conversations.map((c) => c.id),
      messages: snapshot.messages.map((m) => m.message.id),
      voiceSessions: snapshot.voiceSessions.map((v) => v.id),
    };
  },

  async deleteAllUserCloudData(uid: string): Promise<void> {
    const safeUid = assertValidFirestoreId(uid, 'uid');
    const { db, auth } = requireFirestore();
    const subcollections = [
      'files',
      'messages',
      'voiceSessions',
      'tombstones',
      'preferences',
      'projects',
      'conversations',
      'syncMeta',
    ];

    const refsToDelete: ReturnType<typeof doc>[] = [];
    for (const sub of subcollections) {
      const path = `users/${safeUid}/${sub}`;
      try {
        const snap = await getDocs(query(collection(db, path), where('ownerUid', '==', safeUid)));
        for (const d of snap.docs) {
          refsToDelete.push(d.ref);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, path, auth);
      }
    }

    // Delete subcollection documents in safe chunks (<500 batch limit)
    for (let i = 0; i < refsToDelete.length; i += 400) {
      const chunk = refsToDelete.slice(i, i + 400);
      const path = `users/${safeUid}`;
      try {
        const batch = writeBatch(db);
        for (const ref of chunk) {
          batch.delete(ref);
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path, auth);
      }
    }

    const profilePath = `users/${safeUid}`;
    try {
      await deleteDoc(doc(db, profilePath));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, profilePath, auth);
    }
  },
};
