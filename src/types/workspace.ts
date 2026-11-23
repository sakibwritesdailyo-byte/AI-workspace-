export type WorkspaceId = 'chat' | 'projects' | 'history';

export type ProjectSubView = 'overview' | 'code' | 'preview';

export type FileLanguage = 'html' | 'css' | 'typescript' | 'javascript' | 'json' | 'markdown';

/**
 * Sync status meanings for Phase 2.5 -> Phase 3 readiness:
 * - local_only: Created/edited locally with no linked cloud account (Phase 2.5 default).
 * - pending: Modified locally while linked to an account / queued in sync_outbox for push.
 * - synced: Matches last acknowledged remote Firestore state (used in Phase 3).
 * - conflict: Divergent local and remote revisions requiring resolution (used in Phase 3).
 */
export type SyncStatus = 'local_only' | 'pending' | 'synced' | 'conflict';

export type SyncEntityType =
  | 'project'
  | 'file'
  | 'conversation'
  | 'message'
  | 'voice_session'
  | 'setting';

export interface SyncMetadata {
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  revision?: number;
  ownerUid?: string | null;
  syncStatus?: SyncStatus;
}

export interface SyncTombstoneRecord {
  /** Composite key `${entityType}:${entityId}` to prevent duplicates */
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  parentId?: string | null;
  deletedAt: string;
  revision: number;
  ownerUid: string | null;
  syncStatus: SyncStatus;
  /** Timestamp when remote deletion acknowledgement was confirmed; null until confirmed */
  acknowledgedAt?: string | null;
}

export type OutboxStatus = 'pending' | 'in_flight' | 'failed';

export interface SyncOutboxRecord {
  /** Account-scoped composite key `${ownerUid ?? 'local'}:${entityType}:${entityId}` */
  id: string;
  /** Unique idempotency identifier rotated on each new mutation/revision so stale acks cannot drop newer edits */
  operationId: string;
  entityType: SyncEntityType;
  entityId: string;
  parentId?: string | null;
  operation: 'upsert' | 'delete';
  revision: number;
  /** Prior known entity revision when available (null for initial creation) */
  baseRevision: number | null;
  ownerUid: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  status: OutboxStatus;
  retryCount: number;
  lastError: string | null;
  nextRetryAt: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  claimedBy: string | null;
  lastAttemptAt?: string | null;
}

export interface OutboxDiagnostics {
  ownerUid: string | null;
  totalCount: number;
  pendingCount: number;
  inFlightCount: number;
  failedCount: number;
  expiredLeaseCount: number;
  retryReadyCount: number;
  oldestPendingAt: string | null;
  unacknowledgedTombstoneCount: number;
  acknowledgedTombstoneCount: number;
}

export type SettingSyncCategory = 'device_local' | 'account_syncable';

export type ClaimCollisionStrategy = 'abort_on_collision' | 'remap_colliding_ids';

export interface OwnershipSummary {
  activeOwnerUid: string | null;
  unclaimedCount: number;
  activeAccountCount: number;
  otherAccountCount: number;
  otherAccountUids: string[];
  unclaimedOutboxCount: number;
  activeAccountOutboxCount: number;
  otherAccountOutboxCount: number;
}

export interface ClaimLocalDataResult {
  claimedCount: number;
  remappedProjectIds: Record<string, string>;
  remappedFileIds: Record<string, string>;
  remappedConversationIds: Record<string, string>;
  remappedMessageIds: Record<string, string>;
  remappedVoiceSessionIds: Record<string, string>;
  targetOwnerUid: string;
}

export interface ProjectFile {
  id: string;
  name: string;
  path: string;
  folder: string;
  language: FileLanguage;
  content: string;
  createdAt?: string;
  updatedAt: string;
  deletedAt?: string | null;
  revision?: number;
  ownerUid?: string | null;
  syncStatus?: SyncStatus;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  framework: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  revision?: number;
  ownerUid?: string | null;
  syncStatus?: SyncStatus;
  entryFileId: string;
  folders?: string[];
  files: ProjectFile[];
  isSample?: boolean;
}

