import type { OwnershipSummary, SyncEntityType } from '../types/workspace';

/**
 * Local Ownership & Account Isolation Policy (Phase 2.5.2 -> Phase 3).
 *
 * Core invariants:
 * 1. `ownerUid: null` represents unclaimed local-only records created before authentication
 *    or deliberately kept local on this device.
 * 2. Signing into an account MUST NEVER automatically reassign `ownerUid: null` records
 *    to the signed-in account. Only an explicit transactional claim flow may do so.
 * 3. `ownerUid: '<uid>'` records and outbox entries are isolated per UID. Signing out keeps
 *    them safely stored in IndexedDB without exposing them to another account or unclaimed mode.
 * 4. Outbox claiming/pushing MUST filter strictly by `ownerUid`, guaranteeing Account A's
 *    pending mutations can never upload under Account B.
 */

export interface OwnershipScope {
  /** `null` = unclaimed/anonymous local workspace; string = authenticated account UID */
  activeOwnerUid: string | null;
}

export type OwnershipTransitionDecision =
  | {
      action: 'proceed_local_only';
      syncAllowed: false;
      pauseReason: null;
      requiresExplicitClaimDecision: false;
    }
  | {
      action: 'proceed_account_sync';
      syncAllowed: true;
      pauseReason: null;
      requiresExplicitClaimDecision: false;
    }
  | {
      action: 'pause_sync_for_ownership_verification';
      syncAllowed: false;
      pauseReason: 'unclaimed_local_data_present' | 'account_switched';
      requiresExplicitClaimDecision: boolean;
    };

export function normalizeOwnerUid(ownerUid?: string | null): string | null {
  if (typeof ownerUid !== 'string') return null;
  const trimmed = ownerUid.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function ownerScopeKey(ownerUid?: string | null): string {
  return normalizeOwnerUid(ownerUid) ?? 'local';
}

export function buildScopedOutboxId(
  ownerUid: string | null | undefined,
  entityType: SyncEntityType,
  entityId: string,
): string {
  return `${ownerScopeKey(ownerUid)}:${entityType}:${entityId}`;
}

export function recordBelongsToOwner(
  recordOwnerUid: string | null | undefined,
  scopeOwnerUid: string | null | undefined,
): boolean {
  return normalizeOwnerUid(recordOwnerUid) === normalizeOwnerUid(scopeOwnerUid);
}

/**
 * Evaluates whether Phase 3 cloud sync may start automatically or must pause
 * when authentication state or account identity changes.
 */
export function evaluateOwnershipTransition(input: {
  previousAccountUid: string | null;
  nextAccountUid: string | null;
  summary: OwnershipSummary;
  unclaimedDecision?: 'undecided' | 'keep_local_separate' | 'claimed';
}): OwnershipTransitionDecision {
  const prevUid = normalizeOwnerUid(input.previousAccountUid);
  const nextUid = normalizeOwnerUid(input.nextAccountUid);

  if (nextUid === null) {
    // Sign-out: pause cloud sync, keep all local and account-owned IndexedDB data intact
    return {
      action: 'proceed_local_only',
      syncAllowed: false,
      pauseReason: null,
      requiresExplicitClaimDecision: false,
    };
  }

  // Switching from Account A directly to Account B requires explicit session isolation verification
  if (prevUid !== null && prevUid !== nextUid) {
    return {
      action: 'pause_sync_for_ownership_verification',
      syncAllowed: false,
      pauseReason: 'account_switched',
      requiresExplicitClaimDecision: input.summary.unclaimedCount > 0,
    };
  }

  // First sign-in with unclaimed local data present: pause automatic sync until user explicitly chooses
  if (
    input.summary.unclaimedCount > 0 &&
    input.unclaimedDecision !== 'keep_local_separate' &&
    input.unclaimedDecision !== 'claimed'
  ) {
    return {
      action: 'pause_sync_for_ownership_verification',
      syncAllowed: false,
      pauseReason: 'unclaimed_local_data_present',
      requiresExplicitClaimDecision: true,
    };
  }

  return {
    action: 'proceed_account_sync',
    syncAllowed: true,
    pauseReason: null,
    requiresExplicitClaimDecision: false,
  };
}
