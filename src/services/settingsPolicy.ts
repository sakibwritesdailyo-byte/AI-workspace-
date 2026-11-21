import type { SettingSyncCategory } from '../types/workspace';

/**
 * Explicit Synchronization Policy for Workspace Settings (Phase 2.5.2 -> Phase 3).
 *
 * A. Device-local settings (`device_local`):
 *    - activeProjectId: active editor workspace pointer on this device
 *    - activeConversationId: active chat thread pointer on this device
 *    - activeFileId: active code tab pointer on this device
 *    These keys persist locally in IndexedDB `settings`, NEVER trigger `sync_outbox`
 *    entries, and MUST NOT be uploaded to another device.
 *
 * B. Account-syncable preferences (`account_syncable`):
 *    - voiceSettings: spoken language, voice profile, barge-in, speech rate, saveTranscripts (`saveRawAudio` always forced false)
 *    - modelSettings: preferred chat/live/fallback model, temperature, system instruction
 *    - appSettings: editor line numbers, autosave toggle, local-first flag
 *    Changes to these keys track a monotonically increasing per-key `revision` and
 *    enqueue an account-scoped `setting` upsert in `sync_outbox`.
 */
export type PreferenceKey =
  | 'voiceSettings'
  | 'modelSettings'
  | 'appSettings'
  | 'activeProjectId'
  | 'activeConversationId'
  | 'activeFileId';

export type SyncableSettingKey = 'voiceSettings' | 'modelSettings' | 'appSettings';
export type DeviceLocalSettingKey = 'activeProjectId' | 'activeConversationId' | 'activeFileId';

export const SETTINGS_SYNC_POLICY: Record<PreferenceKey, SettingSyncCategory> = {
  voiceSettings: 'account_syncable',
  modelSettings: 'account_syncable',
  appSettings: 'account_syncable',
  activeProjectId: 'device_local',
  activeConversationId: 'device_local',
  activeFileId: 'device_local',
};

export const DEVICE_LOCAL_SETTING_KEYS: readonly DeviceLocalSettingKey[] = [
  'activeProjectId',
  'activeConversationId',
  'activeFileId',
];

export const ACCOUNT_SYNCABLE_SETTING_KEYS: readonly SyncableSettingKey[] = [
  'voiceSettings',
  'modelSettings',
  'appSettings',
];

export function getSettingSyncCategory(key: PreferenceKey): SettingSyncCategory {
  return SETTINGS_SYNC_POLICY[key];
}

export function isSettingSyncable(key: PreferenceKey): key is SyncableSettingKey {
  return SETTINGS_SYNC_POLICY[key] === 'account_syncable';
}

export function isDeviceLocalSetting(key: PreferenceKey): key is DeviceLocalSettingKey {
  return SETTINGS_SYNC_POLICY[key] === 'device_local';
}
