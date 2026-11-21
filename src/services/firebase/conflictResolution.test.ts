import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VOICE_SETTINGS,
} from '../../data/mockWorkspaceData';
import type { Conversation, Project, SyncOutboxRecord, SyncTombstoneRecord } from '../../types/workspace';
import { buildOutboxRecord, type PersistedWorkspaceSnapshot } from '../workspaceRepository';
import { reconcileCloudAndLocalWorkspace, type RemoteWorkspaceSnapshot } from './conflictResolution';

function makeProject(id: string, name: string, revision: number, updatedAt: string): Project {
  return {
    id,
    name,
    description: 'Test project',
    framework: 'HTML · CSS · JS',
    createdAt: '2026-02-01T10:00:00.000Z',
    updatedAt,
    revision,
    ownerUid: 'uid-1',
    syncStatus: 'pending',
    entryFileId: `${id}-f1`,
    folders: ['src'],
    isSample: false,
    files: [
      {
        id: `${id}-f1`,
        name: 'index.html',
        folder: 'src',
        path: 'src/index.html',
        language: 'html',
        content: `<h1>${name}</h1>`,
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt,
        revision,
        ownerUid: 'uid-1',
        syncStatus: 'pending',
      },
    ],
  };
}

function makeConversation(id: string, title: string, revision: number, updatedAt: string): Conversation {
  return {
    id,
    title,
    kind: 'chat',
    projectId: null,
    createdAt: '2026-02-01T10:00:00.000Z',
    updatedAt,
    revision,
    ownerUid: 'uid-1',
    syncStatus: 'pending',
    isPinned: false,
    summary: 'Prompt',
    isSample: false,
    messages: [
      {
        id: `${id}-m1`,
        role: 'user',
        content: 'Hello from device',
        timestamp: '10:00',
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt,
        revision,
        ownerUid: 'uid-1',
        syncStatus: 'pending',
        source: 'text',
      },
    ],
  };
}

function emptyRemote(): RemoteWorkspaceSnapshot {
  return {
    projects: [],
    files: [],
    conversations: [],
    messages: [],
    voiceSessions: [],
    settings: [],
    tombstones: [],
  };
}

function emptyLocal(): PersistedWorkspaceSnapshot {
  return {
    projects: [],
    conversations: [],
    deletedConversations: [],
    voiceSessions: [],
    preferences: {
      voiceSettings: DEFAULT_VOICE_SETTINGS,
      modelSettings: DEFAULT_MODEL_SETTINGS,
      appSettings: DEFAULT_APP_SETTINGS,
      settingRevisions: {},
    },
  };
}

test('reconcileCloudAndLocalWorkspace creates non-destructive conflict copies on concurrent edits', () => {
  const localProj = makeProject('proj-1', 'Local Title', 2, '2026-02-02T12:00:00.000Z');
  localProj.files[0].content = '<h1>Local Offline Edit</h1>';
  const remoteProj = makeProject('proj-1', 'Cloud Title', 3, '2026-02-02T12:05:00.000Z');
  remoteProj.files[0].content = '<h1>Cloud Edit</h1>';

  const localConv = makeConversation('conv-1', 'Local Chat', 2, '2026-02-02T12:00:00.000Z');
  const remoteConv = makeConversation('conv-1', 'Cloud Chat', 3, '2026-02-02T12:05:00.000Z');

  const outbox: SyncOutboxRecord[] = [
    buildOutboxRecord({
      entityType: 'project',
      entityId: 'proj-1',
      operation: 'upsert',
      revision: 2,
      baseRevision: 1,
      ownerUid: 'uid-1',
      updatedAt: '2026-02-02T12:00:00.000Z',
    }),
    buildOutboxRecord({
      entityType: 'file',
      entityId: 'proj-1-f1',
      parentId: 'proj-1',
      operation: 'upsert',
      revision: 2,
      baseRevision: 1,
      ownerUid: 'uid-1',
      updatedAt: '2026-02-02T12:00:00.000Z',
    }),
    buildOutboxRecord({
      entityType: 'conversation',
      entityId: 'conv-1',
      operation: 'upsert',
      revision: 2,
      baseRevision: 1,
      ownerUid: 'uid-1',
      updatedAt: '2026-02-02T12:00:00.000Z',
    }),
  ];

  const remote: RemoteWorkspaceSnapshot = {
    ...emptyRemote(),
    projects: [remoteProj],
    files: [{ projectId: 'proj-1', file: remoteProj.files[0] }],
    conversations: [remoteConv],
    messages: [{ conversationId: 'conv-1', orderIndex: 0, message: remoteConv.messages[0] }],
  };

  const result = reconcileCloudAndLocalWorkspace({
    ownerUid: 'uid-1',
    localSnapshot: {
      ...emptyLocal(),
      projects: [localProj],
      conversations: [localConv],
    },
    localOutbox: outbox,
    localTombstones: [],
    remote,
    nowIso: '2026-02-02T12:10:00.000Z',
  });

  assert.equal(result.hasChanges, true);
  assert.equal(result.conflicts.length, 3);

  // Remote wins canonical entity IDs cleanly
  assert.equal(result.applyInput.upsertProjects?.[0].name, 'Cloud Title');
  assert.equal(result.applyInput.upsertFiles?.[0].file.content, '<h1>Cloud Edit</h1>');
  assert.equal(result.applyInput.upsertConversations?.[0].title, 'Cloud Chat');

  // Local edits are preserved as explicit conflict copies
  assert.equal(result.applyInput.conflictCopyProjects?.length, 1);
  const copyProjId = result.applyInput.conflictCopyProjects![0].id;
  assert.match(result.applyInput.conflictCopyProjects![0].name, /\(Conflict Copy\)$/);
  assert.equal(result.applyInput.conflictCopyFiles?.length, 2);
  assert.ok(
    result.applyInput.conflictCopyFiles?.some(
      (e) => e.projectId === 'proj-1' && e.file.name === 'index.conflict-copy.html',
    ),
  );
  assert.ok(
    result.applyInput.conflictCopyFiles?.some((e) => e.projectId === copyProjId),
  );
  assert.equal(result.applyInput.conflictCopyConversations?.length, 1);
  assert.match(result.applyInput.conflictCopyConversations![0].title, /\(Conflict Copy\)$/);
  assert.equal(result.applyInput.outboxAcks?.length, 3);
});

