import { useEffect, useState } from 'react';
import { AlertTriangle, Lock, X } from 'lucide-react';
import type { AuthUserProfile } from '../../types/workspace';

interface DeleteAccountDialogProps {
  open: boolean;
  user: AuthUserProfile | null;
  busy: boolean;
  needsReauth: boolean;
  error: string | null;
  onConfirmDelete: (options: {
    deleteLocalData: boolean;
    reauthPassword?: string;
    reauthWithGoogle?: boolean;
  }) => void;
  onCancel: () => void;
}

export function DeleteAccountDialog({
  open,
  user,
  busy,
  needsReauth,
  error,
  onConfirmDelete,
  onCancel,
}: DeleteAccountDialogProps) {
  const [confirmText, setConfirmText] = useState('');
  const [deleteLocalData, setDeleteLocalData] = useState(true);
  const [reauthPassword, setReauthPassword] = useState('');

  useEffect(() => {
    if (open) {
      setConfirmText('');
      setDeleteLocalData(true);
      setReauthPassword('');
    }
  }, [open]);

  if (!open || !user) return null;

  const hasPasswordProvider = user.providerIds.includes('password');
  const hasGoogleProvider = user.providerIds.includes('google.com');
  const confirmedWord = confirmText.trim().toUpperCase() === 'DELETE';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmedWord || busy) return;
    if (needsReauth && hasPasswordProvider && !reauthPassword) return;
    onConfirmDelete({
      deleteLocalData,
      reauthPassword: needsReauth && hasPasswordProvider ? reauthPassword : undefined,
      reauthWithGoogle: needsReauth && !hasPasswordProvider && hasGoogleProvider,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        aria-hidden="true"
        onClick={() => {
          if (!busy) onCancel();
        }}
        className="fixed inset-0 bg-black/75 backdrop-blur-sm"
      />

      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-2xl border border-rose-500/30 bg-[#10141A] p-5 shadow-2xl space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/12 border border-rose-500/30 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <h2 id="delete-account-title" className="text-base font-semibold text-zinc-100">
                Delete Cloud Account?
              </h2>
              <p className="text-xs leading-relaxed text-zinc-400 mt-1">
                This permanently deletes your Firebase Authentication account (
                <span className="text-zinc-200">{user.email || user.uid}</span>) and all Firestore
                projects, files, conversations, messages, voice logs, and cloud preferences.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close delete account dialog"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-[#090B0E] p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={deleteLocalData}
            onChange={(e) => setDeleteLocalData(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-rose-500 rounded"
          />
          <span className="text-xs leading-relaxed text-zinc-300">
            Also remove this account&apos;s cached data from local IndexedDB on this device (keeps
            separate local-only items intact).
          </span>
        </label>

        {needsReauth && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2.5">
            <p className="text-xs font-medium text-amber-200">
              Recent authentication required before deleting your account.
            </p>
            {hasPasswordProvider ? (
              <label className="block space-y-1">
                <span className="text-xs text-zinc-300">Confirm Current Password</span>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="password"
                    value={reauthPassword}
                    onChange={(e) => setReauthPassword(e.target.value)}
                    placeholder="Enter current password"
                    required
                    className="w-full h-10 pl-9 pr-3 rounded-lg bg-[#090B0E] border border-white/15 text-xs text-zinc-100 focus:outline-none focus:border-rose-400"
                  />
                </div>
              </label>
            ) : (
              <p className="text-xs text-zinc-300">
                Click the delete button below to re-authenticate with Google and complete account
                removal.
              </p>
            )}
          </div>
        )}

        <label className="block space-y-1.5">
          <span className="text-xs text-zinc-300">
            Type <span className="font-mono font-semibold text-rose-300">DELETE</span> to confirm
          </span>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            className="w-full h-11 px-3 rounded-xl bg-[#090B0E] border border-white/15 text-sm font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-rose-400"
          />
        </label>

        {error && (
          <p role="alert" className="text-xs text-rose-300">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-[44px] px-4 rounded-xl border border-white/12 hover:bg-white/[0.06] text-xs font-medium text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !confirmedWord || (needsReauth && hasPasswordProvider && !reauthPassword)}
            className="min-h-[44px] px-4 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-semibold transition-colors disabled:opacity-45"
          >
            {busy
              ? 'Deleting Account…'
              : needsReauth && hasGoogleProvider && !hasPasswordProvider
                ? 'Re-authenticate with Google & Delete'
                : 'Delete Account Forever'}
          </button>
        </div>
      </form>
    </div>
  );
}
