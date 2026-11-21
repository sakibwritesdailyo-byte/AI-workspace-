import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VOICE_SETTINGS,
  SAMPLE_CONVERSATIONS,
  SAMPLE_PROJECTS,
} from '../data/mockWorkspaceData';
import { buildWorkspaceExportBundle, validateAndInspectImportBundle } from '../services/backupService';
import { computeWorkspaceDelta } from '../services/workspaceRepository';
import { validatePreviewMessage } from '../utils/previewSecurity';
import {
  applyImportWorkspaceBundle,
  assemblePreviewDocument,
  createInitialWorkspaceState,
  getActiveProject,
  getProjectFolders,
  sortAndFilterConversations,
  validateProjectFilePath,
  workspaceReducer,
} from './workspaceReducer';

test('initial state keeps sample data separate from real user projects and conversations', () => {
  const state = createInitialWorkspaceState();
  assert.equal(state.projects.length, 0);
  assert.equal(state.conversations.length, 0);
  assert.ok(SAMPLE_PROJECTS.length > 0);
  assert.ok(SAMPLE_CONVERSATIONS.length > 0);
});

test('conversation CRUD, honest chat send/failure, and RETRY_CHAT_REQUEST loading state (BUG-08)', () => {
  let state = createInitialWorkspaceState();

  state = workspaceReducer(state, { type: 'CREATE_CONVERSATION', title: 'Alpha Thread' });
  state = workspaceReducer(state, { type: 'SEND_USER_MESSAGE', text: 'First message' });
  assert.equal(state.chatSending, true);
  const alphaId = state.activeConversationId!;

  // Simulate honest backend unavailable failure (must NOT invent fake assistant reply)
  state = workspaceReducer(state, {
    type: 'CHAT_RESPONSE_FAILED',
    kind: 'backend_unavailable',
    message: 'No live handler at /api/chat.',
  });
  assert.equal(state.chatSending, false);
  assert.equal(state.chatNotice?.kind, 'backend_unavailable');
  assert.equal(state.conversations.find((c) => c.id === alphaId)?.messages.length, 1);

  // Retry clears notice and sets chatSending back to true
  state = workspaceReducer(state, { type: 'RETRY_CHAT_REQUEST' });
  assert.equal(state.chatSending, true);
  assert.equal(state.chatNotice, null);

  // Simulate real assistant reply received
  state = workspaceReducer(state, {
    type: 'CHAT_RESPONSE_RECEIVED',
    conversationId: alphaId,
    reply: 'Real server reply',
  });
  assert.equal(state.chatSending, false);
  assert.equal(state.conversations.find((c) => c.id === alphaId)?.messages.length, 2);

  state = workspaceReducer(state, { type: 'CREATE_CONVERSATION', title: 'Beta Thread' });
  state = workspaceReducer(state, { type: 'SEND_USER_MESSAGE', text: 'Second message' });
  const betaId = state.activeConversationId!;

  // Rename Alpha and Pin Alpha
  state = workspaceReducer(state, {
    type: 'RENAME_CONVERSATION',
    conversationId: alphaId,
    title: 'Alpha Renamed',
  });
  state = workspaceReducer(state, {
    type: 'TOGGLE_PIN_CONVERSATION',
    conversationId: alphaId,
  });

  const sorted = sortAndFilterConversations(state.conversations, 'all', '');
  assert.equal(sorted[0].id, alphaId);
  assert.equal(sorted[0].title, 'Alpha Renamed');
  assert.equal(sorted[0].isPinned, true);

  // Clear Chat clears only active (Beta), leaving Alpha intact
  state = workspaceReducer(state, { type: 'CLEAR_ACTIVE_CONVERSATION' });
  assert.equal(state.conversations.find((c) => c.id === betaId)?.messages.length, 0);
  assert.equal(state.conversations.find((c) => c.id === alphaId)?.messages.length, 2);

  // Delete Beta -> moves to deletedConversations -> restore Beta
  state = workspaceReducer(state, { type: 'DELETE_CONVERSATION', conversationId: betaId });
  assert.equal(state.conversations.length, 1);
  assert.equal(state.deletedConversations.length, 1);

  state = workspaceReducer(state, {
    type: 'RESTORE_DELETED_CONVERSATION',
    conversationId: betaId,
  });
  assert.equal(state.conversations.length, 2);
  assert.equal(state.deletedConversations.length, 0);

  // Bulk select & delete both
  state = workspaceReducer(state, {
    type: 'SELECT_ALL_CONVERSATIONS',
    conversationIds: [alphaId, betaId],
  });
  state = workspaceReducer(state, { type: 'BULK_DELETE_CONVERSATIONS' });
  assert.equal(state.conversations.length, 0);
  assert.equal(state.deletedConversations.length, 2);
});