test('reconcileCloudAndLocalWorkspace preserves unpushed local edits when remote entity has tombstone', () => {
  const localProj = makeProject('proj-del', 'Offline Edited Project', 3, '2026-02-02T13:00:00.000Z');
  const remoteTombstone: SyncTombstoneRecord = {
    id: 'project:proj-del',
    entityType: 'project',
    entityId: 'proj-del',
    parentId: null,
    deletedAt: '2026-02-02T12:30:00.000Z',
    revision: 2,
    ownerUid: 'uid-1',
    syncStatus: 'synced',
    acknowledgedAt: '2026-02-02T12:30:00.000Z',
  };

  const outbox: SyncOutboxRecord[] = [
    buildOutboxRecord({
      entityType: 'project',
      entityId: 'proj-del',
      operation: 'upsert',
      revision: 3,
      baseRevision: 1,
      ownerUid: 'uid-1',
      updatedAt: '2026-02-02T13:00:00.000Z',
    }),
  ];

  const result = reconcileCloudAndLocalWorkspace({
    ownerUid: 'uid-1',
    localSnapshot: {
      ...emptyLocal(),
      projects: [localProj],
    },
    localOutbox: outbox,
    localTombstones: [],
    remote: {
      ...emptyRemote(),
      tombstones: [remoteTombstone],
    },
    nowIso: '2026-02-02T13:05:00.000Z',
  });

  assert.equal(result.applyInput.deleteProjectIds?.includes('proj-del'), true);
  assert.equal(result.applyInput.conflictCopyProjects?.length, 1);
  assert.match(result.applyInput.conflictCopyProjects![0].name, /\(Restored Copy\)$/);
  assert.equal(result.conflicts[0].reason, 'delete_vs_edit');
  assert.equal(result.conflicts[0].resolution, 'preserved_both');
});

test('reconcileCloudAndLocalWorkspace propagates clean remote tombstones and resolves settings deterministically', () => {
  const cleanLocalProj = makeProject('proj-clean', 'Old Project', 1, '2026-02-01T10:00:00.000Z');
  const remoteTomb: SyncTombstoneRecord = {
    id: 'project:proj-clean',
    entityType: 'project',
    entityId: 'proj-clean',
    parentId: null,
    deletedAt: '2026-02-02T14:00:00.000Z',
    revision: 2,
    ownerUid: 'uid-1',
    syncStatus: 'synced',
    acknowledgedAt: '2026-02-02T14:00:00.000Z',
  };

  const result = reconcileCloudAndLocalWorkspace({
    ownerUid: 'uid-1',
    localSnapshot: {
      ...emptyLocal(),
      projects: [cleanLocalProj],
      preferences: {
        voiceSettings: DEFAULT_VOICE_SETTINGS,
        modelSettings: DEFAULT_MODEL_SETTINGS,
        appSettings: DEFAULT_APP_SETTINGS,
        settingRevisions: { voiceSettings: 1, modelSettings: 2 },
      },
    },
    localOutbox: [],
    localTombstones: [],
    remote: {
      ...emptyRemote(),
      tombstones: [remoteTomb],
      settings: [
        {
          key: 'voiceSettings',
          value: { ...DEFAULT_VOICE_SETTINGS, voiceName: 'Charon' },
          revision: 3,
          updatedAt: '2026-02-02T14:00:00.000Z',
        },
        {
          key: 'modelSettings',
          value: { ...DEFAULT_MODEL_SETTINGS, chatModel: 'gemini-2.5-pro' },
          revision: 1,
          updatedAt: '2026-02-02T11:00:00.000Z',
        },
      ],
    },
  });

  // Clean local project deleted via remote tombstone
  assert.deepEqual(result.applyInput.deleteProjectIds, ['proj-clean']);
  assert.equal(result.conflicts.length, 0);

  // Higher remote revision (3 > 1) wins voiceSettings; lower remote revision (1 < 2) does not overwrite modelSettings
  assert.equal(result.applyInput.upsertSettings?.length, 1);
  assert.equal(result.applyInput.upsertSettings?.[0].key, 'voiceSettings');
  assert.equal(
    (result.applyInput.upsertSettings?.[0].value as typeof DEFAULT_VOICE_SETTINGS).voiceName,
    'Charon',
  );
});
