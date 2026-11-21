import type {
  AppSettings,
  AuthUserProfile,
  ChatMessage,
  CloudSyncConflict,
  CloudSyncStatus,
  Conversation,
  ModelSettings,
  OutboxDiagnostics,
  OwnershipSummary,
  Project,
  ProjectFile,
  SyncEntityType,
  SyncEngineState,
  SyncOutboxRecord,
  VoiceSessionRecord,
  VoiceSettings,
} from '../../types/workspace';
import {
  evaluateOwnershipTransition,
  normalizeOwnerUid,
} from '../ownershipPolicy';
import { isSettingSyncable, type PreferenceKey } from '../settingsPolicy';
import type {
  PersistedWorkspaceSnapshot,
  WorkspaceRepository,
} from '../workspaceRepository';
import {
  reconcileCloudAndLocalWorkspace,
  type RemoteWorkspaceSnapshot,
} from './conflictResolution';
import {
  classifyFirestoreError,
  formatUserFriendlyFirestoreError,
} from './firestoreErrorHandler';
import { firestoreService, type UpsertDocResult } from './firestoreService';

export interface CloudRemoteAdapter {
  ensureUserProfile(user: AuthUserProfile): Promise<void>;
  updateSyncMeta(uid: string, patch: { lastPushAt?: string; lastPullAt?: string }): Promise<void>;
  upsertProject(
    uid: string,
    project: Project,
    options?: { expectedBaseRevision?: number | null },
  ): Promise<UpsertDocResult>;
  upsertFile(
    uid: string,
    projectId: string,
    file: ProjectFile,
    options?: { expectedBaseRevision?: number | null; ensureParentProject?: Project | null },
  ): Promise<UpsertDocResult>;
  upsertConversation(
    uid: string,
    conversation: Conversation,
    options?: { expectedBaseRevision?: number | null },
  ): Promise<UpsertDocResult>;
  upsertMessage(
    uid: string,
    conversationId: string,
    orderIndex: number,
    message: ChatMessage,
    options?: {
      expectedBaseRevision?: number | null;
      ensureParentConversation?: Conversation | null;
    },
  ): Promise<UpsertDocResult>;
  upsertVoiceSession(
    uid: string,
    session: VoiceSessionRecord,
    options?: { expectedBaseRevision?: number | null },
  ): Promise<UpsertDocResult>;
  upsertPreference(
    uid: string,
    settingKey: PreferenceKey,
    value: VoiceSettings | ModelSettings | AppSettings,
    revision: number,
    updatedAt: string,
    options?: { expectedBaseRevision?: number | null },
  ): Promise<UpsertDocResult>;
  deleteEntityWithTombstone(
    uid: string,
    input: {
      entityType: SyncEntityType;
      entityId: string;
      parentId?: string | null;
      revision: number;
      deletedAt: string;
    },
  ): Promise<void>;
  fetchUserCloudSnapshot(uid: string): Promise<RemoteWorkspaceSnapshot>;
  fetchExistingEntityIds(uid: string): Promise<{
    projects: string[];
    files: string[];
    conversations: string[];
    messages: string[];
    voiceSessions: string[];
  }>;
  deleteAllUserCloudData(uid: string): Promise<void>;
}

export interface SyncCoordinatorCallbacks {
  onStateChange?: (state: SyncEngineState) => void;
  onRemoteChangesApplied?: (snapshot: PersistedWorkspaceSnapshot) => void;
}

const ENTITY_PUSH_ORDER: Record<string, number> = {
  'upsert:project': 1,
  'upsert:file': 2,
  'upsert:conversation': 3,
  'upsert:message': 4,
  'upsert:voice_session': 5,
  'upsert:setting': 6,
  'delete:message': 7,
  'delete:voice_session': 8,
  'delete:conversation': 9,
  'delete:file': 10,
  'delete:project': 11,
  'delete:setting': 12,
};

