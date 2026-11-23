import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VOICE_SETTINGS,
} from '../data/mockWorkspaceData';
import {
  DB_VERSION,
  IndexedDbWorkspaceRepository,
  STORE_CONVERSATIONS,
  STORE_DELETED,
  STORE_FILES,
  STORE_MESSAGES,
  STORE_OUTBOX,
  STORE_PROJECTS,
  STORE_SETTINGS,
  STORE_TOMBSTONES,
  STORE_VOICE_SESSIONS,
} from './indexedDbStorage';
import { evaluateOwnershipTransition } from './ownershipPolicy';
import { getSettingSyncCategory, isDeviceLocalSetting, isSettingSyncable } from './settingsPolicy';
import type { Conversation, Project, VoiceSessionRecord } from '../types/workspace';

function uniqueDbName(label: string): string {
  return `test_studio_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeProject(id: string, name: string): Project {
  const now = '2026-02-01T10:00:00.000Z';
  return {
    id,
    name,
    description: `${name} desc`,
    framework: 'HTML · CSS · JS',
    createdAt: now,
    updatedAt: now,
    revision: 1,
    ownerUid: null,
    syncStatus: 'local_only',
    entryFileId: `${id}-html`,
    folders: ['src'],
    isSample: false,
    files: [
      {
        id: `${id}-html`,
        name: 'index.html',
        folder: 'src',
        path: 'src/index.html',
        language: 'html',
        content: `<h1>${name}</h1>`,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        ownerUid: null,
        syncStatus: 'local_only',
      },
      {
        id: `${id}-js`,
        name: 'app.js',
        folder: 'src',
        path: 'src/app.js',
        language: 'javascript',
        content: 'console.log("ok");',
        createdAt: now,
        updatedAt: now,
        revision: 1,
        ownerUid: null,
        syncStatus: 'local_only',
      },
    ],
  };
}

function makeConversation(id: string, title: string): Conversation {
  const now = '2026-02-01T11:00:00.000Z';
  return {
    id,
    title,
    kind: 'chat',
    projectId: null,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    ownerUid: null,
    syncStatus: 'local_only',
    isPinned: false,
    summary: 'First prompt',
    isSample: false,
    messages: [
      {
        id: `${id}-m1`,
        role: 'user',
        content: 'First prompt',
        timestamp: '11:00',
        createdAt: now,
        updatedAt: now,
        revision: 1,
        ownerUid: null,
        syncStatus: 'local_only',
        source: 'text',
      },
      {
        id: `${id}-m2`,
        role: 'assistant',
        content: 'First answer',
        timestamp: '11:01',
        createdAt: '2026-02-01T11:01:00.000Z',
        updatedAt: '2026-02-01T11:01:00.000Z',
        revision: 1,
        ownerUid: null,
        syncStatus: 'local_only',
        source: 'text',
      },
    ],
  };
}

function makeVoiceSession(id: string, conversationId: string | null): VoiceSessionRecord {
  return {
    id,
    conversationId,
    model: DEFAULT_MODEL_SETTINGS.liveModel,
    languageMode: 'bilingual',
    status: 'disconnected',
    micPermission: 'granted',
    startedAt: '2026-02-01T12:00:00.000Z',
    endedAt: '2026-02-01T12:01:00.000Z',
    createdAt: '2026-02-01T12:00:00.000Z',
    updatedAt: '2026-02-01T12:01:00.000Z',
    revision: 1,
    ownerUid: null,
    syncStatus: 'local_only',
    durationSeconds: 60,
    errorMessage: null,
    transcriptsSaved: true,
    transcripts: [
      { id: `${id}-c1`, speaker: 'user', text: 'Hello', timestamp: '12:00' },
    ],
    rawAudioStored: false,
  };
}

test('IndexedDbWorkspaceRepository handles CRUD, Trash vs permanent delete tombstones, and settings', async () => {
  const dbName = uniqueDbName('crud');
  const repo = new IndexedDbWorkspaceRepository(dbName);

  const p1 = makeProject('proj-1', 'Alpha App');
  const p2 = makeProject('proj-2', 'Beta App');
  await repo.createProject(p1);
  await repo.createProject(p2);

  // Update file + add new file
  await repo.upsertFile(p1.id, {
    ...p1.files[1],
    content: 'console.log("updated");',
    revision: 2,
  });
  await repo.upsertFile(p1.id, {
    id: 'proj-1-css',
    name: 'style.css',
    folder: 'src',
    path: 'src/style.css',
    language: 'css',
    content: 'body { color: #fff; }',
    createdAt: '2026-02-01T10:05:00.000Z',
    updatedAt: '2026-02-01T10:05:00.000Z',
    revision: 1,
    ownerUid: null,
    syncStatus: 'local_only',
  });

  // Delete one file -> should create file tombstone & outbox delete
  await repo.deleteFile(p1.id, p1.files[0].id);

  // Conversations & messages
  const c1 = makeConversation('conv-1', 'Chat One');
  const c2 = makeConversation('conv-2', 'Chat Two');
  await repo.createConversation(c1);
  await repo.createConversation(c2);

  // Voice sessions
  const v1 = makeVoiceSession('voice-1', c1.id);
  const v2 = makeVoiceSession('voice-2', c2.id);
  await repo.saveVoiceSession(v1);
  await repo.saveVoiceSession(v2);

  // Settings
  await repo.saveSettings({
    voiceSettings: { ...DEFAULT_VOICE_SETTINGS, languageMode: 'bn' },
    modelSettings: { ...DEFAULT_MODEL_SETTINGS, chatModel: 'gemini-2.5-pro' },
    appSettings: { ...DEFAULT_APP_SETTINGS, showLineNumbers: false },
    activeProjectId: p1.id,
    activeConversationId: c1.id,
    activeFileId: p1.files[1].id,
  });

  // Soft delete c1 -> Trash (should NOT create a sync tombstone!)
  await repo.moveConversationToTrash(c1);
  let tombstones = await repo.readTombstones();
  assert.ok(!tombstones.some((t) => t.entityType === 'conversation' && t.entityId === c1.id));

  let loaded = await repo.loadWorkspace();
  assert.equal(loaded.projects.length, 2);
  const loadedP1 = loaded.projects.find((p) => p.id === p1.id)!;
  assert.equal(loadedP1.files.length, 2);
  assert.equal(
    loadedP1.files.find((f) => f.id === p1.files[1].id)?.content,
    'console.log("updated");',
  );
  assert.equal(loaded.conversations.length, 1);
  assert.equal(loaded.deletedConversations.length, 1);
  assert.equal(loaded.deletedConversations[0].id, c1.id);
  assert.equal(loaded.deletedConversations[0].deleted, true);
  assert.equal(loaded.preferences.voiceSettings?.languageMode, 'bn');
  assert.equal(loaded.preferences.modelSettings?.chatModel, 'gemini-2.5-pro');
  assert.equal(loaded.preferences.appSettings?.showLineNumbers, false);

  // Restore c1 -> back to active conversations with messages intact
  await repo.restoreDeletedConversation(loaded.deletedConversations[0]);
  loaded = await repo.loadWorkspace();
  assert.equal(loaded.conversations.length, 2);
  assert.equal(loaded.deletedConversations.length, 0);
  assert.equal(loaded.conversations.find((c) => c.id === c1.id)?.messages.length, 2);
  assert.equal(loaded.conversations.find((c) => c.id === c1.id)?.deleted, false);

  // Permanent delete c2 -> creates conversation + message tombstones and cleans linked voice session v2
  await repo.moveConversationToTrash(c2);
  await repo.permanentlyDeleteConversation(c2.id);

  loaded = await repo.loadWorkspace();
  assert.equal(loaded.conversations.length, 1);
  assert.equal(loaded.deletedConversations.length, 0);
  assert.equal(loaded.voiceSessions.length, 1);
  assert.equal(loaded.voiceSessions[0].id, v1.id);

  tombstones = await repo.readTombstones();
  assert.ok(tombstones.some((t) => t.entityType === 'conversation' && t.entityId === c2.id));
  assert.ok(tombstones.some((t) => t.entityType === 'message' && t.entityId === c2.messages[0].id));
  assert.ok(tombstones.some((t) => t.entityType === 'voice_session' && t.entityId === v2.id));
  assert.ok(tombstones.some((t) => t.entityType === 'file' && t.entityId === p1.files[0].id));

  // Delete project p2 -> deletes project & its files and writes tombstones
  await repo.deleteProject(p2.id);
  tombstones = await repo.readTombstones();
  assert.ok(tombstones.some((t) => t.entityType === 'project' && t.entityId === p2.id));
  assert.ok(tombstones.some((t) => t.entityType === 'file' && t.entityId === p2.files[0].id));

  const outbox = await repo.readOutbox();
  assert.ok(outbox.some((o) => o.entityType === 'project' && o.entityId === p2.id && o.operation === 'delete'));

  const stats = await repo.getStorageStats();
  assert.equal(stats.projectCount, 1);
  assert.equal(stats.conversationCount, 1);
  assert.equal(stats.messageCount, 2);
  assert.ok((stats.tombstoneCount ?? 0) >= 5);
  assert.ok((stats.outboxCount ?? 0) >= 5);
});

test('commitWorkspaceDelta incrementally persists only modified entities without wiping untouched stores', async () => {
  const dbName = uniqueDbName('delta');
  const repo = new IndexedDbWorkspaceRepository(dbName);

  const p1 = makeProject('proj-a', 'Project A');
  const c1 = makeConversation('conv-a', 'Thread A');
  const v1 = makeVoiceSession('voice-a', c1.id);
  const snap1 = {
    projects: [p1],
    conversations: [c1],
    deletedConversations: [],
    voiceSessions: [v1],
    preferences: {
      voiceSettings: DEFAULT_VOICE_SETTINGS,
      modelSettings: DEFAULT_MODEL_SETTINGS,
      appSettings: DEFAULT_APP_SETTINGS,
      activeProjectId: p1.id,
      activeConversationId: c1.id,
      activeFileId: p1.files[0].id,
    },
  };

  await repo.commitWorkspaceDelta(null, snap1);

  // Edit only p1.files[1], leaving c1, v1, and p1.files[0] untouched
  const snap2 = {
    ...snap1,
    projects: [
      {
        ...p1,
        updatedAt: '2026-02-01T12:30:00.000Z',
        revision: 2,
        files: [
          p1.files[0],
          {
            ...p1.files[1],
            content: 'console.log("delta-only");',
            updatedAt: '2026-02-01T12:30:00.000Z',
            revision: 2,
          },
        ],
      },
    ],
  };

  const stats = await repo.commitWorkspaceDelta(snap1, snap2);
  assert.equal(stats.projectCount, 1);
  assert.equal(stats.fileCount, 2);
  assert.equal(stats.conversationCount, 1);
  assert.equal(stats.messageCount, 2);

  const reloaded = await repo.loadWorkspace();
  assert.equal(reloaded.projects[0].files[1].content, 'console.log("delta-only");');
  assert.equal(reloaded.conversations[0].messages.length, 2);
  assert.equal(reloaded.voiceSessions.length, 1);
});

test('v1 -> v3 migration preserves legacy embedded projects, files, messages, and preferences idempotently', async () => {
  const dbName = uniqueDbName('v1_mig');

  // Seed legacy DB at version 1
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' });
      db.createObjectStore('preferences', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction([STORE_PROJECTS, STORE_CONVERSATIONS, 'preferences'], 'readwrite');
      tx.objectStore(STORE_PROJECTS).put({
        id: 'legacy-proj-1',
        name: 'Legacy Notes',
        description: 'V1 embedded project',
        framework: 'HTML · CSS · JS',
        createdAt: '2025-12-01T00:00:00.000Z',
        updatedAt: '2025-12-01T00:00:00.000Z',
        entryFileId: 'legacy-file-1',
        folders: ['src'],
        files: [
          {
            id: 'legacy-file-1',
            name: 'index.html',
            folder: 'src',
            path: 'src/index.html',
            language: 'html',
            content: '<h1>Legacy V1</h1>',
            updatedAt: '2025-12-01T00:00:00.000Z',
          },
        ],
      });
      tx.objectStore(STORE_CONVERSATIONS).put({
        id: 'legacy-conv-1',
        title: 'Legacy Chat',
        kind: 'chat',
        projectId: null,
        createdAt: '2025-12-02T00:00:00.000Z',
        updatedAt: '2025-12-02T00:00:00.000Z',
        isPinned: true,
        summary: 'V1 question',
        messages: [
          {
            id: 'legacy-msg-1',
            role: 'user',
            content: 'V1 question',
            timestamp: '09:00',
            source: 'text',
          },
        ],
      });
      tx.objectStore('preferences').put({
        key: 'appSettings',
        value: { showLineNumbers: false, autosaveEnabled: true, localFirstMode: true },
        updatedAt: '2025-12-02T00:00:00.000Z',
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });

  // Open via Phase 2.5 repository (upgrades v1 -> DB_VERSION 3)
  const repo = new IndexedDbWorkspaceRepository(dbName);
  const firstLoad = await repo.loadWorkspace();
  assert.equal(firstLoad.projects.length, 1);
  assert.equal(firstLoad.projects[0].id, 'legacy-proj-1');
  assert.equal(firstLoad.projects[0].files.length, 1);
  assert.equal(firstLoad.projects[0].files[0].content, '<h1>Legacy V1</h1>');
  assert.equal(firstLoad.projects[0].syncStatus, 'local_only');
  assert.equal(firstLoad.projects[0].revision, 1);

  assert.equal(firstLoad.conversations.length, 1);
  assert.equal(firstLoad.conversations[0].id, 'legacy-conv-1');
  assert.equal(firstLoad.conversations[0].isPinned, true);
  assert.equal(firstLoad.conversations[0].messages[0].content, 'V1 question');
  assert.equal(firstLoad.preferences.appSettings?.showLineNumbers, false);

  // Repeat load is idempotent and DB version is DB_VERSION
  const secondLoad = await repo.loadWorkspace();
  assert.equal(secondLoad.projects[0].id, 'legacy-proj-1');
  assert.equal(secondLoad.conversations[0].messages[0].id, 'legacy-msg-1');

  const rawVersion = await new Promise<number>((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const v = req.result.version;
      assert.ok(req.result.objectStoreNames.contains(STORE_TOMBSTONES));
      assert.ok(req.result.objectStoreNames.contains(STORE_OUTBOX));
      assert.ok(req.result.objectStoreNames.contains(STORE_SETTINGS));
      req.result.close();
      resolve(v);
    };
    req.onerror = () => reject(req.error);
  });
  assert.equal(rawVersion, DB_VERSION);
});

test('v2 -> v3 migration backfills sync metadata without deleting existing records', async () => {
  const dbName = uniqueDbName('v2_mig');

  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(dbName, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      const files = db.createObjectStore(STORE_FILES, { keyPath: 'id' });
      files.createIndex('projectId', 'projectId', { unique: false });
      db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' });
      const msgs = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
      msgs.createIndex('conversationId', 'conversationId', { unique: false });
      db.createObjectStore(STORE_VOICE_SESSIONS, { keyPath: 'id' });
      db.createObjectStore(STORE_DELETED, { keyPath: 'id' });
      db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
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
        'readwrite',
      );
      tx.objectStore(STORE_PROJECTS).put({
        id: 'v2-proj',
        name: 'V2 Project',
        description: 'V2',
        framework: 'HTML · CSS · JS',
        createdAt: '2026-01-10T00:00:00.000Z',
        updatedAt: '2026-01-10T00:00:00.000Z',
        entryFileId: 'v2-file',
        folders: ['src'],
      });
      tx.objectStore(STORE_FILES).put({
        id: 'v2-file',
        projectId: 'v2-proj',
        name: 'index.html',
        folder: 'src',
        path: 'src/index.html',
        language: 'html',
        content: '<p>V2</p>',
        updatedAt: '2026-01-10T00:00:00.000Z',
      });
      tx.objectStore(STORE_CONVERSATIONS).put({
        id: 'v2-conv',
        title: 'V2 Thread',
        kind: 'chat',
        projectId: null,
        createdAt: '2026-01-11T00:00:00.000Z',
        updatedAt: '2026-01-11T00:00:00.000Z',
        isPinned: false,
        summary: 'V2 msg',
      });
      tx.objectStore(STORE_MESSAGES).put({
        id: 'v2-msg',
        conversationId: 'v2-conv',
        orderIndex: 0,
        role: 'user',
        content: 'V2 msg',
        timestamp: '10:00',
        source: 'text',
      });
      tx.objectStore(STORE_DELETED).put({
        id: 'v2-trash',
        title: 'Trashed V2',
        kind: 'chat',
        projectId: null,
        createdAt: '2026-01-09T00:00:00.000Z',
        updatedAt: '2026-01-09T00:00:00.000Z',
        deletedAt: '2026-01-12T00:00:00.000Z',
        isPinned: false,
        summary: 'Old',
        messages: [],
      });
      tx.objectStore(STORE_VOICE_SESSIONS).put({
        id: 'v2-voice',
        conversationId: null,
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        languageMode: 'bilingual',
        status: 'error',
        micPermission: 'denied',
        startedAt: '2026-01-12T00:00:00.000Z',
        durationSeconds: 0,
        errorMessage: 'Denied',
        transcriptsSaved: false,
        transcripts: [],
        rawAudioStored: false,
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });

  const repo = new IndexedDbWorkspaceRepository(dbName);
  const loaded = await repo.loadWorkspace();

  assert.equal(loaded.projects.length, 1);
  assert.equal(loaded.projects[0].id, 'v2-proj');
  assert.equal(loaded.projects[0].revision, 1);
  assert.equal(loaded.projects[0].syncStatus, 'local_only');
  assert.equal(loaded.projects[0].ownerUid, null);
  assert.equal(loaded.projects[0].files[0].content, '<p>V2</p>');
  assert.equal(loaded.projects[0].files[0].revision, 1);

  assert.equal(loaded.conversations[0].id, 'v2-conv');
  assert.equal(loaded.conversations[0].messages[0].content, 'V2 msg');
  assert.equal(loaded.conversations[0].messages[0].syncStatus, 'local_only');
  assert.equal(loaded.deletedConversations[0].id, 'v2-trash');
  assert.equal(loaded.voiceSessions[0].id, 'v2-voice');
  assert.equal(loaded.voiceSessions[0].revision, 1);
});

test('Repair 1: v1 -> v4 migration safely handles missing files, files: null, malformed entries, and mixed projects', async () => {
  const dbName = uniqueDbName('v1_malformed');

  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' });
      db.createObjectStore('preferences', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction([STORE_PROJECTS, STORE_CONVERSATIONS], 'readwrite');
      // 1. Project missing `files` field entirely
      tx.objectStore(STORE_PROJECTS).put({
        id: 'v1-missing-files',
        name: 'No Files Prop',
        description: 'Legacy',
        framework: 'HTML',
        createdAt: '2025-11-01T00:00:00.000Z',
        updatedAt: '2025-11-01T00:00:00.000Z',
        entryFileId: '',
      });
      // 2. Project with files: null
      tx.objectStore(STORE_PROJECTS).put({
        id: 'v1-null-files',
        name: 'Null Files Prop',
        createdAt: '2025-11-02T00:00:00.000Z',
        files: null,
      });
      // 3. Project with null/malformed entries inside files array + 1 valid file
      tx.objectStore(STORE_PROJECTS).put({
        id: 'v1-mixed-files',
        name: 'Mixed Files',
        createdAt: '2025-11-03T00:00:00.000Z',
        files: [
          null,
          { notAnId: 123 },
          { id: 'v1-valid-file', name: 'main.js', content: 'console.log(1);' },
        ],
      });
      // 4. Malformed project record missing id (should be safely skipped, not crash)
      tx.objectStore(STORE_PROJECTS).put({
        id: '',
        name: 'Broken Empty Id',
      });
      // 5. Conversation with malformed messages entries
      tx.objectStore(STORE_CONVERSATIONS).put({
        id: 'v1-conv-mixed',
        title: 'Mixed Chat',
        messages: [null, { content: 'no id' }, { id: 'v1-msg-ok', role: 'user', content: 'Hi' }],
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });

  const repo = new IndexedDbWorkspaceRepository(dbName);
  const loaded = await repo.loadWorkspace();

  assert.equal(loaded.projects.length, 3);
  const missingProj = loaded.projects.find((p) => p.id === 'v1-missing-files')!;
  const nullProj = loaded.projects.find((p) => p.id === 'v1-null-files')!;
  const mixedProj = loaded.projects.find((p) => p.id === 'v1-mixed-files')!;
  assert.deepEqual(missingProj.files, []);
  assert.deepEqual(nullProj.files, []);
  assert.equal(mixedProj.files.length, 1);
  assert.equal(mixedProj.files[0].id, 'v1-valid-file');
  assert.equal(mixedProj.files[0].folder, 'src');
  assert.equal(mixedProj.entryFileId, 'v1-valid-file');

  assert.equal(loaded.conversations.length, 1);
  assert.equal(loaded.conversations[0].messages.length, 1);
  assert.equal(loaded.conversations[0].messages[0].id, 'v1-msg-ok');
});

test('Repair 1: v3 -> v4 schema upgrade preserves user data and upgrades outbox, tombstones, and settings', async () => {
  const dbName = uniqueDbName('v3_to_v4');

  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(dbName, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      const fs = db.createObjectStore(STORE_FILES, { keyPath: 'id' });
      fs.createIndex('projectId', 'projectId');
      db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' });
      const ms = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
      ms.createIndex('conversationId', 'conversationId');
      db.createObjectStore(STORE_VOICE_SESSIONS, { keyPath: 'id' });
      db.createObjectStore(STORE_DELETED, { keyPath: 'id' });
      db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      db.createObjectStore(STORE_TOMBSTONES, { keyPath: 'id' });
      db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(
        [STORE_PROJECTS, STORE_SETTINGS, STORE_TOMBSTONES, STORE_OUTBOX],
        'readwrite',
      );
      tx.objectStore(STORE_PROJECTS).put({
        id: 'v3-proj',
        name: 'V3 App',
        description: '',
        framework: 'HTML',
        createdAt: '2026-01-20T00:00:00.000Z',
        updatedAt: '2026-01-20T00:00:00.000Z',
        revision: 2,
        ownerUid: null,
        syncStatus: 'local_only',
        entryFileId: '',
        folders: ['src'],
      });
      tx.objectStore(STORE_SETTINGS).put({
        key: 'voiceSettings',
        value: { ...DEFAULT_VOICE_SETTINGS, languageMode: 'en' },
        updatedAt: '2026-01-20T00:00:00.000Z',
      });
      tx.objectStore(STORE_TOMBSTONES).put({
        id: 'file:v3-old-file',
        entityType: 'file',
        entityId: 'v3-old-file',
        deletedAt: '2026-01-20T00:00:00.000Z',
        revision: 4,
        ownerUid: null,
        syncStatus: 'local_only',
      });
      tx.objectStore(STORE_OUTBOX).put({
        id: 'project:v3-proj',
        entityType: 'project',
        entityId: 'v3-proj',
        operation: 'upsert',
        revision: 2,
        updatedAt: '2026-01-20T00:00:00.000Z',
        ownerUid: null,
        status: 'pending',
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });

  const repo = new IndexedDbWorkspaceRepository(dbName);
  const loaded = await repo.loadWorkspace();
  assert.equal(loaded.projects[0].id, 'v3-proj');
  assert.equal(loaded.preferences.voiceSettings?.languageMode, 'en');
  assert.equal(loaded.preferences.settingRevisions?.voiceSettings, 1);

  const tombstones = await repo.readTombstones();
  assert.equal(tombstones[0].acknowledgedAt, null);
  assert.equal(tombstones[0].revision, 4);

  const outbox = await repo.readOutbox();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].id, 'local:project:v3-proj');
  assert.ok(outbox[0].operationId.startsWith('op-'));
  assert.equal(outbox[0].retryCount, 0);
});

test('Repair 3: direct repository deletes increment existing revisions cleanly and no-op for missing records', async () => {
  const dbName = uniqueDbName('direct_delete_revs');
  const repo = new IndexedDbWorkspaceRepository(dbName);

  const p = makeProject('proj-rev', 'Rev Project');
  p.revision = 5;
  p.files[0].revision = 10;
  p.files[1].revision = 1;
  await repo.createProject(p);

  const conv = makeConversation('conv-rev', 'Rev Conv');
  conv.revision = 5;
  conv.messages[0].revision = 3;
  conv.messages[1].revision = 7;
  await repo.createConversation(conv);

  const vs = makeVoiceSession('vs-rev', conv.id);
  vs.revision = 4;
  await repo.saveVoiceSession(vs);

  // Delete file at rev 10 -> tombstone & outbox must have rev 11, baseRevision 10
  await repo.deleteFile(p.id, p.files[0].id);
  // Deleting nonexistent file must NOT create fake revision:1 tombstone
  await repo.deleteFile(p.id, 'does-not-exist-file');

  // Remove message[0] via saveMessages -> message[0] deleted at rev 3+1=4
  await repo.saveMessages(conv.id, [conv.messages[1]]);

  // Delete remaining project -> project rev 5+1=6, remaining file rev 1+1=2
  await repo.deleteProject(p.id, [p.files[1].id]);

  // Permanently delete conversation -> conv rev 5+1=6, msg[1] rev 7+1=8, voice rev 4+1=5
  await repo.permanentlyDeleteConversation(conv.id, [vs.id]);

  const tombstones = await repo.readTombstones();
  const findTomb = (type: string, id: string) =>
    tombstones.find((t) => t.entityType === type && t.entityId === id);

  assert.equal(findTomb('file', p.files[0].id)?.revision, 11);
  assert.equal(findTomb('file', 'does-not-exist-file'), undefined);
  assert.equal(findTomb('file', p.files[1].id)?.revision, 2);
  assert.equal(findTomb('project', p.id)?.revision, 6);
  assert.equal(findTomb('message', conv.messages[0].id)?.revision, 4);
  assert.equal(findTomb('message', conv.messages[1].id)?.revision, 8);
  assert.equal(findTomb('conversation', conv.id)?.revision, 6);
  assert.equal(findTomb('voice_session', vs.id)?.revision, 5);

  const outbox = await repo.readOutbox();
  const file0Out = outbox.find((o) => o.entityId === p.files[0].id)!;
  assert.equal(file0Out.operation, 'delete');
  assert.equal(file0Out.revision, 11);
  assert.equal(file0Out.baseRevision, 10);
});

test('Repair 4: full outbox lifecycle, concurrent worker leasing, lease recovery, backoff, stale-ack rejection, ordering, and tombstone pruning', async () => {
  const dbName = uniqueDbName('outbox_lifecycle');
  const repo = new IndexedDbWorkspaceRepository(dbName);

  const p1 = makeProject('proj-sync-1', 'Sync App');
  await repo.createProject(p1);

  // Worker 1 claims operations
  const t0 = '2026-03-01T10:00:00.000Z';
  const claimedW1 = await repo.claimOutboxOperations({
    workerId: 'worker-1',
    ownerUid: null,
    limit: 10,
    leaseDurationMs: 10_000,
    nowIso: t0,
  });
  assert.equal(claimedW1.length, 3); // project + 2 files

  // Worker 2 attempting to claim while leases active gets 0
  const claimedW2 = await repo.claimOutboxOperations({
    workerId: 'worker-2',
    ownerUid: null,
    limit: 10,
    leaseDurationMs: 10_000,
    nowIso: '2026-03-01T10:00:05.000Z',
  });
  assert.equal(claimedW2.length, 0);

  // Simulate Worker 1 crash -> lease expires at 10:00:10; recover at 10:00:15
  const recovered = await repo.recoverExpiredOutboxLeases({
    ownerUid: null,
    nowIso: '2026-03-01T10:00:15.000Z',
  });
  assert.equal(recovered, 3);

  // Worker 2 re-claims
  const reclaimed = await repo.claimOutboxOperations({
    workerId: 'worker-2',
    ownerUid: null,
    limit: 10,
    leaseDurationMs: 10_000,
    nowIso: '2026-03-01T10:00:16.000Z',
  });
  assert.equal(reclaimed.length, 3);

  // Simulate mid-flight local edit on project p1 BEFORE Worker 2 finishes uploading op1!
  const projClaimed = reclaimed.find((o) => o.entityId === p1.id)!;
  await repo.updateProject({
    ...p1,
    name: 'Sync App Edited Mid-Flight',
    revision: 2,
    updatedAt: '2026-03-01T10:00:17.000Z',
  });

  // Worker 2 tries to ack the OLD operationId for p1 + valid operationId for file[0]
  const file0Claimed = reclaimed.find((o) => o.entityId === p1.files[0].id)!;
  const ackRes = await repo.acknowledgeOutboxOperations(
    [
      { id: projClaimed.id, operationId: projClaimed.operationId },
      { id: file0Claimed.id, operationId: file0Claimed.operationId },
    ],
    { ownerUid: null, nowIso: '2026-03-01T10:00:18.000Z' },
  );
  // Stale operationId for edited project MUST be rejected; file[0] MUST be acknowledged
  assert.deepEqual(ackRes.skippedIds, [projClaimed.id]);
  assert.deepEqual(ackRes.acknowledgedIds, [file0Claimed.id]);

  // Verify outbox still holds pending revision=2 upsert for p1
  const outboxAfterAck = await repo.readOutbox({ ownerUid: null });
  const p1Out = outboxAfterAck.find((o) => o.entityId === p1.id)!;
  assert.equal(p1Out.revision, 2);
  assert.equal(p1Out.status, 'pending');

  // Verify ordering invariant: attempting an older revision=1 upsert MUST NOT overwrite revision=2!
  await repo.updateProject({
    ...p1,
    name: 'Stale Write Should Not Downgrade Outbox',
    revision: 1,
    updatedAt: '2026-03-01T10:00:18.000Z',
  });
  const outboxAfterStale = await repo.readOutbox({ ownerUid: null });
  assert.equal(outboxAfterStale.find((o) => o.entityId === p1.id)?.revision, 2);

  // Mark file[1] failed -> schedules retry backoff
  const file1Claimed = reclaimed.find((o) => o.entityId === p1.files[1].id)!;
  const failedRow = await repo.markOutboxOperationFailed(
    { id: file1Claimed.id, operationId: file1Claimed.operationId, ownerUid: null },
    'Network timeout',
    { backoffMs: 5000, nowIso: '2026-03-01T10:00:19.000Z' },
  );
  assert.equal(failedRow?.status, 'failed');
  assert.equal(failedRow?.retryCount, 1);
  assert.equal(failedRow?.nextRetryAt, '2026-03-01T10:00:24.000Z');

  // Before backoff window passes, readPendingOutbox excludes file[1]
  const pendingBeforeBackoff = await repo.readPendingOutbox({
    ownerUid: null,
    nowIso: '2026-03-01T10:00:20.000Z',
  });
  assert.ok(!pendingBeforeBackoff.some((o) => o.entityId === p1.files[1].id));

  // After backoff window passes, file[1] is retry-ready
  const pendingAfterBackoff = await repo.readPendingOutbox({
    ownerUid: null,
    nowIso: '2026-03-01T10:00:25.000Z',
  });
  assert.ok(pendingAfterBackoff.some((o) => o.entityId === p1.files[1].id));

  // Delete file[0] -> tombstone created with acknowledgedAt: null -> cannot be pruned yet
  await repo.deleteFile(p1.id, p1.files[0].id);
  const prunedBeforeAck = await repo.pruneAcknowledgedTombstones('2099-01-01T00:00:00.000Z', {
    ownerUid: null,
  });
  assert.equal(prunedBeforeAck, 0);
  assert.equal((await repo.readTombstones({ ownerUid: null })).length, 1);

  // Claim & ack delete op -> tombstone gets acknowledgedAt and synced status
  const delClaims = await repo.claimOutboxOperations({
    workerId: 'worker-del',
    ownerUid: null,
    nowIso: '2026-03-01T10:01:00.000Z',
  });
  const delFileOp = delClaims.find(
    (o) => o.entityType === 'file' && o.entityId === p1.files[0].id && o.operation === 'delete',
  )!;
  await repo.acknowledgeOutboxOperations([{ id: delFileOp.id, operationId: delFileOp.operationId }], {
    ownerUid: null,
    nowIso: '2026-03-01T10:01:02.000Z',
  });

  const diagBeforePrune = await repo.getOutboxDiagnostics({ ownerUid: null });
  assert.equal(diagBeforePrune.acknowledgedTombstoneCount, 1);
  assert.equal(diagBeforePrune.unacknowledgedTombstoneCount, 0);

  // Prune older than 10:01:01 -> 0 (not old enough), older than 10:01:05 -> 1
  assert.equal(
    await repo.pruneAcknowledgedTombstones('2026-03-01T10:01:01.000Z', { ownerUid: null }),
    0,
  );
  assert.equal(
    await repo.pruneAcknowledgedTombstones('2026-03-01T10:01:05.000Z', { ownerUid: null }),
    1,
  );
});

test('Repair 5: account ownership isolation, pause-sync guard, explicit transactional claim, and collision strategies', async () => {
  const dbName = uniqueDbName('ownership_isolation');
  const repo = new IndexedDbWorkspaceRepository(dbName);

  // 1. Account A writes data
  const projA = makeProject('proj-a', 'Account A App');
  projA.ownerUid = 'uid-a';
  projA.files.forEach((f) => (f.ownerUid = 'uid-a'));
  await repo.createProject(projA);
  await repo.saveSettings(
    { voiceSettings: { ...DEFAULT_VOICE_SETTINGS, languageMode: 'bn' } },
    ['voiceSettings'],
    { ownerUid: 'uid-a' },
  );

  // 2. Unclaimed local (null) writes data
  const projLocal = makeProject('proj-local', 'Unclaimed App');
  await repo.createProject(projLocal);
  await repo.saveSettings(
    { modelSettings: { ...DEFAULT_MODEL_SETTINGS, chatModel: 'gemini-2.5-pro' } },
    ['modelSettings'],
    { ownerUid: null },
  );

  // Account A view excludes null-owned data (never auto-claimed on sign-in!)
  const loadedA = await repo.loadWorkspace({ activeOwnerUid: 'uid-a' });
  assert.deepEqual(
    loadedA.projects.map((p) => p.id),
    ['proj-a'],
  );
  assert.equal(loadedA.preferences.voiceSettings?.languageMode, 'bn');
  assert.equal(loadedA.preferences.modelSettings, undefined);

  // Account B sees ZERO records from Account A or unclaimed local
  const loadedB = await repo.loadWorkspace({ activeOwnerUid: 'uid-b' });
  assert.equal(loadedB.projects.length, 0);
  assert.equal((await repo.readOutbox({ ownerUid: 'uid-b' })).length, 0);

  // Signed-out (null) sees only unclaimed local, never Account A's data
  const loadedSignedOut = await repo.loadWorkspace({ activeOwnerUid: null });
  assert.deepEqual(
    loadedSignedOut.projects.map((p) => p.id),
    ['proj-local'],
  );
  assert.equal(loadedSignedOut.preferences.voiceSettings, undefined);

  // Ownership transition policy must pause sync when unclaimed local data exists or switching accounts
  const summaryForA = await repo.getOwnershipSummary('uid-a');
  assert.ok(summaryForA.unclaimedCount >= 4); // proj-local + 2 files + modelSettings
  const pauseUnclaimed = evaluateOwnershipTransition({
    previousAccountUid: null,
    nextAccountUid: 'uid-a',
    summary: summaryForA,
  });
  assert.equal(pauseUnclaimed.action, 'pause_sync_for_ownership_verification');
  assert.equal(pauseUnclaimed.syncAllowed, false);

  const pauseSwitch = evaluateOwnershipTransition({
    previousAccountUid: 'uid-a',
    nextAccountUid: 'uid-b',
    summary: await repo.getOwnershipSummary('uid-b'),
  });
  assert.equal(pauseSwitch.action, 'pause_sync_for_ownership_verification');
  assert.equal(pauseSwitch.pauseReason, 'account_switched');

  // Collision strategy 'abort_on_collision' aborts cleanly without mutating records
  await assert.rejects(
    () =>
      repo.claimUnclaimedLocalData('uid-b', {
        strategy: 'abort_on_collision',
        existingTargetIds: { projects: ['proj-local'] },
      }),
    /aborted due to ID collision/i,
  );
  // proj-local must STILL be unclaimed (ownerUid: null)
  assert.equal((await repo.loadWorkspace({ activeOwnerUid: null })).projects.length, 1);
  assert.equal((await repo.loadWorkspace({ activeOwnerUid: 'uid-b' })).projects.length, 0);

  // Collision strategy 'remap_colliding_ids' remaps proj-local and moves ownership to uid-b, leaving uid-a untouched
  const claimRes = await repo.claimUnclaimedLocalData('uid-b', {
    strategy: 'remap_colliding_ids',
    existingTargetIds: { projects: ['proj-local'] },
  });
  assert.ok(claimRes.claimedCount >= 4);
  const newProjId = claimRes.remappedProjectIds['proj-local'];
  assert.ok(newProjId && newProjId !== 'proj-local');

  const postClaimB = await repo.loadWorkspace({ activeOwnerUid: 'uid-b' });
  assert.deepEqual(
    postClaimB.projects.map((p) => p.id),
    [newProjId],
  );
  assert.equal(postClaimB.projects[0].files.length, 2);
  assert.equal(postClaimB.preferences.modelSettings?.chatModel, 'gemini-2.5-pro');

  // Account A remains completely untouched and isolated!
  const postClaimA = await repo.loadWorkspace({ activeOwnerUid: 'uid-a' });
  assert.deepEqual(
    postClaimA.projects.map((p) => p.id),
    ['proj-a'],
  );
  assert.equal((await repo.loadWorkspace({ activeOwnerUid: null })).projects.length, 0);
});

test('Repair 9: settings sync policy isolates device_local pointers from sync_outbox while queueing account_syncable preferences', async () => {
  assert.equal(getSettingSyncCategory('activeProjectId'), 'device_local');
  assert.equal(getSettingSyncCategory('activeConversationId'), 'device_local');
  assert.equal(getSettingSyncCategory('activeFileId'), 'device_local');
  assert.equal(isDeviceLocalSetting('activeFileId'), true);
  assert.equal(isSettingSyncable('voiceSettings'), true);
  assert.equal(isSettingSyncable('modelSettings'), true);
  assert.equal(isSettingSyncable('appSettings'), true);

  const dbName = uniqueDbName('settings_policy');
  const repo = new IndexedDbWorkspaceRepository(dbName);

  // Saving only device-local pointers must NOT generate any outbox records
  await repo.saveSettings(
    {
      activeProjectId: 'p-1',
      activeConversationId: 'c-1',
      activeFileId: 'f-1',
    },
    ['activeProjectId', 'activeConversationId', 'activeFileId'],
  );
  assert.equal((await repo.readOutbox()).length, 0);

  // Saving account_syncable settings must generate setting outbox ops with incrementing revisions
  await repo.saveSettings(
    {
      voiceSettings: { ...DEFAULT_VOICE_SETTINGS, languageMode: 'en', saveRawAudio: true },
    },
    ['voiceSettings'],
  );
  let outbox = await repo.readOutbox();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].entityType, 'setting');
  assert.equal(outbox[0].entityId, 'voiceSettings');
  assert.equal(outbox[0].revision, 1);

  await repo.saveSettings(
    {
      voiceSettings: { ...DEFAULT_VOICE_SETTINGS, languageMode: 'bn', saveRawAudio: true },
    },
    ['voiceSettings'],
  );
  outbox = await repo.readOutbox();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].revision, 2);
  assert.equal(outbox[0].baseRevision, 1);

  const loaded = await repo.loadWorkspace();
  assert.equal(loaded.preferences.activeFileId, 'f-1');
  assert.equal(loaded.preferences.voiceSettings?.languageMode, 'bn');
  assert.equal(loaded.preferences.voiceSettings?.saveRawAudio, false);
  assert.equal(loaded.preferences.settingRevisions?.voiceSettings, 2);
});

test('Phase 3: applyRemoteSyncChanges avoids outbox echo and deleteAccountLocalData isolates other scopes', async () => {
  const dbName = uniqueDbName('remote_apply_delete');
  const repo = new IndexedDbWorkspaceRepository(dbName);

  // Local-only project
  const localOnlyProj = makeProject('proj-local-only', 'Device Only');
  await repo.commitWorkspaceDelta(
    null,
    {
      projects: [localOnlyProj],
      conversations: [],
      deletedConversations: [],
      voiceSessions: [],
      preferences: {},
    },
    { ownerUid: null },
  );

  // Pull remote project for uid-1 -> must NOT enqueue outbox echo
  const remoteProj = makeProject('proj-cloud-1', 'From Cloud');
  remoteProj.ownerUid = 'uid-1';
  remoteProj.syncStatus = 'synced';
  remoteProj.files = remoteProj.files.map((f) => ({
    ...f,
    ownerUid: 'uid-1',
    syncStatus: 'synced',
  }));

  await repo.applyRemoteSyncChanges({
    ownerUid: 'uid-1',
    upsertProjects: [remoteProj],
    upsertFiles: remoteProj.files.map((file) => ({ projectId: remoteProj.id, file })),
    upsertSettings: [
      {
        key: 'voiceSettings',
        value: { ...DEFAULT_VOICE_SETTINGS, voiceName: 'Kore' },
        revision: 4,
        updatedAt: '2026-02-02T12:00:00.000Z',
      },
    ],
  });

  assert.equal((await repo.readOutbox({ ownerUid: 'uid-1' })).length, 0);
  const loadedUid1 = await repo.loadWorkspace({ activeOwnerUid: 'uid-1' });
  assert.equal(loadedUid1.projects.length, 1);
  assert.equal(loadedUid1.projects[0].files.length, 2);
  assert.equal(loadedUid1.preferences.voiceSettings?.voiceName, 'Kore');
  assert.equal(loadedUid1.preferences.settingRevisions?.voiceSettings, 4);

  // Deleting account local data for uid-1 leaves local-only scope untouched!
  await repo.deleteAccountLocalData('uid-1');
  const afterDeleteUid1 = await repo.loadWorkspace({ activeOwnerUid: 'uid-1' });
  assert.equal(afterDeleteUid1.projects.length, 0);

  const localOnlyAfter = await repo.loadWorkspace({ activeOwnerUid: null });
  assert.equal(localOnlyAfter.projects.length, 1);
  assert.equal(localOnlyAfter.projects[0].id, 'proj-local-only');
});




test('v4 to v5 migration purges conflict copies and deleted conversations with remote tombstones', async () => {
  const dbName = uniqueDbName('tombstone_migration');
  const legacyRequest = indexedDB.open(dbName, DB_VERSION - 1);

  await new Promise<void>((resolve, reject) => {
    legacyRequest.onupgradeneeded = () => {
      const db = legacyRequest.result;
      db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' });
      db.createObjectStore(STORE_DELETED, { keyPath: 'id' });
      db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
    };
    legacyRequest.onerror = () => reject(legacyRequest.error);
    legacyRequest.onsuccess = () => {
      const db = legacyRequest.result;
      const tx = db.transaction([STORE_CONVERSATIONS, STORE_DELETED, STORE_MESSAGES], 'readwrite');
      tx.objectStore(STORE_CONVERSATIONS).put({
        id: 'legacy-conflict-copy',
        title: 'Original Chat (Conflict Copy)',
        kind: 'chat',
        projectId: null,
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt: '2026-02-01T11:00:00.000Z',
        isPinned: false,
        revision: 2,
        ownerUid: 'uid-1',
        syncStatus: 'pending',
        summary: '',
        messages: [],
      });
      tx.objectStore(STORE_DELETED).put({
        id: 'legacy-deleted-flag',
        title: 'Already Deleted',
        kind: 'chat',
        projectId: null,
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt: '2026-02-01T11:00:00.000Z',
        deleted: true,
        isPinned: false,
        revision: 1,
        ownerUid: 'uid-1',
        syncStatus: 'pending',
        summary: '',
        messages: [],
      });
      tx.objectStore(STORE_MESSAGES).put({
        id: 'legacy-conflict-message',
        conversationId: 'legacy-conflict-copy',
        orderIndex: 0,
        role: 'user',
        content: 'Legacy conflict message',
        timestamp: '10:00',
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt: '2026-02-01T10:00:00.000Z',
        revision: 1,
        ownerUid: 'uid-1',
        syncStatus: 'pending',
        source: 'text',
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });

  const repo = new IndexedDbWorkspaceRepository(dbName);
  const snapshot = await repo.loadWorkspace();
  assert.equal(snapshot.conversations.length, 0);
  assert.equal(snapshot.deletedConversations.length, 0);

  const tombstones = await repo.readTombstones({ ownerUid: 'uid-1' });
  assert.ok(tombstones.some((row) => row.entityType === 'conversation' && row.entityId === 'legacy-conflict-copy'));
  assert.ok(tombstones.some((row) => row.entityType === 'conversation' && row.entityId === 'legacy-deleted-flag'));
  assert.ok(tombstones.some((row) => row.entityType === 'message' && row.entityId === 'legacy-conflict-message'));

  const outbox = await repo.readOutbox({ ownerUid: 'uid-1' });
  assert.ok(outbox.some((row) => row.entityType === 'conversation' && row.entityId === 'legacy-conflict-copy' && row.operation === 'delete'));
  assert.ok(outbox.some((row) => row.entityType === 'conversation' && row.entityId === 'legacy-deleted-flag' && row.operation === 'delete'));
});
