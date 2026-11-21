import { AlertCircle, CloudUpload, HardDrive, ShieldCheck } from 'lucide-react';
import type { AuthUserProfile, OwnershipSummary } from '../../types/workspace';

interface ClaimLocalDataDialogProps {
  open: boolean;
  user: AuthUserProfile | null;
  pauseReason: 'unclaimed_local_data_present' | 'account_switched' | null;
  ownershipSummary: OwnershipSummary | null;
  busy: boolean;
  error: string | null;
  onClaimAndMerge: () => void;
  onKeepSeparate: () => void;
  onConfirmAccountSwitch: () => void;
  onSignOut: () => void;
}

export function ClaimLocalDataDialog({
  open,
  user,
  pauseReason,
  ownershipSummary,
  busy,
  error,
  onClaimAndMerge,
  onKeepSeparate,
  onConfirmAccountSwitch,
  onSignOut,
}: ClaimLocalDataDialogProps) {
  if (!open || !user || !pauseReason) return null;

  const isUnclaimedPrompt = pauseReason === 'unclaimed_local_data_present';
  const accountLabel = user.email || user.displayName || user.uid;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="claim-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div aria-hidden="true" className="fixed inset-0 bg-black/75 backdrop-blur-sm" />

      <div className="relative z-10 w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-2xl border border-white/[0.12] bg-[#10141A] p-5 shadow-2xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/12 border border-emerald-500/25 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-emerald-300" />
          </div>
          <div>
            <h2 id="claim-dialog-title" className="text-base font-semibold text-zinc-100">
              {isUnclaimedPrompt
                ? 'Unclaimed Local Workspace Found'
                : 'Confirm Account Scope Switch'}
            </h2>
            <p className="text-xs leading-relaxed text-zinc-400 mt-1">
              {isUnclaimedPrompt
                ? `You are signed in as ${accountLabel}. Choose what should happen to the local-only workspace items created on this device before syncing.`
                : `You switched to ${accountLabel}. Cloud sync is paused to keep another account's cached records separate on this device.`}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#090B0E] p-3.5 space-y-2 text-xs">
          <div className="flex items-center justify-between text-zinc-300">
            <span>Signed-in Account</span>
            <span className="font-medium text-emerald-300 truncate max-w-[230px]">
              {accountLabel}
            </span>
          </div>
          {isUnclaimedPrompt ? (
            <>
              <div className="flex items-center justify-between text-zinc-300">
                <span>Local-Only Workspace Records</span>
                <span className="font-mono tabular-nums text-zinc-100">
                  {ownershipSummary?.unclaimedCount ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between text-zinc-300">
                <span>Account Cloud Cache on Device</span>
                <span className="font-mono tabular-nums text-zinc-100">
                  {ownershipSummary?.activeAccountCount ?? 0}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between text-zinc-300">
                <span>Other Cached Account Records</span>
                <span className="font-mono tabular-nums text-zinc-100">
                  {ownershipSummary?.otherAccountCount ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between text-zinc-300">
                <span>Active Account Records</span>
                <span className="font-mono tabular-nums text-zinc-100">
                  {ownershipSummary?.activeAccountCount ?? 0}
                </span>
              </div>
            </>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/35 bg-rose-950/40 px-3 py-2.5 text-xs text-rose-100 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isUnclaimedPrompt ? (
          <div className="space-y-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={onClaimAndMerge}
              data-testid="claim-merge-button"
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#052317] text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <CloudUpload className="w-4 h-4 shrink-0" />
              <span>{busy ? 'Merging & Syncing…' : 'Merge Local Data Into Account & Sync'}</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={onKeepSeparate}
              data-testid="keep-separate-button"
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-zinc-100 flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <HardDrive className="w-4 h-4 shrink-0 text-zinc-400" />
              <span>Keep Local Data Separate on Device & Load Cloud Workspace</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={onSignOut}
              className="flex-1 min-h-[44px] px-4 rounded-xl border border-white/15 bg-transparent hover:bg-white/[0.06] text-xs font-medium text-zinc-200 transition-colors disabled:opacity-50"
            >
              Sign Out
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirmAccountSwitch}
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#052317] text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {busy ? 'Switching…' : 'Continue With This Account'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
