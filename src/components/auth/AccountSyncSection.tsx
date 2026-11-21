import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  LogIn,
  LogOut,
  MailCheck,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { sendVerificationEmailToCurrentUser } from '../../services/firebase/firebaseAuth';
import type { AuthStatus, AuthUserProfile, SyncEngineState } from '../../types/workspace';
import { SyncStatusBadge } from '../sync/SyncStatusBadge';

interface AccountSyncSectionProps {
  authStatus: AuthStatus;
  authError: string | null;
  user: AuthUserProfile | null;
  syncState: SyncEngineState;
  onOpenAuthModal: (mode: 'signin' | 'signup') => void;
  onSyncNow: () => void;
  onOpenClaimDialog: () => void;
  onDismissConflict: (conflictId: string) => void;
  onSignOut: () => void;
  onRequestDeleteAccount: () => void;
}

function formatRelativeOrIso(iso: string | null): string {
  if (!iso) return 'Not yet synced';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function describeConflictReason(reason: string): string {
  switch (reason) {
    case 'concurrent_edit':
      return 'Both devices edited this item while offline; local work was preserved as a conflict copy.';
    case 'delete_vs_edit':
      return 'Deleted on one side while modified on another; preserved as a restored copy.';
    case 'setting_divergence':
      return 'Preferences differed across devices and resolved by revision & timestamp.';
    default:
      return 'Revision divergence resolved automatically without data loss.';
  }
}

export function AccountSyncSection({
  authStatus,
  authError,
  user,
  syncState,
  onOpenAuthModal,
  onSyncNow,
  onOpenClaimDialog,
  onDismissConflict,
  onSignOut,
  onRequestDeleteAccount,
}: AccountSyncSectionProps) {
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);
  const [sendingVerify, setSendingVerify] = useState(false);

  const activeConflicts = syncState.conflicts.filter((c) => !c.dismissed);
  const isPasswordUser = Boolean(user?.providerIds.includes('password'));
  const showVerifyPrompt = Boolean(user && !user.emailVerified && isPasswordUser);
  const unclaimedCount = syncState.ownershipSummary?.unclaimedCount ?? 0;

  const handleSendVerification = async () => {
    if (sendingVerify) return;
    setSendingVerify(true);
    setVerifyNotice(null);
    try {
      const res = await sendVerificationEmailToCurrentUser();
      setVerifyNotice(
        res.ok
          ? 'Verification email sent. Check your inbox and reload after verifying.'
          : res.message || 'Unable to send verification email.',
      );
    } finally {
      setSendingVerify(false);
    }
  };

  return (
    <section data-testid="account-sync-section" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
          <Cloud className="w-3.5 h-3.5 text-emerald-400" />
          <span>Account & Cloud Sync</span>
        </div>
        <SyncStatusBadge authStatus={authStatus} user={user} syncState={syncState} />
      </div>

      {authError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/35 bg-rose-950/40 px-3 py-2 text-xs text-rose-100 flex items-start gap-2"
        >
          <AlertCircle className="w-3.5 h-3.5 text-rose-300 shrink-0 mt-0.5" />
          <span>{authError}</span>
        </div>
      )}

      {!user ? (
        <div className="rounded-xl border border-white/[0.08] bg-[#090B0E] p-3.5 space-y-3">
          <p className="text-xs leading-relaxed text-zinc-400">
            Running in local-only mode. Sign in or create an account to back up and synchronize
            projects, conversations, and studio preferences across devices.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenAuthModal('signin')}
              data-testid="settings-signin-button"
              className="flex-1 min-h-[40px] px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#052317] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenAuthModal('signup')}
              data-testid="settings-signup-button"
              className="flex-1 min-h-[40px] px-3 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-zinc-100 inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create Account</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Profile Card */}
          <div className="rounded-xl border border-white/[0.08] bg-[#090B0E] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-zinc-100 truncate">
                  {user.displayName || user.email || 'Signed-in Account'}
                </p>
                {user.email && (
                  <p className="text-[11px] text-zinc-400 truncate">{user.email}</p>
                )}
              </div>
              <span className="shrink-0 rounded-md border border-white/[0.1] bg-white/[0.04] px-2 py-0.5 text-[11px] text-zinc-300">
                {user.providerIds.includes('google.com') ? 'Google' : 'Email'}
              </span>
            </div>

            {showVerifyPrompt && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5 space-y-2">
                <div className="flex items-start gap-2 text-[11px] text-amber-200">
                  <MailCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Email address not verified yet.</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSendVerification()}
                  disabled={sendingVerify}
                  className="min-h-[34px] px-2.5 rounded-md bg-amber-400/20 hover:bg-amber-400/30 text-[11px] font-medium text-amber-100 transition-colors"
                >
                  {sendingVerify ? 'Sending…' : 'Send Verification Email'}
                </button>
                {verifyNotice && (
                  <p className="text-[11px] text-amber-100 leading-snug">{verifyNotice}</p>
                )}
              </div>
            )}

            <div className="pt-2 border-t border-white/[0.06] space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-400">Last Synced</span>
                <span className="font-mono text-zinc-200">
                  {formatRelativeOrIso(syncState.lastSyncAt)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Pending Outbox</span>
                <span className="font-mono tabular-nums text-zinc-200">
                  {syncState.pendingCount + syncState.inFlightCount}
                </span>
              </div>
              {syncState.failedCount > 0 && (
                <div className="flex justify-between">
                  <span className="text-rose-300">Failed Items</span>
                  <span className="font-mono tabular-nums text-rose-200">
                    {syncState.failedCount}
                  </span>
                </div>
              )}
            </div>

            {syncState.ownershipPausedReason && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-2">
                <div className="flex items-start gap-2 text-[11px] text-amber-100">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
                  <span>
                    Sync is paused until you confirm how local data should be handled for this
                    account.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onOpenClaimDialog}
                  className="w-full min-h-[36px] px-3 rounded-lg bg-amber-400 text-[#1b1403] text-xs font-semibold hover:bg-amber-300 transition-colors"
                >
                  Review & Confirm Local Data
                </button>
              </div>
            )}

            {!syncState.ownershipPausedReason &&
              unclaimedCount > 0 &&
              syncState.unclaimedDecision === 'keep_local_separate' && (
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-2.5 space-y-2">
                  <p className="text-[11px] text-zinc-300 leading-snug">
                    {unclaimedCount} local-only record(s) on this device remain separate from this
                    cloud account.
                  </p>
                  <button
                    type="button"
                    onClick={onOpenClaimDialog}
                    className="w-full min-h-[34px] px-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-[11px] font-medium text-emerald-200 transition-colors"
                  >
                    Merge Local Data Into Account
                  </button>
                </div>
              )}

            {syncState.lastError && (
              <div
                role="alert"
                className="rounded-lg border border-rose-500/30 bg-rose-950/40 p-2.5 text-[11px] text-rose-100 flex items-start gap-2"
              >
                <AlertCircle className="w-3.5 h-3.5 text-rose-300 shrink-0 mt-0.5" />
                <span>{syncState.lastError}</span>
              </div>
            )}

            <button
              type="button"
              onClick={onSyncNow}
              disabled={syncState.status === 'syncing' || Boolean(syncState.ownershipPausedReason)}
              data-testid="sync-now-button"
              className="w-full min-h-[40px] px-3 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-xs font-semibold text-emerald-200 inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-45"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${syncState.status === 'syncing' ? 'animate-spin' : ''}`}
              />
              <span>{syncState.status === 'syncing' ? 'Syncing Workspace…' : 'Sync Now'}</span>
            </button>
          </div>

          {/* Conflict Notices */}
          {activeConflicts.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-3 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                <span>Resolved Conflicts ({activeConflicts.length})</span>
              </div>
              <div className="space-y-2">
                {activeConflicts.map((conflict) => (
                  <div
                    key={conflict.id}
                    className="rounded-lg border border-white/[0.08] bg-[#090B0E] p-2.5 space-y-1.5 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-zinc-100 truncate">
                        {conflict.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDismissConflict(conflict.id)}
                        className="text-zinc-400 hover:text-zinc-200 shrink-0"
                      >
                        Dismiss
                      </button>
                    </div>
                    <p className="text-zinc-400 leading-snug">
                      {describeConflictReason(conflict.reason)}
                    </p>
                    {conflict.preservedCopyLabel && (
                      <p className="text-emerald-300 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                        <span>Preserved: {conflict.preservedCopyLabel}</span>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Account Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSignOut}
              data-testid="sign-out-button"
              className="flex-1 min-h-[40px] px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-zinc-200 inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
            <button
              type="button"
              onClick={onRequestDeleteAccount}
              data-testid="delete-account-button"
              className="flex-1 min-h-[40px] px-3 rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-xs font-medium text-rose-200 inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Account</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
