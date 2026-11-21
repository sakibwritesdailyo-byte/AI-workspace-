import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VOICE_SETTINGS,
} from '../../data/mockWorkspaceData';
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
import { IndexedDbWorkspaceRepository } from '../indexedDbStorage';
import type { PreferenceKey } from '../settingsPolicy';
import type { RemoteSettingRecord, RemoteWorkspaceSnapshot } from './conflictResolution';
import type { UpsertDocResult } from './firestoreService';
import { CloudSyncCoordinator, type CloudRemoteAdapter } from './syncCoordinator';

function uniqueDbName(label: string): string {
  return `test_sync_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeAuthUser(uid: string, email: string): AuthUserProfile {
  return {
    uid,
    email,
    displayName: email.split('@')[0],
    photoURL: null,
    emailVerified: true,
    providerIds: ['password'],
    isAnonymous: false,
  };
}

class InMemoryCloudRemote implements CloudRemoteAdapter {
  private readonly users = new Map<
    string,
    {
      projects: Map<string, Project>;
      files: Map<string, { projectId: string; file: ProjectFile }>;
      conversations: Map<string, Conversation>;
      messages: Map<string, { conversationId: string; orderIndex: number; message: ChatMessage }>;
      voiceSessions: Map<string, VoiceSessionRecord>;
      settings: Map<string, RemoteSettingRecord>;
      tombstones: Map<string, SyncTombstoneRecord>;
      meta: { lastPushAt?: string; lastPullAt?: string };
    }
  >();

  failNextUpsertCount = 0;
  upsertCalls: string[] = [];

  private bucket(uid: string) {
    let b = this.users.get(uid);
    if (!b) {
      b = {
        projects: new Map(),
        files: new Map(),
        conversations: new Map(),
        messages: new Map(),
        voiceSessions: new Map(),
        settings: new Map(),
        tombstones: new Map(),
        meta: {},
      };
      this.users.set(uid, b);
    }
    return b;
  }

  private maybeThrowTransient() {
    if (this.failNextUpsertCount > 0) {
      this.failNextUpsertCount -= 1;
      const err = new Error('Firestore temporarily unavailable');
      (err as { code?: string }).code = 'unavailable';
      throw err;
    }
  }

  async ensureUserProfile(): Promise<void> {}

  async updateSyncMeta(
    uid: string,
    patch: { lastPushAt?: string; lastPullAt?: string },
  ): Promise<void> {
    const b = this.bucket(uid);
    b.meta = { ...b.meta, ...patch };
  }

  async upsertProject(
    uid: string,
    project: Project,
    options?: { expectedBaseRevision?: number | null },
  ): Promise<UpsertDocResult> {
    this.maybeThrowTransient();
    this.upsertCalls.push(`project:${project.id}`);
    const b = this.bucket(uid);
    const existing = b.projects.get(project.id);
    if (
      existing &&
      typeof options?.expectedBaseRevision === 'number' &&
      (existing.revision ?? 1) > options.expectedBaseRevision
    ) {
      return { conflictDetected: true, remoteRevision: existing.revision ?? 1 };
    }
    b.projects.set(project.id, { ...project, ownerUid: uid, syncStatus: 'synced', files: [] });
    return { conflictDetected: false };
  }

  async upsertFile(
    uid: string,
    projectId: string,
    file: ProjectFile,
    options?: { expectedBaseRevision?: number | null; ensureParentProject?: Project | null },
  ): Promise<UpsertDocResult> {
    this.maybeThrowTransient();
    this.upsertCalls.push(`file:${file.id}`);
    const b = this.bucket(uid);
    if (!b.projects.has(projectId) && options?.ensureParentProject) {
      b.projects.set(projectId, {
        ...options.ensureParentProject,
        ownerUid: uid,
        syncStatus: 'synced',
        files: [],
      });
    }
    const existing = b.files.get(file.id);
    if (
      existing &&
      typeof options?.expectedBaseRevision === 'number' &&
      (existing.file.revision ?? 1) > options.expectedBaseRevision
    ) {
      return { conflictDetected: true, remoteRevision: existing.file.revision ?? 1 };
    }
    b.files.set(file.id, { projectId, file: { ...file, ownerUid: uid, syncStatus: 'synced' } });
    return { conflictDetected: false };
  }

  async upsertConversation(
    uid: string,
    conversation: Conversation,
    options?: { expectedBaseRevision?: number | null },
  ): Promise<UpsertDocResult> {
    this.maybeThrowTransient();
    this.upsertCalls.push(`conversation:${conversation.id}`);
    const b = this.bucket(uid);
    const existing = b.conversations.get(conversation.id);
    if (
      existing &&
      typeof options?.expectedBaseRevision === 'number' &&
      (existing.revision ?? 1) > options.expectedBaseRevision
    ) {
      return { conflictDetected: true, remoteRevision: existing.revision ?? 1 };
    }
    b.conversations.set(conversation.id, {
      ...conversation,
      ownerUid: uid,
      syncStatus: 'synced',
      messages: [],
    });
    return { conflictDetected: false };
  }

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
    this.maybeThrowTransient();
    this.upsertCalls.push(`message:${message.id}`);
    const b = this.bucket(uid);
    if (!b.conversations.has(conversationId) && options?.ensureParentConversation) {
      b.conversations.set(conversationId, {
        ...options.ensureParentConversation,
        ownerUid: uid,
        syncStatus: 'synced',
        messages: [],
      });
    }
    const existing = b.messages.get(message.id);
    if (
      existing &&
      typeof options?.expectedBaseRevision === 'number' &&
      (existing.message.revision ?? 1) > options.expectedBaseRevision
    ) {
      return { conflictDetected: true, remoteRevision: existing.message.revision ?? 1 };
    }
    b.messages.set(message.id, {
      conversationId,
      orderIndex,
      message: { ...message, ownerUid: uid, syncStatus: 'synced' },
    });
    return { conflictDetected: false };
  }

  async upsertVoiceSession(
    uid: string,
    session: VoiceSessionRecord,
    options?: { expectedBaseRevision?: number | null },
  ): Promise<UpsertDocResult> {
    this.maybeThrowTransient();
    const b = this.bucket(uid);
    const existing = b.voiceSessions.get(session.id);
    if (
      existing &&
      typeof options?.expectedBaseRevision === 'number' &&
      (existing.revision ?? 1) > options.expectedBaseRevision
    ) {
      return { conflictDetected: true, remoteRevision: existing.revision ?? 1 };
    }
    b.voiceSessions.set(session.id, { ...session, ownerUid: uid, syncStatus: 'synced' });
    return { conflictDetected: false };
  }

  async upsertPreference(
    uid: string,
    settingKey: PreferenceKey,
    value: VoiceSettings | ModelSettings | AppSettings,
    revision: number,
    updatedAt: string,
    options?: { expectedBaseRevision?: number | null },
  ): Promise<UpsertDocResult> {
    this.maybeThrowTransient();
    this.upsertCalls.push(`setting:${settingKey}`);
    const b = this.bucket(uid);
    if (
      settingKey !== 'voiceSettings' &&
      settingKey !== 'modelSettings' &&
      settingKey !== 'appSettings'
    ) {
      throw new Error(`Rejected non-syncable key ${settingKey}`);
    }
    const existing = b.settings.get(settingKey);
    if (
      existing &&
      typeof options?.expectedBaseRevision === 'number' &&
      existing.revision > options.expectedBaseRevision
    ) {
      return { conflictDetected: true, remoteRevision: existing.revision };
    }
    b.settings.set(settingKey, { key: settingKey, value, revision, updatedAt });
    return { conflictDetected: false };
  }

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
    const b = this.bucket(uid);
    if (input.entityType === 'project') b.projects.delete(input.entityId);
    if (input.entityType === 'file') b.files.delete(input.entityId);
    if (input.entityType === 'conversation') b.conversations.delete(input.entityId);
    if (input.entityType === 'message') b.messages.delete(input.entityId);
    if (input.entityType === 'voice_session') b.voiceSessions.delete(input.entityId);
    const tombDocId = `${input.entityType}__${input.entityId}`;
    b.tombstones.set(tombDocId, {
      id: `${input.entityType}:${input.entityId}`,
      entityType: input.entityType,
      entityId: input.entityId,
      parentId: input.parentId ?? null,
      deletedAt: input.deletedAt,
      revision: input.revision,
      ownerUid: uid,
      syncStatus: 'synced',
      acknowledgedAt: input.deletedAt,
    });
  }

  async fetchUserCloudSnapshot(uid: string): Promise<RemoteWorkspaceSnapshot> {
    const b = this.bucket(uid);
    return {
      projects: Array.from(b.projects.values()),
      files: Array.from(b.files.values()),
      conversations: Array.from(b.conversations.values()),
      messages: Array.from(b.messages.values()),
      voiceSessions: Array.from(b.voiceSessions.values()),
      settings: Array.from(b.settings.values()),
      tombstones: Array.from(b.tombstones.values()),
    };
  }

  async fetchExistingEntityIds(uid: string) {
    const b = this.bucket(uid);
    return {
      projects: Array.from(b.projects.keys()),
      files: Array.from(b.files.keys()),
      conversations: Array.from(b.conversations.keys()),
      messages: Array.from(b.messages.keys()),
      voiceSessions: Array.from(b.voiceSessions.keys()),
    };
  }

  async deleteAllUserCloudData(uid: string): Promise<void> {
    this.users.delete(uid);
  }
}

test('CloudSyncCoordinator syncs multi-device changes, excludes device_local settings, and isolates accounts', async () => {
  const remote = new InMemoryCloudRemote();
  const repoDeviceA = new IndexedDbWorkspaceRepository(uniqueDbName('dev_a'));
  const repoDeviceB = new IndexedDbWorkspaceRepository(uniqueDbName('dev_b'));
  const userA = makeAuthUser('uid-a', 'a@studio.app');
  const userB = makeAuthUser('uid-b', 'b@studio.app');

  const syncA = new CloudSyncCoordinator(repoDeviceA, remote, undefined, 'worker-a');
  const syncB = new CloudSyncCoordinator(repoDeviceB, remote, undefined, 'worker-b');

  // Device A creates project + conversation + syncable settings + device_local pointers
  const proj: Project = {
    id: 'proj-shared',
    name: 'Cloud App',
    description: 'Cross device app',
    framework: 'HTML · CSS · JS',
    createdAt: '2026-02-01T10:00:00.000Z',
    updatedAt: '2026-02-01T10:00:00.000Z',
    revision: 1,
    ownerUid: 'uid-a',
    syncStatus: 'pending',
    entryFileId: 'file-1',
    folders: ['src'],
    isSample: false,
    files: [
      {
        id: 'file-1',
        name: 'index.html',
        folder: 'src',
        path: 'src/index.html',
        language: 'html',
        content: '<h1>Synced Hello</h1>',
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt: '2026-02-01T10:00:00.000Z',
        revision: 1,
        ownerUid: 'uid-a',
        syncStatus: 'pending',
      },
    ],
  };

  await repoDeviceA.commitWorkspaceDelta(
    null,
    {
      projects: [proj],
      conversations: [],
      deletedConversations: [],
      voiceSessions: [],
      preferences: {
        voiceSettings: { ...DEFAULT_VOICE_SETTINGS, voiceName: 'Fenrir' },
        modelSettings: DEFAULT_MODEL_SETTINGS,
        appSettings: DEFAULT_APP_SETTINGS,
        activeProjectId: 'proj-shared',
        activeFileId: 'file-1',
        settingRevisions: { voiceSettings: 1, modelSettings: 1, appSettings: 1 },
      },
    },
    { ownerUid: 'uid-a' },
  );

  await syncA.setAuthUser(userA);
  assert.equal(syncA.getState().status, 'synced');
  assert.equal((await repoDeviceA.readOutbox({ ownerUid: 'uid-a' })).length, 0);
  // Device_local pointers must NEVER be pushed to cloud
  assert.equal(remote.upsertCalls.some((c) => c.includes('activeProjectId')), false);

  // Device B signs in as userA -> recovers project, file, and Fenrir voice preference
  let appliedOnB = 0;
  const syncBTracked = new CloudSyncCoordinator(
    repoDeviceB,
    remote,
    {
      onRemoteChangesApplied: () => {
        appliedOnB += 1;
      },
    },
    'worker-b2',
  );
  await syncBTracked.setAuthUser(userA);
  assert.equal(appliedOnB, 1);

  const loadedB = await repoDeviceB.loadWorkspace({ activeOwnerUid: 'uid-a' });
  assert.equal(loadedB.projects.length, 1);
  assert.equal(loadedB.projects[0].files[0].content, '<h1>Synced Hello</h1>');
  assert.equal(loadedB.preferences.voiceSettings?.voiceName, 'Fenrir');
  // Pulling remote state must NOT echo back into Device B outbox
  assert.equal((await repoDeviceB.readOutbox({ ownerUid: 'uid-a' })).length, 0);

  // User B on another device has zero visibility into User A's cloud data
  const repoOther = new IndexedDbWorkspaceRepository(uniqueDbName('other_user'));
  const syncOther = new CloudSyncCoordinator(repoOther, remote, undefined, 'worker-other');
  await syncOther.setAuthUser(userB);
  const loadedOther = await repoOther.loadWorkspace({ activeOwnerUid: 'uid-b' });
  assert.equal(loadedOther.projects.length, 0);

  syncA.dispose();
  syncB.dispose();
  syncBTracked.dispose();
  syncOther.dispose();
});

test('CloudSyncCoordinator queues offline edits, recovers partial push failures, and resolves unclaimed data collisions', async () => {
  const remote = new InMemoryCloudRemote();
  const repo = new IndexedDbWorkspaceRepository(uniqueDbName('offline_retry'));
  const user = makeAuthUser('uid-off', 'offline@studio.app');

  // Seed unclaimed local project whose ID collides with an existing remote project for uid-off
  await remote.upsertProject('uid-off', {
    id: 'proj-collide',
    name: 'Existing Cloud Project',
    description: 'Remote',
    framework: 'HTML',
    createdAt: '2026-02-01T08:00:00.000Z',
    updatedAt: '2026-02-01T08:00:00.000Z',
    revision: 1,
    ownerUid: 'uid-off',
    syncStatus: 'synced',
    entryFileId: 'f-remote',
    folders: ['src'],
    files: [],
  });

  await repo.commitWorkspaceDelta(
    null,
    {
      projects: [
        {
          id: 'proj-collide',
          name: 'Local Offline Work',
          description: 'Local',
          framework: 'HTML',
          createdAt: '2026-02-01T09:00:00.000Z',
          updatedAt: '2026-02-01T09:00:00.000Z',
          revision: 1,
          ownerUid: null,
          syncStatus: 'local_only',
          entryFileId: 'f-local',
          folders: ['src'],
          files: [
            {
              id: 'f-local',
              name: 'app.js',
              folder: 'src',
              path: 'src/app.js',
              language: 'javascript',
              content: 'console.log("unclaimed");',
              createdAt: '2026-02-01T09:00:00.000Z',
              updatedAt: '2026-02-01T09:00:00.000Z',
              revision: 1,
              ownerUid: null,
              syncStatus: 'local_only',
            },
          ],
        },
      ],
      conversations: [],
      deletedConversations: [],
      voiceSessions: [],
      preferences: {
        voiceSettings: DEFAULT_VOICE_SETTINGS,
        modelSettings: DEFAULT_MODEL_SETTINGS,
        appSettings: DEFAULT_APP_SETTINGS,
      },
    },
    { ownerUid: null },
  );

  const coordinator = new CloudSyncCoordinator(repo, remote, undefined, 'worker-off');
  await coordinator.setAuthUser(user);

  // Sync MUST pause on unclaimed local data
  assert.equal(coordinator.getState().status, 'auth_required');
  assert.equal(coordinator.getState().ownershipPausedReason, 'unclaimed_local_data_present');

  // Claim & merge remaps colliding ID cleanly without overwriting remote
  const claimOutcome = await coordinator.resolveOwnershipPrompt('claim_and_merge');
  assert.ok(claimOutcome.claimedCount >= 1);
  assert.ok(claimOutcome.remappedCount >= 1);

  const cloudSnapshot = await remote.fetchUserCloudSnapshot('uid-off');
  assert.equal(cloudSnapshot.projects.length, 2);
  assert.ok(cloudSnapshot.projects.some((p) => p.id === 'proj-collide'));
  assert.ok(cloudSnapshot.projects.some((p) => p.name === 'Local Offline Work'));

  // Simulate offline edit followed by transient failure on first push attempt
  coordinator.setOnlineStatus(false);
  const current = await repo.loadWorkspace({ activeOwnerUid: 'uid-off' });
  const localProj = current.projects.find((p) => p.name === 'Local Offline Work')!;
  const updatedProj: Project = {
    ...localProj,
    name: 'Local Offline Work v2',
    updatedAt: '2026-02-02T10:00:00.000Z',
    revision: (localProj.revision ?? 1) + 1,
    syncStatus: 'pending',
  };
  await repo.commitWorkspaceDelta(
    current,
    { ...current, projects: current.projects.map((p) => (p.id === updatedProj.id ? updatedProj : p)) },
    { ownerUid: 'uid-off' },
  );
  coordinator.notifyLocalDataChanged();
  await coordinator.syncNow();
  assert.equal(coordinator.getState().status, 'offline');
  assert.equal((await repo.readOutbox({ ownerUid: 'uid-off' })).length, 1);

  // Reconnect with a transient Firestore error -> marks failed with retry backoff, never drops outbox item
  remote.failNextUpsertCount = 1;
  coordinator.setOnlineStatus(true);
  await coordinator.syncNow();
  const afterFailOutbox = await repo.readOutbox({ ownerUid: 'uid-off' });
  assert.equal(afterFailOutbox.length, 1);
  assert.equal(afterFailOutbox[0].status, 'failed');

  // Advance past retry backoff window & retry -> completes cleanly
  const futureRetryIso = new Date(Date.now() + 120_000).toISOString();
  await repo.recoverExpiredOutboxLeases({
    ownerUid: 'uid-off',
    nowIso: futureRetryIso,
  });
  await coordinator.syncNow({ nowIso: futureRetryIso });
  assert.equal((await repo.readOutbox({ ownerUid: 'uid-off' })).length, 0);
  assert.equal(coordinator.getState().status, 'synced');

  coordinator.dispose();
});
