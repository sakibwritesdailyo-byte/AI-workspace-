import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  HardDrive,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import type { AuthStatus, AuthUserProfile, SyncEngineState } from '../../types/workspace';

interface SyncStatusBadgeProps {
  authStatus: AuthStatus;
  user: AuthUserProfile | null;
  syncState: SyncEngineState;
  compact?: boolean;
  onClick?: () => void;
}

export function SyncStatusBadge({
  authStatus,
  user,
  syncState,
  compact = false,
  onClick,
}: SyncStatusBadgeProps) {
  const activeConflicts = syncState.conflicts.filter((c) => !c.dismissed).length;
  const totalQueued = syncState.pendingCount + syncState.inFlightCount;

  let label = 'Local Only';
  let toneClasses =
    'text-zinc-300 bg-white/[0.04] border-white/[0.1] hover:bg-white/[0.08]';
  let Icon = HardDrive;
  let iconClass = 'w-3.5 h-3.5 text-zinc-400 shrink-0';
  let ariaLabel = 'Workspace is in local-only mode. Open Account and Sync settings.';

  if (authStatus === 'initializing') {
    label = 'Checking Auth';
    ariaLabel = 'Checking authentication state.';
  } else if (!user || syncState.status === 'local_only') {
    label = 'Local Only';
    Icon = HardDrive;
    iconClass = 'w-3.5 h-3.5 text-zinc-400 shrink-0';
  } else if (syncState.status === 'auth_required') {
    label = 'Verify Sync';
    toneClasses =
      'text-amber-200 bg-amber-500/12 border-amber-500/30 hover:bg-amber-500/20';
    Icon = ShieldAlert;
    iconClass = 'w-3.5 h-3.5 text-amber-300 shrink-0';
    ariaLabel = 'Cloud sync paused awaiting local data ownership confirmation.';
  } else if (syncState.status === 'offline') {
    label = totalQueued > 0 ? `Offline (${totalQueued})` : 'Offline';
    toneClasses =
      'text-amber-200 bg-amber-500/12 border-amber-500/30 hover:bg-amber-500/20';
    Icon = CloudOff;
    iconClass = 'w-3.5 h-3.5 text-amber-300 shrink-0';
    ariaLabel = `Offline. ${totalQueued} change(s) queued locally for sync.`;
  } else if (syncState.status === 'conflict' || activeConflicts > 0) {
    label = `Conflict (${activeConflicts || 1})`;
    toneClasses =
      'text-amber-200 bg-amber-500/12 border-amber-500/30 hover:bg-amber-500/20';
    Icon = AlertTriangle;
    iconClass = 'w-3.5 h-3.5 text-amber-300 shrink-0';
    ariaLabel = `${activeConflicts || 1} sync conflict notice(s) preserved as conflict copies.`;
  } else if (syncState.status === 'failed') {
    label = syncState.failedCount > 0 ? `Sync Error (${syncState.failedCount})` : 'Sync Error';
    toneClasses =
      'text-rose-200 bg-rose-500/12 border-rose-500/30 hover:bg-rose-500/20';
    Icon = AlertTriangle;
    iconClass = 'w-3.5 h-3.5 text-rose-300 shrink-0';
    ariaLabel = syncState.lastError || 'Cloud sync encountered an error. Click to inspect.';
  } else if (syncState.status === 'syncing') {
    label = totalQueued > 0 ? `Syncing (${totalQueued})` : 'Syncing';
    toneClasses =
      'text-emerald-200 bg-emerald-500/12 border-emerald-500/30 hover:bg-emerald-500/20';
    Icon = RefreshCw;
    iconClass = 'w-3.5 h-3.5 text-emerald-300 animate-spin shrink-0';
    ariaLabel = `Syncing changes with Firestore. ${totalQueued} item(s) pending.`;
  } else if (syncState.status === 'synced') {
    label = 'Synced';
    toneClasses =
      'text-emerald-200 bg-emerald-500/10 border-emerald-500/25 hover:bg-emerald-500/18';
    Icon = CheckCircle2;
    iconClass = 'w-3.5 h-3.5 text-emerald-300 shrink-0';
    ariaLabel = `Cloud workspace synced for ${user.email || 'signed-in account'}.`;
  } else {
    label = 'Cloud';
    Icon = Cloud;
  }

  if (!onClick) {
    return (
      <span
        data-testid="sync-status-badge"
        data-sync-status={syncState.status}
        aria-label={ariaLabel}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${toneClasses}`}
      >
        <Icon className={iconClass} />
        <span className={compact ? 'hidden md:inline' : ''}>{label}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="sync-status-badge"
      data-sync-status={syncState.status}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${toneClasses}`}
    >
      <Icon className={iconClass} />
      <span className={compact ? 'hidden md:inline' : ''}>{label}</span>
    </button>
  );
}
