import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VOICE_SETTINGS,
} from '../data/mockWorkspaceData';
import { WorkspacePersistenceCoordinator } from './workspacePersistence';
import type {
  PersistedPreferences,
  PersistedWorkspaceSnapshot,
  WorkspaceRepository,
} from './workspaceRepository';
import type { WorkspaceStorageStats } from '../types/workspace';

const EMPTY_STATS: WorkspaceStorageStats = {
  projectCount: 1,
  fileCount: 1,
  conversationCount: 0,
  messageCount: 0,
  voiceSessionCount: 0,
  deletedCount: 0,
  tombstoneCount: 0,
  outboxCount: 0,
  usageBytes: null,
  quotaBytes: null,
  persistedStorage: null,
  storageError: null,
};

function makeSnapshot(tag: string): PersistedWorkspaceSnapshot {
  const now = '2026-02-01T00:00:00.000Z';
  return {
    projects: [
      {
        id: 'p1',
        name: 'App',
        description: '',
        framework: 'HTML · CSS · JS',
        createdAt: now,
        updatedAt: now,
        entryFileId: 'f1',
        folders: ['src'],
        files: [
          {
            id: 'f1',
            name: 'index.html',
            folder: 'src',
            path: 'src/index.html',
            language: 'html',
            content: tag,
            updatedAt: now,
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
      activeProjectId: 'p1',
      activeConversationId: null,
      activeFileId: 'f1',
      settingRevisions: {},
    },
  };
}

function makeEmptySnapshot(): PersistedWorkspaceSnapshot {
  return {
    projects: [],
    conversations: [],
    deletedConversations: [],
    voiceSessions: [],
    preferences: {
      voiceSettings: DEFAULT_VOICE_SETTINGS,
      modelSettings: DEFAULT_MODEL_SETTINGS,
      appSettings: DEFAULT_APP_SETTINGS,
      activeProjectId: null,
      activeConversationId: null,
      activeFileId: null,
      settingRevisions: {},
    },
  };
}

function makeStubRepo(overrides: Partial<WorkspaceRepository> = {}): WorkspaceRepository {
  const noop = async () => {};
  return {
    loadWorkspace: async () => makeSnapshot('init'),
    getStorageStats: async () => EMPTY_STATS,
    requestPersistentStorage: async () => ({ supported: true, persisted: true }),
    createProject: noop,
    updateProject: noop,
    deleteProject: noop,
    upsertFile: noop,
    deleteFile: noop,
    createConversation: noop,
    updateConversation: noop,
    saveMessages: noop,
    moveConversationToTrash: noop,
    restoreDeletedConversation: noop,
    permanentlyDeleteConversation: noop,
    saveVoiceSession: noop,
    saveSettings: noop,
    commitWorkspaceDelta: async () => EMPTY_STATS,
    importWorkspaceSnapshot: async () => EMPTY_STATS,
    readTombstones: async () => [],
    readOutbox: async () => [],
    readPendingOutbox: async () => [],
    claimOutboxOperations: async () => [],
    recoverExpiredOutboxLeases: async () => 0,
    markOutboxOperationFailed: async () => null,
    acknowledgeOutboxOperations: async () => ({ acknowledgedIds: [], skippedIds: [] }),
    pruneAcknowledgedTombstones: async () => 0,
    getOutboxDiagnostics: async () => ({
      ownerUid: null,
      totalCount: 0,
      pendingCount: 0,
      inFlightCount: 0,
      failedCount: 0,
      expiredLeaseCount: 0,
      retryReadyCount: 0,
      oldestPendingAt: null,
      unacknowledgedTombstoneCount: 0,
      acknowledgedTombstoneCount: 0,
    }),
    getOwnershipSummary: async () => ({
      activeOwnerUid: null,
      unclaimedCount: 0,
      activeAccountCount: 0,
      otherAccountCount: 0,
      otherAccountUids: [],
      unclaimedOutboxCount: 0,
      activeAccountOutboxCount: 0,
      otherAccountOutboxCount: 0,
    }),
    claimUnclaimedLocalData: async (targetOwnerUid) => ({
      claimedCount: 0,
      remappedProjectIds: {},
      remappedFileIds: {},
      remappedConversationIds: {},
      remappedMessageIds: {},
      remappedVoiceSessionIds: {},
      targetOwnerUid,
    }),
    applyRemoteSyncChanges: async () => EMPTY_STATS,
    deleteAccountLocalData: async () => EMPTY_STATS,
    clearAllData: async () => EMPTY_STATS,
    ...overrides,
  };
}

test('hydration triggers zero database writes and UI pointer changes only call saveSettings', async () => {
  let deltaCalls = 0;
  let settingsCalls = 0;
  let savedKeys: Array<keyof PersistedPreferences> | undefined;

  const repo = makeStubRepo({
    commitWorkspaceDelta: async () => {
      deltaCalls += 1;
      return EMPTY_STATS;
    },
    saveSettings: async (_prefs, keys) => {
      settingsCalls += 1;
      savedKeys = keys;
    },
  });

  const target = {
    hydrated: true,
    autosaveEnabled: true,
    dataRevision: 0,
    uiRevision: 0,
    snapshot: makeSnapshot('v0'),
  };

  const coordinator = new WorkspacePersistenceCoordinator(repo, () => target, {}, 10);
  coordinator.markHydrated(target.snapshot, 0, 0);

  await coordinator.flush();
  assert.equal(deltaCalls, 0);
  assert.equal(settingsCalls, 0);

  // Pure UI selection change (uiRevision=1, dataRevision=0)
  target.uiRevision = 1;
  target.snapshot = {
    ...target.snapshot,
    preferences: { ...target.snapshot.preferences, activeFileId: 'f2' },
  };
  await coordinator.flush();
  assert.equal(deltaCalls, 0);
  assert.equal(settingsCalls, 1);
  assert.deepEqual(savedKeys, ['activeProjectId', 'activeConversationId', 'activeFileId']);
  coordinator.dispose();
});

test('serialized save loop prevents overlapping writes and coalesces edits made during an in-flight write (BUG-02)', async () => {
  const persistedContents: string[] = [];
  const savedRevisions: number[] = [];
  let releaseFirstSave!: () => void;
  let callIndex = 0;

  const repo = makeStubRepo({
    commitWorkspaceDelta: async (_prev, next) => {
      callIndex += 1;
      const content = next.projects[0].files[0].content;
      if (callIndex === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstSave = resolve;
        });
      }
      persistedContents.push(content);
      return EMPTY_STATS;
    },
  });

  const target = {
    hydrated: true,
    autosaveEnabled: true,
    dataRevision: 1,
    uiRevision: 0,
    snapshot: makeSnapshot('rev-1'),
  };

  const coordinator = new WorkspacePersistenceCoordinator(
    repo,
    () => target,
    {
      onSaved: (persistedRevision) => {
        savedRevisions.push(persistedRevision);
      },
    },
    10,
  );
  coordinator.markHydrated(makeSnapshot('rev-0'), 0, 0);

  const flushPromise = coordinator.flush();

  target.dataRevision = 2;
  target.snapshot = makeSnapshot('rev-2');
  target.dataRevision = 3;
  target.snapshot = makeSnapshot('rev-3');

  const secondFlush = coordinator.flush();

  releaseFirstSave();
  await Promise.all([flushPromise, secondFlush]);

  assert.deepEqual(savedRevisions, [1, 3]);
  assert.deepEqual(persistedContents, ['rev-1', 'rev-3']);
  assert.equal(coordinator.getLastPersistedRevision(), 3);
  coordinator.dispose();
});

test('save errors invoke onError, keep lastCommittedSnapshot intact, and allow subsequent retry', async () => {
  let shouldFail = true;
  const errors: string[] = [];
  const saved: number[] = [];

  const repo = makeStubRepo({
    commitWorkspaceDelta: async () => {
      if (shouldFail) {
        throw new Error('QuotaExceededError');
      }
      return EMPTY_STATS;
    },
  });

  const baselineSnap = makeSnapshot('rev-0');
  const target = {
    hydrated: true,
    autosaveEnabled: true,
    dataRevision: 1,
    uiRevision: 0,
    snapshot: makeSnapshot('rev-1'),
  };

  const coordinator = new WorkspacePersistenceCoordinator(
    repo,
    () => target,
    {
      onError: (msg) => errors.push(msg),
      onSaved: (rev) => saved.push(rev),
    },
    10,
  );
  coordinator.markHydrated(baselineSnap, 0, 0);

  await coordinator.flush();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /QuotaExceededError/);
  assert.equal(coordinator.getLastPersistedRevision(), 0);
  assert.equal(coordinator.getLastCommittedSnapshot(), baselineSnap);

  shouldFail = false;
  await coordinator.flush();
  assert.deepEqual(saved, [1]);
  assert.equal(coordinator.getLastPersistedRevision(), 1);
  coordinator.dispose();
});

