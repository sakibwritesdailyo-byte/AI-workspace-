import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VOICE_SETTINGS,
} from '../data/mockWorkspaceData';
import {
  SUPPORTED_BACKUP_VERSION,
  buildSingleProjectExportBundle,
  buildWorkspaceExportBundle,
  sanitizeAppSettings,
  sanitizeModelSettings,
  sanitizeVoiceSettings,
  validateAndInspectImportBundle,
} from './backupService';
import type { Project } from '../types/workspace';

const SAMPLE_USER_PROJECT: Project = {
  id: 'proj-user-1',
  name: 'Local Todo',
  description: 'Offline checklist app',
  framework: 'HTML · CSS · JS',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
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
      content: '<h1>Hello</h1>',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

test('single-project export and workspace export include schemaVersion 2 and strip sample records', () => {
  const single = buildSingleProjectExportBundle(SAMPLE_USER_PROJECT);
  assert.equal(single.schemaVersion, SUPPORTED_BACKUP_VERSION);
  assert.equal(single.backupType, 'project');
  assert.equal(single.projects.length, 1);
  assert.equal(single.conversations.length, 0);

  const full = buildWorkspaceExportBundle({
    projects: [SAMPLE_USER_PROJECT, { ...SAMPLE_USER_PROJECT, id: 'sample-1', isSample: true }],
    conversations: [],
    deletedConversations: [],
    voiceSettings: DEFAULT_VOICE_SETTINGS,
    modelSettings: DEFAULT_MODEL_SETTINGS,
    appSettings: DEFAULT_APP_SETTINGS,
  });
  assert.equal(full.schemaVersion, SUPPORTED_BACKUP_VERSION);
  assert.equal(full.projects.length, 1);
  assert.equal(full.projects[0].id, 'proj-user-1');
});

test('validateAndInspectImportBundle rejects invalid JSON, non-array fields, and incompatible schemaVersion', () => {
  const emptyExisting = { projectIds: [], conversationIds: [], deletedIds: [], voiceSessionIds: [] };

  const badJson = validateAndInspectImportBundle('{not valid json', emptyExisting);
  assert.equal(badJson.valid, false);
  assert.match(badJson.error || '', /Invalid JSON/i);

  const wrongVersion = validateAndInspectImportBundle(
    JSON.stringify({ schemaVersion: 99, projects: [SAMPLE_USER_PROJECT] }),
    emptyExisting,
  );
  assert.equal(wrongVersion.valid, false);
  assert.match(wrongVersion.error || '', /Incompatible backup schema version/i);

  const malformedProjects = validateAndInspectImportBundle(
    JSON.stringify({ schemaVersion: 2, projects: 'not-an-array' }),
    emptyExisting,
  );
  assert.equal(malformedProjects.valid, false);
  assert.match(malformedProjects.error || '', /must be an array/i);

  const missingData = validateAndInspectImportBundle(
    JSON.stringify({ schemaVersion: 2, projects: [], conversations: [] }),
    emptyExisting,
  );
  assert.equal(missingData.valid, false);
  assert.match(missingData.error || '', /contains no projects, conversations, or voice logs/i);
});

test('settings sanitizers validate bounds and preserve safe defaults including Phase 4/5 fields', () => {
  const m = sanitizeModelSettings({
    chatModel: '  ',
    liveModel: '',
    fallbackModel: 'gemini-2.5-flash-lite',
    temperature: 99,
    autoFallback: 'invalid',
  });
  assert.equal(m.chatModel, DEFAULT_MODEL_SETTINGS.chatModel);
  assert.equal(m.liveModel, DEFAULT_MODEL_SETTINGS.liveModel);
  assert.equal(m.fallbackModel, 'gemini-2.5-flash-lite');
  assert.equal(m.temperature, 1);
  assert.equal(m.autoFallback, DEFAULT_MODEL_SETTINGS.autoFallback);

  const v = sanitizeVoiceSettings({
    voiceName: 'UnknownVoice',
    languageMode: 'bn',
    saveRawAudio: true,
    speechRate: 5,
  });
  assert.equal(v.voiceName, DEFAULT_VOICE_SETTINGS.voiceName);
  assert.equal(v.languageMode, 'bn');
  assert.equal(v.saveRawAudio, false);
  assert.equal(v.speechRate, 2);

  const a = sanitizeAppSettings({ showLineNumbers: false });
  assert.equal(a.showLineNumbers, false);
  assert.equal(a.autosaveEnabled, true);
});