test('project CRUD: create, rename, duplicate, nested folder CRUD, and preview document assembly', () => {
  let state = createInitialWorkspaceState();
  state = workspaceReducer(state, { type: 'CREATE_PROJECT', name: 'Personal Notes' });
  const projId = state.activeProjectId!;
  assert.equal(state.projects.length, 1);

  // Rename project
  state = workspaceReducer(state, {
    type: 'RENAME_PROJECT',
    projectId: projId,
    name: 'Personal Notes v2',
  });
  assert.equal(getActiveProject(state)?.name, 'Personal Notes v2');

  // Create nested folder and file inside it
  state = workspaceReducer(state, { type: 'CREATE_FOLDER', folderPath: 'src/utils/helpers' });
  state = workspaceReducer(state, {
    type: 'CREATE_FILE',
    folder: 'src/utils/helpers',
    name: 'format.js',
  });
  let active = getActiveProject(state)!;
  assert.ok(getProjectFolders(active).includes('src/utils/helpers'));
  assert.ok(active.files.some((f) => f.path === 'src/utils/helpers/format.js'));

  // Rename nested folder
  state = workspaceReducer(state, {
    type: 'RENAME_FOLDER',
    oldPath: 'src/utils',
    newPath: 'src/lib',
  });
  active = getActiveProject(state)!;
  assert.ok(getProjectFolders(active).includes('src/lib/helpers'));
  assert.ok(active.files.some((f) => f.path === 'src/lib/helpers/format.js'));

  // Duplicate project creates new independent IDs
  state = workspaceReducer(state, { type: 'DUPLICATE_PROJECT', projectId: projId });
  assert.equal(state.projects.length, 2);
  assert.notEqual(state.projects[0].id, state.projects[1].id);
  assert.equal(state.projects[0].name, 'Personal Notes v2 (Copy)');

  // Delete folder removes nested files on original project
  state = workspaceReducer(state, { type: 'SELECT_PROJECT', projectId: projId });
  state = workspaceReducer(state, { type: 'DELETE_FOLDER', folderPath: 'src/lib' });
  active = getActiveProject(state)!;
  assert.ok(!active.files.some((f) => f.folder.startsWith('src/lib')));

  // Deleting last non-empty folder sets informative workspaceNotice instead of silent no-op
  state = workspaceReducer(state, { type: 'DELETE_FOLDER', folderPath: 'src' });
  assert.match(state.workspaceNotice || '', /keep at least one file/i);

  // Preview document contains real project content
  const html = assemblePreviewDocument(active, 'chan-1');
  assert.ok(html.includes('Personal Notes'));
  assert.ok(html.includes('window.parent.postMessage'));
});

test('BUG-02: dirtyFileIds stays dirty when a newer edit occurs during an in-flight save', () => {
  let state = createInitialWorkspaceState();
  state = workspaceReducer(state, { type: 'CREATE_PROJECT', name: 'Concurrent Edit Test' });
  const fileId = state.activeFileId!;
  const saveStartedRev = state.dataRevision;

  // Edit #1
  state = workspaceReducer(state, {
    type: 'UPDATE_FILE_CONTENT',
    fileId,
    content: 'v1',
  });
  const rev1 = state.dataRevision;
  assert.ok(state.dirtyFileIds.includes(fileId));

  // Edit #2 happens while rev1 is in flight
  state = workspaceReducer(state, {
    type: 'UPDATE_FILE_CONTENT',
    fileId,
    content: 'v2',
  });
  const rev2 = state.dataRevision;
  assert.ok(rev2 > rev1);
  assert.ok(rev1 > saveStartedRev);

  // Confirm rev1 finished saving -> file must remain dirty because rev2 > rev1
  state = workspaceReducer(state, {
    type: 'SET_SAVE_STATUS',
    status: 'saved',
    persistedRevision: rev1,
    savedAt: '2026-02-01T10:00:00.000Z',
  });
  assert.ok(state.dirtyFileIds.includes(fileId));
  assert.equal(state.saveStatus, 'unsaved');

  // Confirm rev2 finished saving -> now dirtyFileIds clears and status is saved
  state = workspaceReducer(state, {
    type: 'SET_SAVE_STATUS',
    status: 'saved',
    persistedRevision: rev2,
    savedAt: '2026-02-01T10:00:01.000Z',
  });
  assert.equal(state.dirtyFileIds.length, 0);
  assert.equal(state.saveStatus, 'saved');
});