test('runExclusiveClear fences stale in-flight commits and clears cleanly without recreating wiped data', async () => {
  const operations: string[] = [];
  const savedRevisions: number[] = [];
  let releaseInFlightWrite!: () => void;

  let commitCallCount = 0;

  const repo = makeStubRepo({
    commitWorkspaceDelta: async () => {
      commitCallCount += 1;
      operations.push('commit-start');
      if (commitCallCount === 1) {
        await new Promise<void>((resolve) => {
          releaseInFlightWrite = resolve;
        });
      }
      operations.push('commit-end');
      return EMPTY_STATS;
    },
    clearAllData: async () => {
      operations.push('clear');
      return { ...EMPTY_STATS, projectCount: 0, fileCount: 0 };
    },
  });

  const target = {
    hydrated: true,
    autosaveEnabled: true,
    dataRevision: 1,
    uiRevision: 0,
    snapshot: makeSnapshot('before-clear'),
  };

  const coordinator = new WorkspacePersistenceCoordinator(
    repo,
    () => target,
    {
      onSaved: (rev) => savedRevisions.push(rev),
    },
    50,
  );
  coordinator.markHydrated(makeSnapshot('init'), 0, 0);

  // Start an async commit that pauses inside IndexedDB
  const inFlightFlush = coordinator.flush();
  // User edits again while in-flight
  target.dataRevision = 2;
  target.snapshot = makeSnapshot('mid-flight-edit');

  // Trigger Clear All while flush #1 is still awaiting IndexedDB
  const emptySnap = makeEmptySnapshot();
  const clearPromise = coordinator.runExclusiveClear(() => repo.clearAllData(), emptySnap);

  // Scheduled/flush saves while clearing must be blocked
  assert.equal(coordinator.isClearing(), true);
  coordinator.scheduleSave();

  // Release the delayed flush #1 -> clear should wait for #1, fence its callback & loop, then run clear
  releaseInFlightWrite();
  await Promise.all([inFlightFlush, clearPromise]);

  assert.deepEqual(operations, ['commit-start', 'commit-end', 'clear']);
  assert.deepEqual(savedRevisions, []); // Stale onSaved suppressed because clearEpoch invalidated it!
  assert.equal(coordinator.getLastPersistedRevision(), 0);
  assert.equal(coordinator.getLastCommittedSnapshot(), emptySnap);

  // Creating new work after clear succeeds normally
  target.dataRevision = 1;
  target.snapshot = makeSnapshot('post-clear');
  await coordinator.flush();
  assert.deepEqual(savedRevisions, [1]);
  coordinator.dispose();
});

test('runExclusiveClear preserves baseline if clearOperation fails', async () => {
  const initialSnap = makeSnapshot('v0');
  const target = {
    hydrated: true,
    autosaveEnabled: true,
    dataRevision: 0,
    uiRevision: 0,
    snapshot: initialSnap,
  };

  const coordinator = new WorkspacePersistenceCoordinator(makeStubRepo(), () => target, {}, 10);
  coordinator.markHydrated(initialSnap, 3, 2);

  await assert.rejects(
    () =>
      coordinator.runExclusiveClear(
        async () => {
          throw new Error('Disk locked');
        },
        makeEmptySnapshot(),
      ),
    /Disk locked/,
  );

  assert.equal(coordinator.isClearing(), false);
  assert.equal(coordinator.getLastPersistedRevision(), 3);
  assert.equal(coordinator.getLastCommittedSnapshot(), initialSnap);
  coordinator.dispose();
});
