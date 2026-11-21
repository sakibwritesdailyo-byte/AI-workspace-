import { useEffect, useState } from 'react';
import { AlertTriangle, FileUp, X } from 'lucide-react';
import type { ImportInspectionPreview } from '../types/workspace';

interface ImportPreviewDialogProps {
  preview: ImportInspectionPreview | null;
  importing?: boolean;
  importError?: string | null;
  onConfirm: (duplicateStrategy: 'skip' | 'copy', restorePreferences: boolean) => void;
  onCancel: () => void;
}

export function ImportPreviewDialog({
  preview,
  importing = false,
  importError = null,
  onConfirm,
  onCancel,
}: ImportPreviewDialogProps) {
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'copy'>('copy');
  const [restorePreferences, setRestorePreferences] = useState(false);

  useEffect(() => {
    setDuplicateStrategy('copy');
    setRestorePreferences(false);
  }, [preview]);

  if (!preview || !preview.valid || !preview.bundle) return null;

  const duplicateCount =
    preview.duplicateProjectIds.length +
    preview.duplicateConversationIds.length +
    preview.duplicateDeletedIds.length +
    preview.duplicateVoiceSessionIds.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        aria-hidden="true"
        onClick={() => {
          if (!importing) onCancel();
        }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div className="relative z-10 w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl border border-white/[0.12] bg-[#10141A] p-5 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/12 border border-emerald-500/25 flex items-center justify-center shrink-0 mt-0.5">
              <FileUp className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 id="import-preview-title" className="text-base font-semibold text-zinc-100">
                Review Backup Before Import
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Schema v{preview.schemaVersion} ·{' '}
                {preview.backupType === 'project' ? 'Single project backup' : 'Workspace backup'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={importing}
            onClick={onCancel}
            aria-label="Close import preview"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#090B0E] p-3.5 grid grid-cols-2 gap-2.5 text-xs">
          <div className="flex justify-between">
            <span className="text-zinc-400">Projects</span>
            <span className="font-mono text-zinc-100">{preview.projectCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Files</span>
            <span className="font-mono text-zinc-100">{preview.fileCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Conversations</span>
            <span className="font-mono text-zinc-100">{preview.conversationCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Trash Items</span>
            <span className="font-mono text-zinc-100">{preview.deletedCount}</span>
          </div>
          <div className="flex justify-between col-span-2 pt-1.5 border-t border-white/[0.06]">
            <span className="text-zinc-400">Voice Session Logs</span>
            <span className="font-mono text-zinc-100">{preview.voiceSessionCount}</span>
          </div>
        </div>

        {duplicateCount > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-2.5 text-xs">
            <div className="flex items-start gap-2 text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
              <span>
                Detected <strong>{duplicateCount}</strong> existing ID
                {duplicateCount === 1 ? '' : 's'} already stored in IndexedDB. Existing records will
                not be overwritten.
              </span>
            </div>

            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2.5 min-h-[32px] cursor-pointer text-zinc-200">
                <input
                  type="radio"
                  name="dup-strategy"
                  checked={duplicateStrategy === 'copy'}
                  disabled={importing}
                  onChange={() => setDuplicateStrategy('copy')}
                  className="accent-emerald-500 w-4 h-4"
                />
                <span>Import duplicates as new copies (Recommended)</span>
              </label>
              <label className="flex items-center gap-2.5 min-h-[32px] cursor-pointer text-zinc-300">
                <input
                  type="radio"
                  name="dup-strategy"
                  checked={duplicateStrategy === 'skip'}
                  disabled={importing}
                  onChange={() => setDuplicateStrategy('skip')}
                  className="accent-emerald-500 w-4 h-4"
                />
                <span>Skip duplicate IDs (keep existing only)</span>
              </label>
            </div>
          </div>
        )}

        {preview.hasPreferences && (
          <label className="rounded-xl border border-white/[0.08] bg-[#090B0E] p-3.5 flex items-start gap-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={restorePreferences}
              disabled={importing}
              onChange={(e) => setRestorePreferences(e.target.checked)}
              className="accent-emerald-500 w-4 h-4 mt-0.5 shrink-0"
            />
            <span className="text-zinc-200 leading-relaxed">
              Restore studio preferences (voice, model, and editor settings) from this backup.
              <span className="block text-zinc-400 mt-0.5">
                Unchecked by default so your current device settings stay preserved.
              </span>
            </span>
          </label>
        )}

        {importError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/35 bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-200"
          >
            {importError}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={importing}
            onClick={onCancel}
            className="min-h-[44px] px-4 rounded-xl border border-white/[0.1] hover:bg-white/[0.06] text-xs font-medium text-zinc-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={importing}
            onClick={() => onConfirm(duplicateStrategy, restorePreferences)}
            className="min-h-[44px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#052317] text-xs font-semibold disabled:opacity-60"
          >
            {importing ? 'Importing to IndexedDB…' : 'Confirm Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