test('BUG-03: duplicate and invalid file paths are rejected case-insensitively within folders', () => {
  let state = createInitialWorkspaceState();
  state = workspaceReducer(state, { type: 'CREATE_PROJECT', name: 'Path Validation' });
  const project = getActiveProject(state)!;
  const htmlFile = project.files.find((f) => f.name === 'index.html')!;

  // Duplicate in same folder (exact and different case)
  const dupExact = validateProjectFilePath(project, 'src', 'index.html');
  assert.equal(dupExact.ok, false);

  const dupCase = validateProjectFilePath(project, 'src', 'INDEX.HTML');
  assert.equal(dupCase.ok, false);

  // Same filename in a DIFFERENT folder is allowed
  const diffFolder = validateProjectFilePath(project, 'src/pages', 'index.html');
  assert.equal(diffFolder.ok, true);

  // Invalid characters / path traversal / slashes rejected
  assert.equal(validateProjectFilePath(project, 'src/../etc', 'bad.js').ok, false);
  assert.equal(validateProjectFilePath(project, 'src', 'sub/file.js').ok, false);
  assert.equal(validateProjectFilePath(project, 'src', '').ok, false);

  // Self-rename casing change allowed
  assert.equal(validateProjectFilePath(project, 'src', 'Index.html', htmlFile.id).ok, true);

  // Reducer guards CREATE_FILE duplicate
  const countBefore = getActiveProject(state)!.files.length;
  state = workspaceReducer(state, { type: 'CREATE_FILE', folder: 'src', name: 'INDEX.HTML' });
  assert.equal(getActiveProject(state)!.files.length, countBefore);
  assert.match(state.workspaceNotice || '', /already exists/i);

  // Reducer guards RENAME_FILE into existing sibling path
  const cssFile = getActiveProject(state)!.files.find((f) => f.name === 'styles.css')!;
  state = workspaceReducer(state, {
    type: 'RENAME_FILE',
    fileId: cssFile.id,
    newName: 'index.html',
  });
  assert.equal(getActiveProject(state)!.files.find((f) => f.id === cssFile.id)?.name, 'styles.css');
  assert.match(state.workspaceNotice || '', /already exists/i);

  // Reducer guards RENAME_FOLDER when target merges into conflicting file path
  state = workspaceReducer(state, { type: 'CREATE_FILE', folder: 'alt', name: 'styles.css' });
  state = workspaceReducer(state, { type: 'RENAME_FOLDER', oldPath: 'alt', newPath: 'src' });
  assert.match(state.workspaceNotice || '', /collide/i);
});

