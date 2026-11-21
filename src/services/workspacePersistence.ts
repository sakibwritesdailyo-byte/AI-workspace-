import type { WorkspaceStorageStats } from '../types/workspace';
import { DEVICE_LOCAL_SETTING_KEYS, type PreferenceKey } from './settingsPolicy';
import type {
  PersistedWorkspaceSnapshot,
  WorkspaceRepository,
} from './workspaceRepository';

export interface PersistenceTarget {
  hydrated: boolean;
  autosaveEnabled: boolean;
  dataRevision: number;
  uiRevision: number;
  ownerUid?: string | null;
  snapshot: PersistedWorkspaceSnapshot;
}

export interface PersistenceCallbacks {
  onSaving?: (targetRevision: number) => void;
  onSaved?: (persistedRevision: number, savedAt: string, stats: WorkspaceStorageStats) => void;
  onUiPersisted?: (persistedUiRevision: number) => void;
  onError?: (message: string, failedRevision: number) => void;
}

const UI_POINTER_KEYS: Array<PreferenceKey> = [...DEVICE_LOCAL_SETTING_KEYS];

/**
 * Serialized, coalescing, revision-aware persistence coordinator.
 * Ensures:
 * - Hydration triggers zero redundant database writes.
 * - Pure UI pointer changes only update device_local keys in `settings`, never data stores or sync_outbox.
 * - Only one async write runs at a time; newer edits made during an active write
 *   are coalesced into a follow-up pass rather than dropped or falsely marked clean.
 * - Exclusive clear waits for active writes, aborts stale in-flight completions via clearEpoch,
 *   and only resets the baseline if the database clear actually succeeds.
 */
export class WorkspacePersistenceCoordinator {
  private readonly repository: WorkspaceRepository;
  private readonly getTarget: () => PersistenceTarget;
  private readonly callbacks: PersistenceCallbacks;
  private readonly debounceMs: number;

  private lastSnapshot: PersistedWorkspaceSnapshot | null = null;
  private lastDataRevision = 0;
  private lastUiRevision = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private clearEpoch = 0;
  private clearing = false;
  private disposed = false;

  constructor(
    repository: WorkspaceRepository,
    getTarget: () => PersistenceTarget,
    callbacks: PersistenceCallbacks = {},
    debounceMs = 180,
  ) {
    this.repository = repository;
    this.getTarget = getTarget;
    this.callbacks = callbacks;
    this.debounceMs = debounceMs;
  }

  markHydrated(
    snapshot: PersistedWorkspaceSnapshot,
    dataRevision = 0,
    uiRevision = 0,
  ): void {
    this.lastSnapshot = snapshot;
    this.lastDataRevision = dataRevision;
    this.lastUiRevision = uiRevision;
  }

  resetBaseline(snapshot: PersistedWorkspaceSnapshot, dataRevision = 0, uiRevision = 0): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.lastSnapshot = snapshot;
    this.lastDataRevision = dataRevision;
    this.lastUiRevision = uiRevision;
  }

  getLastPersistedRevision(): number {
    return this.lastDataRevision;
  }

  getLastCommittedSnapshot(): PersistedWorkspaceSnapshot | null {
    return this.lastSnapshot;
  }

  isClearing(): boolean {
    return this.clearing;
  }

  scheduleSave(): void {
    if (this.disposed || this.clearing) return;
    const current = this.getTarget();
    if (!current.hydrated || !current.autosaveEnabled) return;
    if (
      current.dataRevision <= this.lastDataRevision &&
      current.uiRevision <= this.lastUiRevision
    ) {
      return;
    }

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.disposed || this.clearing) return;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.inFlight) {
      await this.inFlight;
      if (this.disposed || this.clearing) return;
      const post = this.getTarget();
      if (
        post.hydrated &&
        (post.dataRevision > this.lastDataRevision || post.uiRevision > this.lastUiRevision)
      ) {
        return this.flush();
      }
      return;
    }

    const run = this.drainPendingLoop().finally(() => {
      if (this.inFlight === run) {
        this.inFlight = null;
      }
    });
    this.inFlight = run;
    await run;
  }

  /**
   * Coordinates destructive local clear with any pending debounce timer or active flush:
   * blocks new saves, awaits any in-flight flush, invalidates stale save epochs,
   * runs `clearOperation`, and resets the persistence baseline only if clear succeeded.
   */
  async runExclusiveClear<T>(
    clearOperation: () => Promise<T>,
    resetSnapshot: PersistedWorkspaceSnapshot,
  ): Promise<T> {
    this.clearing = true;
    this.clearEpoch += 1;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    try {
      while (this.inFlight) {
        await this.inFlight;
      }
      const result = await clearOperation();
      this.resetBaseline(resetSnapshot, 0, 0);
      return result;
    } finally {
      this.clearing = false;
    }
  }

  private async drainPendingLoop(): Promise<void> {
    const epoch = this.clearEpoch;

    while (!this.disposed && !this.clearing && epoch === this.clearEpoch) {
      const target = this.getTarget();
      if (!target.hydrated) return;

      const needsDataSave = target.dataRevision > this.lastDataRevision;
      const needsUiOnlySave = !needsDataSave && target.uiRevision > this.lastUiRevision;

      if (!needsDataSave && !needsUiOnlySave) {
        return;
      }

      if (needsUiOnlySave) {
        try {
          await this.repository.saveSettings(
            target.snapshot.preferences,
            UI_POINTER_KEYS,
            { ownerUid: target.ownerUid ?? null },
          );
          if (this.disposed || this.clearing || epoch !== this.clearEpoch) {
            return;
          }
          this.lastSnapshot = {
            ...(this.lastSnapshot ?? target.snapshot),
            preferences: target.snapshot.preferences,
          };
          this.lastUiRevision = target.uiRevision;
          this.callbacks.onUiPersisted?.(target.uiRevision);
        } catch (err) {
          if (this.disposed || this.clearing || epoch !== this.clearEpoch) {
            return;
          }
          const msg =
            err instanceof Error
              ? `Local settings save failed: ${err.message}`
              : 'Failed saving selection state to IndexedDB.';
          this.callbacks.onError?.(msg, target.dataRevision);
          return;
        }
        continue;
      }

      const targetDataRev = target.dataRevision;
      const targetUiRev = target.uiRevision;
      this.callbacks.onSaving?.(targetDataRev);

      try {
        const stats = await this.repository.commitWorkspaceDelta(
          this.lastSnapshot,
          target.snapshot,
          { ownerUid: target.ownerUid ?? null },
        );
        if (this.disposed || this.clearing || epoch !== this.clearEpoch) {
          return;
        }
        this.lastSnapshot = target.snapshot;
        this.lastDataRevision = targetDataRev;
        this.lastUiRevision = Math.max(this.lastUiRevision, targetUiRev);
        this.callbacks.onSaved?.(targetDataRev, new Date().toISOString(), stats);
      } catch (err) {
        if (this.disposed || this.clearing || epoch !== this.clearEpoch) {
          return;
        }
        const msg =
          err instanceof Error
            ? `Local save failed: ${err.message}`
            : 'Failed saving changes to IndexedDB.';
        this.callbacks.onError?.(msg, targetDataRev);
        return;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