export type MessageRole = 'user' | 'assistant' | 'system';

import type { ThinkingLevelOption } from '../shared/modelRegistry';

export interface TokenUsageSummary {
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  thoughtsTokens?: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  revision?: number;
  ownerUid?: string | null;
  syncStatus?: SyncStatus;
  source: 'text' | 'voice';
  language?: 'en' | 'bn' | 'mixed';
  modelUsed?: string;
  fallbackUsed?: boolean;
  usage?: TokenUsageSummary;
  stopped?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  kind: 'voice' | 'chat';
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  isPinned: boolean;
  /** True while this conversation is soft-deleted and must not appear in active history. */
  deleted?: boolean;
  deletedAt?: string;
  revision?: number;
  ownerUid?: string | null;
  syncStatus?: SyncStatus;
  durationSeconds?: number;
  voiceSessionIds?: string[];
  summary: string;
  messages: ChatMessage[];
  isSample?: boolean;
}

export type VoiceSessionStatus =
  | 'disconnected'
  | 'requesting_mic'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'muted'
  | 'paused'
  | 'error';

export type MicPermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported';

export interface LiveCaption {
  id: string;
  speaker: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface VoiceSessionRecord {
  id: string;
  conversationId: string | null;
  model: string;
  languageMode: VoiceLanguageMode;
  status: VoiceSessionStatus;
  micPermission: MicPermissionState;
  startedAt: string;
  endedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  revision?: number;
  ownerUid?: string | null;
  syncStatus?: SyncStatus;
  durationSeconds: number;
  errorMessage: string | null;
  transcriptsSaved: boolean;
  transcripts: LiveCaption[];
  rawAudioStored: false;
}

export interface VoiceSessionState {
  status: VoiceSessionStatus;
  micPermission: MicPermissionState;
  micActive: boolean;
  isMuted: boolean;
  isPaused: boolean;
  elapsedSeconds: number;
  captions: LiveCaption[];
  errorMessage: string | null;
  backendEndpoint: string;
}

export type VoiceLanguageMode = 'bilingual' | 'en' | 'bn';

export interface VoiceSettings {
  voiceName: 'Aoede' | 'Kore' | 'Charon' | 'Fenrir' | 'Puck';
  languageMode: VoiceLanguageMode;
  allowBargeIn: boolean;
  saveTranscripts: boolean;
  saveRawAudio: boolean;
  speechRate: number;
}

export interface ModelSettings {
  chatModel: string;
  /** Deferred to Phase 5 (Gemini Live endpoint `/api/voice/session`) */
  liveModel: string;
  fallbackModel: string;
  temperature: number;
  thinkingLevel?: ThinkingLevelOption;
  maxOutputTokens?: number;
  systemPromptId: string;
  customSystemPrompt: string;
  autoFallback: boolean;
}

export interface SystemPromptPreset {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

export interface AppSettings {
  showLineNumbers: boolean;
  autosaveEnabled: boolean;
  localFirstMode: boolean;
}

export type PreviewViewport = 'mobile' | 'tablet' | 'desktop';

export type HistoryFilter = 'all' | 'voice' | 'chat' | 'pinned';

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

export interface WorkspaceStorageStats {
  projectCount: number;
  fileCount: number;
  conversationCount: number;
  messageCount: number;
  voiceSessionCount: number;
  deletedCount: number;
  tombstoneCount?: number;
  outboxCount?: number;
  usageBytes: number | null;
  quotaBytes: number | null;
  persistedStorage: boolean | null;
  storageError: string | null;
}

export interface WorkspaceExportBundle {
  schemaVersion: 2;
  backupType?: 'workspace' | 'project';
  exportedAt: string;
  projects: Project[];
  conversations: Conversation[];
  deletedConversations: Conversation[];
  voiceSessions?: VoiceSessionRecord[];
  preferences?: {
    voiceSettings: VoiceSettings;
    modelSettings: ModelSettings;
    appSettings: AppSettings;
  };
}

export interface ImportInspectionPreview {
  valid: boolean;
  error?: string;
  schemaVersion?: number;
  backupType?: 'workspace' | 'project';
  exportedAt?: string;
  projectCount: number;
  fileCount: number;
  conversationCount: number;
  deletedCount: number;
  voiceSessionCount: number;
  hasPreferences: boolean;
  duplicateProjectIds: string[];
  duplicateConversationIds: string[];
  duplicateDeletedIds: string[];
  duplicateVoiceSessionIds: string[];
  bundle?: WorkspaceExportBundle;
}

export interface AuthUserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  providerIds: string[];
  isAnonymous: boolean;
}

export type AuthStatus = 'initializing' | 'signed_out' | 'signed_in' | 'error';

export type CloudSyncStatus =
  | 'local_only'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'failed'
  | 'conflict'
  | 'auth_required';

export type ConflictReason =
  | 'concurrent_edit'
  | 'delete_vs_edit'
  | 'setting_divergence'
  | 'id_collision';

export type ConflictResolutionOutcome =
  | 'preserved_both'
  | 'remote_deleted'
  | 'local_kept'
  | 'remote_kept'
  | 'remapped';

export interface CloudSyncConflict {
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  title: string;
  reason: ConflictReason;
  resolution: ConflictResolutionOutcome;
  localRevision: number | null;
  remoteRevision: number | null;
  localUpdatedAt: string | null;
  remoteUpdatedAt: string | null;
  preservedCopyId?: string | null;
  preservedCopyLabel?: string | null;
  detectedAt: string;
  dismissed?: boolean;
}

export interface SyncEngineState {
  status: CloudSyncStatus;
  pendingCount: number;
  failedCount: number;
  inFlightCount: number;
  lastSyncAt: string | null;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastError: string | null;
  conflicts: CloudSyncConflict[];
  unclaimedDecision: 'undecided' | 'keep_local_separate' | 'claimed';
  ownershipPausedReason: 'unclaimed_local_data_present' | 'account_switched' | null;
  ownershipSummary: OwnershipSummary | null;
}

export type ChatNoticeKind =
  | 'offline'
  | 'auth_required'
  | 'rate_limited'
  | 'backend_unavailable'
  | 'error';

export interface ChatNoticeState {
  kind: ChatNoticeKind;
  message: string;
  retryable?: boolean;
}

export interface ChatStreamingState {
  conversationId: string;
  text: string;
  modelUsed: string | null;
  fallbackUsed: boolean;
}

export interface WorkspaceState {
  hydrated: boolean;
  activeOwnerUid: string | null;
  dataRevision: number;
  persistedRevision: number;
  uiRevision: number;
  saveStatus: SaveStatus;
  lastSavedAt: string | null;
  storageError: string | null;
  workspaceNotice: string | null;
  activeWorkspace: WorkspaceId;
  projectSubView: ProjectSubView;
  leftDrawerOpen: boolean;
  rightDrawerOpen: boolean;
  projects: Project[];
  activeProjectId: string | null;
  previewSampleProjectId: string | null;
  openFileIds: string[];
  activeFileId: string | null;
  expandedFolders: string[];
  conversations: Conversation[];
  deletedConversations: Conversation[];
  voiceSessions: VoiceSessionRecord[];
  activeConversationId: string | null;
  selectedConversationIds: string[];
  historyFilter: HistoryFilter;
  historySearch: string;
  previewViewport: PreviewViewport;
  previewNonce: number;
  voiceSession: VoiceSessionState;
  voiceSettings: VoiceSettings;
  modelSettings: ModelSettings;
  appSettings: AppSettings;
  settingRevisions: Partial<Record<'voiceSettings' | 'modelSettings' | 'appSettings', number>>;
  dirtyFileIds: string[];
  dirtyFileRevisions: Record<string, number>;
  chatSending: boolean;
  chatStreaming: ChatStreamingState | null;
  chatNotice: ChatNoticeState | null;
}