test('BUG-04: assemblePreviewDocument isolates closing script/style tags safely and validatePreviewMessage verifies source/origin/channel', () => {
  const project = {
    id: 'proj-sec',
    name: 'Security Preview',
    description: 'Testing script payload safety',
    framework: 'HTML · CSS · JS',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    entryFileId: 'f-html',
    folders: ['src'],
    files: [
      {
        id: 'f-html',
        name: 'index.html',
        folder: 'src',
        path: 'src/index.html',
        language: 'html' as const,
        content: '<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
      {
        id: 'f-css',
        name: 'main.css',
        folder: 'src',
        path: 'src/main.css',
        language: 'css' as const,
        content: 'body::after { content: "</style><script>alert(1)</script>"; }',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
      {
        id: 'f-js',
        name: 'app.js',
        folder: 'src',
        path: 'src/app.js',
        language: 'javascript' as const,
        content: 'function render() { return "<div></script></ScRiPt></div>"; }\n// comment </script>',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
    ],
  };

  const doc = assemblePreviewDocument(project, 'chan-sec-1');

  // Verify raw `</script>` or `</style>` from user code does NOT appear unescaped inside <script> payload tags
  const cssPayloadMatch = doc.match(/<script id="__studio_css_payload" type="application\/json">([\s\S]*?)<\/script>/);
  const jsPayloadMatch = doc.match(/<script id="__studio_js_payload" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(cssPayloadMatch, 'CSS payload script present');
  assert.ok(jsPayloadMatch, 'JS payload script present');
  assert.ok(!cssPayloadMatch![1].includes('</style>'));
  assert.ok(!jsPayloadMatch![1].includes('</script>'));
  assert.ok(!jsPayloadMatch![1].includes('</ScRiPt>'));

  // Parsing the JSON payload restores the EXACT original JS & CSS intact without syntax corruption
  assert.equal(
    JSON.parse(jsPayloadMatch![1]),
    'function render() { return "<div></script></ScRiPt></div>"; }\n// comment </script>',
  );
  assert.equal(
    JSON.parse(cssPayloadMatch![1]),
    'body::after { content: "</style><script>alert(1)</script>"; }',
  );

  // Strict postMessage validation checks
  const iframeWin = { tag: 'expected-iframe-window' };
  const otherWin = { tag: 'spoofed-window' };

  assert.equal(
    validatePreviewMessage(
      { source: otherWin, origin: 'null', data: { type: 'preview-error', channel: 'chan-sec-1', message: 'Boom' } },
      iframeWin,
      'chan-sec-1',
      'http://localhost:3000',
    ),
    null,
  );
  assert.equal(
    validatePreviewMessage(
      { source: iframeWin, origin: 'https://evil.example', data: { type: 'preview-error', channel: 'chan-sec-1', message: 'Boom' } },
      iframeWin,
      'chan-sec-1',
      'http://localhost:3000',
    ),
    null,
  );
  assert.equal(
    validatePreviewMessage(
      { source: iframeWin, origin: 'null', data: { type: 'preview-error', channel: 'wrong-chan', message: 'Boom' } },
      iframeWin,
      'chan-sec-1',
      'http://localhost:3000',
    ),
    null,
  );
  const ok = validatePreviewMessage(
    { source: iframeWin, origin: 'null', data: { type: 'preview-error', channel: 'chan-sec-1', message: 'ReferenceError: x is not defined' } },
    iframeWin,
    'chan-sec-1',
    'http://localhost:3000',
  );
  assert.equal(ok?.message, 'ReferenceError: x is not defined');
});

test('BUG-05 & BUG-06: import preserves local preferences by default, supports opt-in restore, and handles duplicate trash/voice items cleanly', () => {
  let state = createInitialWorkspaceState();
  state = workspaceReducer(state, {
    type: 'UPDATE_VOICE_SETTINGS',
    patch: { languageMode: 'bn', voiceName: 'Kore' },
  });
  state = workspaceReducer(state, {
    type: 'CLONE_SAMPLE_PROJECT',
    sampleProjectId: SAMPLE_PROJECTS[0].id,
  });
  state = workspaceReducer(state, {
    type: 'CLONE_SAMPLE_CONVERSATION',
    sampleConversationId: SAMPLE_CONVERSATIONS[0].id,
  });
  state = workspaceReducer(state, {
    type: 'RECORD_VOICE_SESSION',
    record: {
      id: 'voice-rec-1',
      conversationId: state.conversations[0].id,
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      languageMode: 'bn',
      status: 'disconnected',
      micPermission: 'granted',
      startedAt: '2026-02-01T10:00:00.000Z',
      durationSeconds: 12,
      errorMessage: null,
      transcriptsSaved: false,
      transcripts: [],
      rawAudioStored: false,
    },
  });

  const bundle = buildWorkspaceExportBundle({
    projects: state.projects,
    conversations: state.conversations,
    deletedConversations: [{ ...state.conversations[0], id: 'trash-1', deletedAt: '2026-02-01T10:05:00.000Z' }],
    voiceSessions: state.voiceSessions,
    voiceSettings: { ...state.voiceSettings, languageMode: 'en', voiceName: 'Puck' },
    modelSettings: { ...state.modelSettings, chatModel: 'gemini-2.5-pro' },
    appSettings: { ...state.appSettings, showLineNumbers: false },
  });

  const inspection = validateAndInspectImportBundle(JSON.stringify(bundle), {
    projectIds: state.projects.map((p) => p.id),
    conversationIds: state.conversations.map((c) => c.id),
    deletedIds: [],
    voiceSessionIds: state.voiceSessions.map((v) => v.id),
  });
  assert.equal(inspection.valid, true);
  assert.equal(inspection.hasPreferences, true);
  assert.equal(inspection.duplicateProjectIds.length, 1);
  assert.equal(inspection.duplicateConversationIds.length, 1);
  assert.equal(inspection.duplicateVoiceSessionIds.length, 1);

  // Import with 'skip' and default restorePreferences: false -> local preferences stay 'bn' / 'Kore'
  const skipped = workspaceReducer(state, {
    type: 'IMPORT_WORKSPACE_BUNDLE',
    bundle: inspection.bundle!,
    duplicateStrategy: 'skip',
    restorePreferences: false,
  });
  assert.equal(skipped.projects.length, 1);
  assert.equal(skipped.conversations.length, 1);
  assert.equal(skipped.deletedConversations.length, 1);
  assert.equal(skipped.voiceSessions.length, 1);
  assert.equal(skipped.voiceSettings.languageMode, 'bn');
  assert.equal(skipped.voiceSettings.voiceName, 'Kore');

  // Import with 'copy' and restorePreferences: true -> duplicates cloned & preferences updated
  const copiedWithPrefs = workspaceReducer(state, {
    type: 'IMPORT_WORKSPACE_BUNDLE',
    bundle: inspection.bundle!,
    duplicateStrategy: 'copy',
    restorePreferences: true,
  });
  assert.equal(copiedWithPrefs.projects.length, 2);
  assert.equal(copiedWithPrefs.conversations.length, 2);
  assert.equal(copiedWithPrefs.voiceSessions.length, 2);
  assert.notEqual(copiedWithPrefs.projects[0].id, copiedWithPrefs.projects[1].id);
  assert.notEqual(copiedWithPrefs.voiceSessions[0].id, copiedWithPrefs.voiceSessions[1].id);
  assert.equal(copiedWithPrefs.voiceSettings.languageMode, 'en');
  assert.equal(copiedWithPrefs.voiceSettings.voiceName, 'Puck');
  assert.equal(copiedWithPrefs.modelSettings.chatModel, 'gemini-2.5-pro');
  assert.equal(copiedWithPrefs.appSettings.showLineNumbers, false);
});

test('Repair 2: recording or importing >100 voice sessions retains full history with zero false tombstones', () => {
  let state = createInitialWorkspaceState();

  const makeVoice = (i: number) => ({
    id: `voice-${i}`,
    conversationId: null,
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    languageMode: 'bilingual' as const,
    status: 'disconnected' as const,
    micPermission: 'granted' as const,
    startedAt: `2026-02-01T10:${String(i % 60).padStart(2, '0')}:00.000Z`,
    durationSeconds: 10,
    errorMessage: null,
    transcriptsSaved: false,
    transcripts: [],
    rawAudioStored: false as const,
  });

  // Record 105 voice sessions sequentially
  for (let i = 1; i <= 105; i += 1) {
    const prevSnapshot = {
      projects: state.projects,
      conversations: state.conversations,
      deletedConversations: state.deletedConversations,
      voiceSessions: state.voiceSessions,
      preferences: {
        voiceSettings: state.voiceSettings,
        modelSettings: state.modelSettings,
        appSettings: state.appSettings,
      },
    };
    state = workspaceReducer(state, {
      type: 'RECORD_VOICE_SESSION',
      record: makeVoice(i),
    });
    const nextSnapshot = {
      projects: state.projects,
      conversations: state.conversations,
      deletedConversations: state.deletedConversations,
      voiceSessions: state.voiceSessions,
      preferences: {
        voiceSettings: state.voiceSettings,
        modelSettings: state.modelSettings,
        appSettings: state.appSettings,
      },
    };
    const delta = computeWorkspaceDelta(prevSnapshot, nextSnapshot);
    assert.equal(delta.deletedVoiceSessionIds.length, 0);
    assert.equal(delta.tombstonesToPut.length, 0);
  }
  assert.equal(state.voiceSessions.length, 105);

  // Import bundle containing 120 additional voice sessions -> retains all 225
  const bulkBundle = buildWorkspaceExportBundle({
    projects: [],
    conversations: [],
    deletedConversations: [],
    voiceSessions: Array.from({ length: 120 }, (_, idx) => makeVoice(200 + idx)),
    voiceSettings: DEFAULT_VOICE_SETTINGS,
    modelSettings: DEFAULT_MODEL_SETTINGS,
    appSettings: DEFAULT_APP_SETTINGS,
  });
  const imported = workspaceReducer(state, {
    type: 'IMPORT_WORKSPACE_BUNDLE',
    bundle: bulkBundle,
    duplicateStrategy: 'skip',
    restorePreferences: false,
  });
  assert.equal(imported.voiceSessions.length, 225);
});

test('Repair 8: duplicate copy import remaps cross-entity IDs, preserves valid external refs, and cleans dangling refs', () => {
  let state = createInitialWorkspaceState();
  const baseProjId = 'proj-orig';
  const externalProjId = 'proj-external';
  const baseConvId = 'conv-orig';
  const baseTrashId = 'trash-orig';
  const baseVoiceId = 'voice-orig';
  const baseTrashVoiceId = 'voice-trash';

  const now = '2026-02-10T09:00:00.000Z';
  state = workspaceReducer(state, {
    type: 'HYDRATE_FROM_STORAGE',
    snapshot: {
      projects: [
        {
          id: baseProjId,
          name: 'Linked Project',
          description: '',
          framework: 'HTML',
          createdAt: now,
          updatedAt: now,
          entryFileId: 'f-orig',
          folders: ['src'],
          files: [
            {
              id: 'f-orig',
              name: 'index.html',
              folder: 'src',
              path: 'src/index.html',
              language: 'html',
              content: '<p>orig</p>',
              updatedAt: now,
            },
          ],
        },
        {
          id: externalProjId,
          name: 'External Workspace Project',
          description: '',
          framework: 'HTML',
          createdAt: now,
          updatedAt: now,
          entryFileId: 'f-ext',
          folders: ['src'],
          files: [
            {
              id: 'f-ext',
              name: 'index.html',
              folder: 'src',
              path: 'src/index.html',
              language: 'html',
              content: '<p>ext</p>',
              updatedAt: now,
            },
          ],
        },
      ],
      conversations: [
        {
          id: baseConvId,
          title: 'Linked Thread',
          kind: 'voice',
          projectId: baseProjId,
          createdAt: now,
          updatedAt: now,
          isPinned: false,
          voiceSessionIds: [baseVoiceId],
          summary: 'orig',
          messages: [
            {
              id: 'm-orig',
              role: 'user',
              content: 'hello',
              timestamp: '09:00',
              source: 'voice',
            },
          ],
        },
      ],
      deletedConversations: [
        {
          id: baseTrashId,
          title: 'Linked Trash',
          kind: 'voice',
          projectId: baseProjId,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
          isPinned: false,
          voiceSessionIds: [baseTrashVoiceId],
          summary: 'trash',
          messages: [],
        },
      ],
      voiceSessions: [
        {
          id: baseVoiceId,
          conversationId: baseConvId,
          model: DEFAULT_MODEL_SETTINGS.liveModel,
          languageMode: 'bilingual',
          status: 'disconnected',
          micPermission: 'granted',
          startedAt: now,
          durationSeconds: 30,
          errorMessage: null,
          transcriptsSaved: false,
          transcripts: [],
          rawAudioStored: false,
        },
        {
          id: baseTrashVoiceId,
          conversationId: baseTrashId,
          model: DEFAULT_MODEL_SETTINGS.liveModel,
          languageMode: 'bilingual',
          status: 'disconnected',
          micPermission: 'granted',
          startedAt: now,
          durationSeconds: 15,
          errorMessage: null,
          transcriptsSaved: false,
          transcripts: [],
          rawAudioStored: false,
        },
      ],
      preferences: {},
    },
  });

  // 1. Full duplicate import with 'copy': all cross-references must point to newly cloned IDs
  const fullBundle = buildWorkspaceExportBundle({
    projects: [state.projects[0]],
    conversations: state.conversations,
    deletedConversations: state.deletedConversations,
    voiceSessions: state.voiceSessions,
    voiceSettings: DEFAULT_VOICE_SETTINGS,
    modelSettings: DEFAULT_MODEL_SETTINGS,
    appSettings: DEFAULT_APP_SETTINGS,
  });

  const copied = applyImportWorkspaceBundle(state, {
    bundle: fullBundle,
    duplicateStrategy: 'copy',
    restorePreferences: false,
  });

  assert.equal(copied.projects.length, 3);
  assert.equal(copied.conversations.length, 2);
  assert.equal(copied.deletedConversations.length, 2);
  assert.equal(copied.voiceSessions.length, 4);

  const newProj = copied.projects.find((p) => p.id !== baseProjId && p.id !== externalProjId)!;
  const newConv = copied.conversations.find((c) => c.id !== baseConvId)!;
  const newTrash = copied.deletedConversations.find((c) => c.id !== baseTrashId)!;
  const newVoice = copied.voiceSessions.find(
    (v) => v.id !== baseVoiceId && v.id !== baseTrashVoiceId && v.conversationId === newConv.id,
  )!;
  const newTrashVoice = copied.voiceSessions.find(
    (v) => v.id !== baseVoiceId && v.id !== baseTrashVoiceId && v.conversationId === newTrash.id,
  )!;

  assert.equal(newConv.projectId, newProj.id);
  assert.deepEqual(newConv.voiceSessionIds, [newVoice.id]);
  assert.equal(newTrash.projectId, newProj.id);
  assert.deepEqual(newTrash.voiceSessionIds, [newTrashVoice.id]);

  // Original entities remain 100% untouched
  const origConv = copied.conversations.find((c) => c.id === baseConvId)!;
  const origVoice = copied.voiceSessions.find((v) => v.id === baseVoiceId)!;
  assert.equal(origConv.projectId, baseProjId);
  assert.deepEqual(origConv.voiceSessionIds, [baseVoiceId]);
  assert.equal(origVoice.conversationId, baseConvId);

  // 2. Subset import: conversation referencing externalProjId (already in workspace) preserves it,
  // while missing/broken project & voice refs are safely nullified/filtered
  const subsetBundle = buildWorkspaceExportBundle({
    projects: [],
    conversations: [
      {
        ...state.conversations[0],
        id: 'conv-subset-valid-ext',
        projectId: externalProjId,
        voiceSessionIds: [baseVoiceId, 'voice-missing-404'],
      },
      {
        ...state.conversations[0],
        id: 'conv-subset-dangling',
        projectId: 'proj-missing-404',
        voiceSessionIds: ['voice-missing-404'],
      },
    ],
    deletedConversations: [],
    voiceSessions: [
      {
        ...state.voiceSessions[0],
        id: 'voice-dangling-conv',
        conversationId: 'conv-missing-404',
      },
    ],
    voiceSettings: DEFAULT_VOICE_SETTINGS,
    modelSettings: DEFAULT_MODEL_SETTINGS,
    appSettings: DEFAULT_APP_SETTINGS,
  });

  const subsetApplied = applyImportWorkspaceBundle(state, {
    bundle: subsetBundle,
    duplicateStrategy: 'copy',
  });
  const extConv = subsetApplied.conversations.find((c) => c.id === 'conv-subset-valid-ext')!;
  assert.equal(extConv.projectId, externalProjId);
  assert.deepEqual(extConv.voiceSessionIds, [baseVoiceId]);

  const danglingConv = subsetApplied.conversations.find((c) => c.id === 'conv-subset-dangling')!;
  assert.equal(danglingConv.projectId, null);
  assert.deepEqual(danglingConv.voiceSessionIds, []);

  const danglingVoice = subsetApplied.voiceSessions.find((v) => v.id === 'voice-dangling-conv')!;
  assert.equal(danglingVoice.conversationId, null);
});

test('Repair 7 & 9: APPLY_COMMITTED_IMPORT, ROLLBACK_TO_COMMITTED_SNAPSHOT, and settingRevisions tracking', () => {
  const now = '2026-02-12T00:00:00.000Z';
  const committedSnapshot = {
    projects: [
      {
        id: 'p-committed',
        name: 'Committed Project',
        description: '',
        framework: 'HTML',
        createdAt: now,
        updatedAt: now,
        entryFileId: 'f-committed',
        folders: ['src'],
        files: [
          {
            id: 'f-committed',
            name: 'index.html',
            folder: 'src',
            path: 'src/index.html',
            language: 'html' as const,
            content: '<h1>Committed</h1>',
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
      activeProjectId: 'p-committed',
      activeFileId: 'f-committed',
      activeConversationId: null,
      settingRevisions: { voiceSettings: 2 },
    },
  };

  let state = workspaceReducer(createInitialWorkspaceState(), {
    type: 'HYDRATE_FROM_STORAGE',
    snapshot: committedSnapshot,
  });
  assert.equal(state.settingRevisions.voiceSettings, 2);

  // Syncable settings increment settingRevisions monotonically
  state = workspaceReducer(state, {
    type: 'UPDATE_VOICE_SETTINGS',
    patch: { languageMode: 'en' },
  });
  state = workspaceReducer(state, {
    type: 'UPDATE_MODEL_SETTINGS',
    patch: { chatModel: 'gemini-2.5-pro' },
  });
  state = workspaceReducer(state, {
    type: 'UPDATE_APP_SETTINGS',
    patch: { showLineNumbers: false },
  });
  assert.equal(state.settingRevisions.voiceSettings, 3);
  assert.equal(state.settingRevisions.modelSettings, 1);
  assert.equal(state.settingRevisions.appSettings, 1);

  // Simulate dirty edit + failed save -> rollback restores committed snapshot & clears dirty files
  state = workspaceReducer(state, {
    type: 'UPDATE_FILE_CONTENT',
    fileId: 'f-committed',
    content: '<h1>Unsaved Broken Edit</h1>',
  });
  state = workspaceReducer(state, {
    type: 'SET_SAVE_STATUS',
    status: 'error',
    error: 'QuotaExceededError',
  });
  assert.equal(state.dirtyFileIds.includes('f-committed'), true);

  state = workspaceReducer(state, {
    type: 'ROLLBACK_TO_COMMITTED_SNAPSHOT',
    snapshot: committedSnapshot,
  });
  assert.equal(state.saveStatus, 'saved');
  assert.equal(state.storageError, null);
  assert.equal(state.dirtyFileIds.length, 0);
  assert.equal(state.projects[0].files[0].content, '<h1>Committed</h1>');
  assert.equal(state.voiceSettings.languageMode, DEFAULT_VOICE_SETTINGS.languageMode);
  assert.equal(state.settingRevisions.voiceSettings, 2);

  // APPLY_COMMITTED_IMPORT transitions cleanly to saved at target dataRevision
  const nextCandidate = applyImportWorkspaceBundle(state, {
    bundle: buildWorkspaceExportBundle({
      projects: [],
      conversations: [],
      deletedConversations: [],
      voiceSessions: [],
      voiceSettings: { ...DEFAULT_VOICE_SETTINGS, voiceName: 'Puck' },
      modelSettings: DEFAULT_MODEL_SETTINGS,
      appSettings: DEFAULT_APP_SETTINGS,
    }),
    duplicateStrategy: 'skip',
    restorePreferences: true,
  });
  const committedState = workspaceReducer(state, {
    type: 'APPLY_COMMITTED_IMPORT',
    nextState: nextCandidate,
    savedAt: '2026-02-12T01:00:00.000Z',
  });
  assert.equal(committedState.saveStatus, 'saved');
  assert.equal(committedState.persistedRevision, committedState.dataRevision);
  assert.equal(committedState.voiceSettings.voiceName, 'Puck');
});

test('Phase 3: SET_ACTIVE_OWNER_AND_HYDRATE assigns ownerUid/pending status on mutations and APPLY_REMOTE_SNAPSHOT preserves view', () => {
  let state = createInitialWorkspaceState();
  state = workspaceReducer(state, {
    type: 'SET_ACTIVE_OWNER_AND_HYDRATE',
    activeOwnerUid: 'uid-cloud-user',
    snapshot: {
      projects: [],
      conversations: [],
      deletedConversations: [],
      voiceSessions: [],
      preferences: {},
    },
  });

  assert.equal(state.activeOwnerUid, 'uid-cloud-user');
  state = workspaceReducer(state, { type: 'CREATE_PROJECT', name: 'Synced Proj' });
  assert.equal(state.projects[0].ownerUid, 'uid-cloud-user');
  assert.equal(state.projects[0].syncStatus, 'pending');
  assert.equal(state.projects[0].files[0].ownerUid, 'uid-cloud-user');
  assert.equal(state.projects[0].files[0].syncStatus, 'pending');

  state = workspaceReducer(state, { type: 'SEND_USER_MESSAGE', text: 'Cloud message' });
  assert.equal(state.conversations[0].ownerUid, 'uid-cloud-user');
  assert.equal(state.conversations[0].syncStatus, 'pending');
  assert.equal(state.conversations[0].messages[0].syncStatus, 'pending');

  // APPLY_REMOTE_SNAPSHOT merges pulled entities without resetting UI workspace tab
  state = workspaceReducer(state, { type: 'SET_WORKSPACE', workspace: 'projects' });
  state = workspaceReducer(state, {
    type: 'APPLY_REMOTE_SNAPSHOT',
    snapshot: {
      projects: [
        ...state.projects,
        {
          id: 'proj-remote-2',
          name: 'Remote Project',
          description: 'Pulled',
          framework: 'HTML',
          createdAt: '2026-02-12T02:00:00.000Z',
          updatedAt: '2026-02-12T02:00:00.000Z',
          revision: 1,
          ownerUid: 'uid-cloud-user',
          syncStatus: 'synced',
          entryFileId: 'f-remote-2',
          folders: ['src'],
          files: [
            {
              id: 'f-remote-2',
              name: 'index.html',
              folder: 'src',
              path: 'src/index.html',
              language: 'html',
              content: '<p>Remote</p>',
              createdAt: '2026-02-12T02:00:00.000Z',
              updatedAt: '2026-02-12T02:00:00.000Z',
              revision: 1,
              ownerUid: 'uid-cloud-user',
              syncStatus: 'synced',
            },
          ],
        },
      ],
      conversations: state.conversations,
      deletedConversations: [],
      voiceSessions: [],
      preferences: {
        voiceSettings: { ...DEFAULT_VOICE_SETTINGS, languageMode: 'bn' },
      },
    },
    syncedAt: '2026-02-12T02:05:00.000Z',
  });

  assert.equal(state.activeWorkspace, 'projects');
  assert.equal(state.projects.length, 2);
  assert.equal(state.voiceSettings.languageMode, 'bn');
});