export function sortOutboxForPush(rows: SyncOutboxRecord[]): SyncOutboxRecord[] {
  return [...rows].sort((a, b) => {
    const orderA = ENTITY_PUSH_ORDER[`${a.operation}:${a.entityType}`] ?? 99;
    const orderB = ENTITY_PUSH_ORDER[`${b.operation}:${b.entityType}`] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    const tsCmp = (a.createdAt || a.updatedAt).localeCompare(b.createdAt || b.updatedAt);
    return tsCmp !== 0 ? tsCmp : a.revision - b.revision;
  });
}

export function createInitialSyncEngineState(): SyncEngineState {
  return {
    status: 'local_only',
    pendingCount: 0,
    failedCount: 0,
    inFlightCount: 0,
    lastSyncAt: null,
    lastPushAt: null,
    lastPullAt: null,
    lastError: null,
    conflicts: [],
    unclaimedDecision: 'undecided',
    ownershipPausedReason: null,
    ownershipSummary: null,
  };
}

export class CloudSyncCoordinator {
  private readonly repository: WorkspaceRepository;
  private readonly remote: CloudRemoteAdapter;
  private readonly callbacks: SyncCoordinatorCallbacks;
  private readonly workerId: string;

  private state: SyncEngineState = createInitialSyncEngineState();
  private currentUser: AuthUserProfile | null = null;
  private previousAccountUid: string | null = null;
  private isOnline =
    typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine
      : true;
  private syncInFlight: Promise<void> | null = null;
  private activeSyncPass = false;
  private rerunRequested = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    repository: WorkspaceRepository,
    remote: CloudRemoteAdapter = firestoreService,
    callbacks: SyncCoordinatorCallbacks = {},
    workerId?: string,
  ) {
    this.repository = repository;
    this.remote = remote;
    this.callbacks = callbacks;
    this.workerId =
      workerId ??
      `worker-${
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).slice(2, 10)
      }`;
  }

  getState(): SyncEngineState {
    return {
      ...this.state,
      conflicts: [...this.state.conflicts],
    };
  }

  getActiveOwnerUid(): string | null {
    return this.currentUser?.uid ?? null;
  }

  private emitState(patch: Partial<SyncEngineState>): void {
    this.state = {
      ...this.state,
      ...patch,
    };
    this.callbacks.onStateChange?.(this.getState());
  }

  private computeDerivedStatus(
    diagnostics: OutboxDiagnostics,
    syncing: boolean,
    explicitError: string | null,
  ): CloudSyncStatus {
    if (!this.currentUser) return 'local_only';
    if (this.state.ownershipPausedReason !== null) return 'auth_required';
    if (!this.isOnline) return 'offline';
    if (syncing) return 'syncing';
    if (this.state.conflicts.some((c) => !c.dismissed)) return 'conflict';
    if (diagnostics.failedCount > 0 || explicitError) return 'failed';
    if (diagnostics.pendingCount > 0 || diagnostics.inFlightCount > 0) return 'syncing';
    return 'synced';
  }

  async refreshDiagnostics(explicitError: string | null = this.state.lastError): Promise<void> {
    const uid = this.currentUser?.uid ?? null;
    const [diagnostics, summary] = await Promise.all([
      this.repository.getOutboxDiagnostics({ ownerUid: uid }),
      this.repository.getOwnershipSummary(uid),
    ]);

    const nextStatus = this.computeDerivedStatus(diagnostics, this.activeSyncPass, explicitError);
    this.emitState({
      status: nextStatus,
      pendingCount: diagnostics.pendingCount + diagnostics.retryReadyCount,
      failedCount: diagnostics.failedCount,
      inFlightCount: diagnostics.inFlightCount,
      ownershipSummary: summary,
      lastError: explicitError,
    });
  }

  setOnlineStatus(online: boolean): void {
    this.isOnline = online;
    if (!online) {
      if (this.retryTimer !== null) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      if (this.currentUser) {
        this.emitState({ status: 'offline' });
      }
      return;
    }

    if (this.currentUser && this.state.ownershipPausedReason === null) {
      void this.syncNow({ reason: 'reconnect' });
    } else {
      void this.refreshDiagnostics();
    }
  }

  async setAuthUser(
    user: AuthUserProfile | null,
    options?: { autoSyncIfAllowed?: boolean; priorDecision?: 'undecided' | 'keep_local_separate' | 'claimed' },
  ): Promise<void> {
    if (this.disposed) return;
    const prevUid = this.currentUser?.uid ?? this.previousAccountUid;
    const nextUid = normalizeOwnerUid(user?.uid ?? null);

    if (prevUid !== nextUid) {
      this.clearTimers();
    }

    this.currentUser = user;
    if (nextUid === null) {
      this.previousAccountUid = prevUid;
      this.emitState({
        status: 'local_only',
        lastError: null,
        ownershipPausedReason: null,
        unclaimedDecision: 'undecided',
        conflicts: [],
      });
      await this.refreshDiagnostics(null);
      return;
    }

    const summary = await this.repository.getOwnershipSummary(nextUid);
    const decision = evaluateOwnershipTransition({
      previousAccountUid: prevUid,
      nextAccountUid: nextUid,
      summary,
      unclaimedDecision: options?.priorDecision ?? (prevUid === nextUid ? this.state.unclaimedDecision : 'undecided'),
    });

    if (decision.action === 'pause_sync_for_ownership_verification') {
      this.emitState({
        status: 'auth_required',
        ownershipPausedReason: decision.pauseReason,
        unclaimedDecision: options?.priorDecision ?? 'undecided',
        ownershipSummary: summary,
        lastError: null,
      });
      return;
    }

    this.previousAccountUid = nextUid;
    this.emitState({
      ownershipPausedReason: null,
      ownershipSummary: summary,
      lastError: null,
    });

    if (options?.autoSyncIfAllowed !== false && this.isOnline) {
      await this.syncNow({ reason: 'auth_ready' });
    } else {
      await this.refreshDiagnostics(null);
    }
  }

  async resolveOwnershipPrompt(
    choice: 'claim_and_merge' | 'keep_local_separate' | 'confirm_account_switch',
  ): Promise<{ claimedCount: number; remappedCount: number }> {
    const user = this.currentUser;
    if (!user) {
      return { claimedCount: 0, remappedCount: 0 };
    }

    let claimedCount = 0;
    let remappedCount = 0;

    if (choice === 'claim_and_merge') {
      let existingTargetIds:
        | {
            projects?: string[];
            files?: string[];
            conversations?: string[];
            messages?: string[];
            voiceSessions?: string[];
          }
        | undefined;

      if (this.isOnline) {
        try {
          existingTargetIds = await this.remote.fetchExistingEntityIds(user.uid);
        } catch {
          // Proceed with local collision checks if offline
        }
      }

      const claimRes = await this.repository.claimUnclaimedLocalData(user.uid, {
        strategy: 'remap_colliding_ids',
        existingTargetIds,
      });
      claimedCount = claimRes.claimedCount;
      remappedCount =
        Object.keys(claimRes.remappedProjectIds).length +
        Object.keys(claimRes.remappedFileIds).length +
        Object.keys(claimRes.remappedConversationIds).length +
        Object.keys(claimRes.remappedMessageIds).length +
        Object.keys(claimRes.remappedVoiceSessionIds).length;

      this.previousAccountUid = user.uid;
      this.emitState({
        unclaimedDecision: 'claimed',
        ownershipPausedReason: null,
        lastError: null,
      });

      const refreshed = await this.repository.loadWorkspace({ activeOwnerUid: user.uid });
      this.callbacks.onRemoteChangesApplied?.(refreshed);
    } else if (choice === 'keep_local_separate') {
      this.previousAccountUid = user.uid;
      this.emitState({
        unclaimedDecision: 'keep_local_separate',
        ownershipPausedReason: null,
        lastError: null,
      });
    } else {
      this.previousAccountUid = user.uid;
      const summary = await this.repository.getOwnershipSummary(user.uid);
      if (summary.unclaimedCount > 0 && this.state.unclaimedDecision === 'undecided') {
        this.emitState({
          status: 'auth_required',
          ownershipPausedReason: 'unclaimed_local_data_present',
          ownershipSummary: summary,
        });
        return { claimedCount, remappedCount };
      }
      this.emitState({
        ownershipPausedReason: null,
        ownershipSummary: summary,
      });
    }

    await this.syncNow({ reason: 'ownership_resolved' });
    return { claimedCount, remappedCount };
  }

  dismissConflict(conflictId: string): void {
    const updated = this.state.conflicts.map((c) =>
      c.id === conflictId ? { ...c, dismissed: true } : c,
    );
    this.emitState({ conflicts: updated });
    void this.refreshDiagnostics();
  }

  clearDismissedConflicts(): void {
    const remaining = this.state.conflicts.filter((c) => !c.dismissed);
    this.emitState({ conflicts: remaining });
    void this.refreshDiagnostics();
  }

  notifyLocalDataChanged(): void {
    if (this.disposed || !this.currentUser || this.state.ownershipPausedReason !== null) {
      void this.refreshDiagnostics();
      return;
    }
    if (!this.isOnline) {
      void this.refreshDiagnostics();
      return;
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.syncNow({ reason: 'local_mutation' });
    }, 600);
  }

  async syncNow(options?: { reason?: string; pullOnly?: boolean; nowIso?: string }): Promise<void> {
    if (this.disposed) return;
    if (!this.currentUser) {
      await this.refreshDiagnostics(null);
      return;
    }
    if (this.state.ownershipPausedReason !== null) {
      await this.refreshDiagnostics(null);
      return;
    }
    if (!this.isOnline) {
      await this.refreshDiagnostics(this.state.lastError);
      return;
    }

    if (this.syncInFlight) {
      this.rerunRequested = true;
      await this.syncInFlight;
      return;
    }

    const run = this.executeSyncLoop(options).finally(() => {
      if (this.syncInFlight === run) {
        this.syncInFlight = null;
      }
      this.activeSyncPass = false;
    });
    this.syncInFlight = run;
    await run;
  }

  private async executeSyncLoop(options?: { reason?: string; pullOnly?: boolean; nowIso?: string }): Promise<void> {
    do {
      this.rerunRequested = false;
      await this.runSingleSyncPass(options);
    } while (
      !this.disposed &&
      this.rerunRequested &&
      this.currentUser &&
      this.isOnline &&
      this.state.ownershipPausedReason === null
    );
  }

  private async runSingleSyncPass(options?: { pullOnly?: boolean; nowIso?: string }): Promise<void> {
    const user = this.currentUser;
    if (!user || !this.isOnline || this.state.ownershipPausedReason !== null) {
      return;
    }

    const uid = user.uid;
    this.activeSyncPass = true;
    this.emitState({ status: 'syncing', lastError: null });

    try {
      await this.remote.ensureUserProfile(user);

      // Step 1: Pull cloud state & reconcile conflicts BEFORE draining local outbox
      const pullAt = new Date().toISOString();
      const [localSnapshot, localOutbox, localTombstones, remoteSnapshot] = await Promise.all([
        this.repository.loadWorkspace({ activeOwnerUid: uid }),
        this.repository.readOutbox({ ownerUid: uid }),
        this.repository.readTombstones({ ownerUid: uid }),
        this.remote.fetchUserCloudSnapshot(uid),
      ]);

      const reconciliation = reconcileCloudAndLocalWorkspace({
        ownerUid: uid,
        localSnapshot,
        localOutbox,
        localTombstones,
        remote: remoteSnapshot,
        nowIso: pullAt,
      });

      if (reconciliation.hasChanges) {
        await this.repository.applyRemoteSyncChanges(reconciliation.applyInput);
        const updatedSnapshot = await this.repository.loadWorkspace({ activeOwnerUid: uid });
        this.callbacks.onRemoteChangesApplied?.(updatedSnapshot);
      }

      if (reconciliation.conflicts.length > 0) {
        const mergedConflicts = [
          ...reconciliation.conflicts,
          ...this.state.conflicts.filter(
            (existing) => !reconciliation.conflicts.some((c) => c.id === existing.id),
          ),
        ].slice(0, 50);
        this.emitState({ conflicts: mergedConflicts });
      }

      let lastPushAt = this.state.lastPushAt;
      let retryDelayMs: number | null = null;
      let syncError: string | null = null;

      // Step 2: Drain outbox incrementally in dependency order
      if (!options?.pullOnly) {
        await this.repository.recoverExpiredOutboxLeases({
          ownerUid: uid,
          nowIso: options?.nowIso,
        });

        let safetyCounter = 0;
        while (safetyCounter < 20 && !this.disposed && this.isOnline) {
          safetyCounter += 1;
          const claimed = await this.repository.claimOutboxOperations({
            workerId: this.workerId,
            ownerUid: uid,
            limit: 25,
            leaseDurationMs: 30_000,
            nowIso: options?.nowIso,
          });
          if (claimed.length === 0) break;

          const ordered = sortOutboxForPush(claimed);
          const currentSnapshot = await this.repository.loadWorkspace({ activeOwnerUid: uid });
          const pushResult = await this.pushClaimedBatch(uid, ordered, currentSnapshot);
          lastPushAt = new Date().toISOString();

          if (pushResult.offlineDetected) {
            syncError = pushResult.errorMessage;
            retryDelayMs = pushResult.nextRetryDelayMs;
            break;
          }
          if (pushResult.errorMessage) {
            syncError = pushResult.errorMessage;
            retryDelayMs = pushResult.nextRetryDelayMs;
            break;
          }
          if (pushResult.conflictRetryNeeded) {
            this.rerunRequested = true;
          }
        }
      }

      // Step 3: Update sync checkpoint & prune old acknowledged tombstones (30-day retention)
      const nowIso = new Date().toISOString();
      const pruneCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      await this.repository.pruneAcknowledgedTombstones(pruneCutoff, { ownerUid: uid });

      if (this.isOnline && !syncError) {
        await this.remote.updateSyncMeta(uid, {
          lastPullAt: pullAt,
          ...(lastPushAt ? { lastPushAt } : {}),
        });
      }

      if (retryDelayMs !== null && this.isOnline) {
        this.scheduleRetry(retryDelayMs);
      }

      this.emitState({
        lastPullAt: pullAt,
        lastPushAt,
        lastSyncAt: syncError ? this.state.lastSyncAt : nowIso,
      });
      this.activeSyncPass = this.rerunRequested;
      await this.refreshDiagnostics(syncError);
    } catch (err) {
      const category = classifyFirestoreError(err);
      const friendly = formatUserFriendlyFirestoreError(err);
      if (category === 'transient' || category === 'offline') {
        this.scheduleRetry(5000);
      }
      this.activeSyncPass = false;
      await this.refreshDiagnostics(friendly);
    }
  }

  private async pushClaimedBatch(
    uid: string,
    batch: SyncOutboxRecord[],
    snapshot: PersistedWorkspaceSnapshot,
  ): Promise<{
    offlineDetected: boolean;
    errorMessage: string | null;
    nextRetryDelayMs: number | null;
    conflictRetryNeeded: boolean;
  }> {
    const projectMap = new Map(snapshot.projects.map((p) => [p.id, p]));
    const fileMap = new Map<string, { project: Project; file: ProjectFile }>();
    for (const p of snapshot.projects) {
      for (const f of p.files) {
        fileMap.set(f.id, { project: p, file: f });
      }
    }
    const convMap = new Map<string, Conversation>();
    for (const c of snapshot.conversations) convMap.set(c.id, c);
    for (const d of snapshot.deletedConversations) convMap.set(d.id, d);

    const msgMap = new Map<
      string,
      { conversation: Conversation; orderIndex: number; message: ChatMessage }
    >();
    for (const c of [...snapshot.conversations, ...snapshot.deletedConversations]) {
      c.messages.forEach((m, index) => {
        msgMap.set(m.id, { conversation: c, orderIndex: index, message: m });
      });
    }
    const voiceMap = new Map(snapshot.voiceSessions.map((v) => [v.id, v]));

    let conflictRetryNeeded = false;

    for (const item of batch) {
      if (!this.isOnline || this.disposed) {
        return {
          offlineDetected: !this.isOnline,
          errorMessage: 'Sync paused offline.',
          nextRetryDelayMs: null,
          conflictRetryNeeded,
        };
      }

      try {
        if (item.operation === 'delete') {
          await this.remote.deleteEntityWithTombstone(uid, {
            entityType: item.entityType,
            entityId: item.entityId,
            parentId: item.parentId ?? null,
            revision: item.revision,
            deletedAt: item.deletedAt || item.updatedAt,
          });
          await this.repository.acknowledgeOutboxOperations(
            [{ id: item.id, operationId: item.operationId }],
            { ownerUid: uid },
          );
          continue;
        }

        // Upsert operation
        let result: UpsertDocResult = { conflictDetected: false };
        if (item.entityType === 'project') {
          const proj = projectMap.get(item.entityId);
          if (proj) {
            result = await this.remote.upsertProject(uid, proj, {
              expectedBaseRevision: item.baseRevision,
            });
          }
        } else if (item.entityType === 'file') {
          const entry = fileMap.get(item.entityId);
          if (entry) {
            result = await this.remote.upsertFile(uid, entry.project.id, entry.file, {
              expectedBaseRevision: item.baseRevision,
              ensureParentProject: entry.project,
            });
          }
        } else if (item.entityType === 'conversation') {
          const conv = convMap.get(item.entityId);
          if (conv) {
            result = await this.remote.upsertConversation(uid, conv, {
              expectedBaseRevision: item.baseRevision,
            });
          }
        } else if (item.entityType === 'message') {
          const entry = msgMap.get(item.entityId);
          if (entry) {
            result = await this.remote.upsertMessage(
              uid,
              entry.conversation.id,
              entry.orderIndex,
              entry.message,
              {
                expectedBaseRevision: item.baseRevision,
                ensureParentConversation: entry.conversation,
              },
            );
          }
        } else if (item.entityType === 'voice_session') {
          const session = voiceMap.get(item.entityId);
          if (session) {
            result = await this.remote.upsertVoiceSession(uid, session, {
              expectedBaseRevision: item.baseRevision,
            });
          }
        } else if (item.entityType === 'setting') {
          const key = item.entityId as PreferenceKey;
          if (isSettingSyncable(key)) {
            const val = snapshot.preferences[key];
            if (val !== undefined) {
              result = await this.remote.upsertPreference(
                uid,
                key,
                val,
                item.revision,
                item.updatedAt,
                { expectedBaseRevision: item.baseRevision },
              );
            }
          }
        }

        if (result.conflictDetected) {
          // Leave in outbox and reset lease quickly so next reconciliation pass resolves cleanly
          await this.repository.recoverExpiredOutboxLeases({
            ownerUid: uid,
            nowIso: new Date(Date.now() + 60_000).toISOString(),
          });
          conflictRetryNeeded = true;
          continue;
        }

        // Ack strictly AFTER remote confirmation
        await this.repository.acknowledgeOutboxOperations(
          [{ id: item.id, operationId: item.operationId }],
          { ownerUid: uid },
        );
      } catch (err) {
        const category = classifyFirestoreError(err);
        const friendly = formatUserFriendlyFirestoreError(err);
        const permanent = category === 'permanent' || category === 'permission_denied';

        const updatedOutbox = await this.repository.markOutboxOperationFailed(
          { id: item.id, operationId: item.operationId, ownerUid: uid },
          friendly,
          { backoffMs: 5000, maxRetries: 5, permanent },
        );

        let nextRetryDelayMs: number | null = null;
        if (updatedOutbox?.nextRetryAt) {
          nextRetryDelayMs = Math.max(1000, Date.parse(updatedOutbox.nextRetryAt) - Date.now());
        }

        return {
          offlineDetected: category === 'offline',
          errorMessage: friendly,
          nextRetryDelayMs,
          conflictRetryNeeded,
        };
      }
    }

    return {
      offlineDetected: false,
      errorMessage: null,
      nextRetryDelayMs: null,
      conflictRetryNeeded,
    };
  }

  private scheduleRetry(delayMs: number): void {
    if (this.disposed || !this.isOnline) return;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.syncNow({ reason: 'retry_backoff' });
    }, Math.max(1000, delayMs));
  }

  private clearTimers(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }
}
