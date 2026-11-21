import {
  FolderKanban,
  History,
  MessageSquare,
  Mic,
  PanelLeft,
  Plus,
  SlidersHorizontal,
  UserCircle2,
} from 'lucide-react';
import type {
  AuthStatus,
  AuthUserProfile,
  SyncEngineState,
  WorkspaceId,
} from '../types/workspace';
import { PWAInstallButton } from './PWAInstallButton';
import { SyncStatusBadge } from './sync/SyncStatusBadge';

interface TopBarProps {
  activeWorkspace: WorkspaceId;
  micActive: boolean;
  rightDrawerOpen: boolean;
  authStatus: AuthStatus;
  authUser: AuthUserProfile | null;
  syncState: SyncEngineState;
  onSelectWorkspace: (workspace: WorkspaceId) => void;
  onToggleLeftDrawer: () => void;
  onToggleRightDrawer: () => void;
  onSyncBadgeClick: () => void;
  onAccountClick: () => void;
  onNewChat: () => void;
}

const WORKSPACE_TABS: { id: WorkspaceId; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'history', label: 'History', icon: History },
];

export function TopBar({
  activeWorkspace,
  micActive,
  rightDrawerOpen,
  authStatus,
  authUser,
  syncState,
  onSelectWorkspace,
  onToggleLeftDrawer,
  onToggleRightDrawer,
  onSyncBadgeClick,
  onAccountClick,
  onNewChat,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-white/[0.07] bg-[#090B0E]/92 backdrop-blur-md pt-[env(safe-area-inset-top)]">
      <div className="h-[52px] px-3 lg:px-5 flex items-center justify-between gap-2 sm:gap-3">
      {/* Zone 1: Drawer toggle + clean single-line brand wordmark */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onToggleLeftDrawer}
          aria-label="Toggle conversations and project files drawer"
          className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-zinc-300 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          <PanelLeft className="w-[18px] h-[18px]" />
        </button>

        <span className="text-[15px] font-semibold tracking-tight text-zinc-100 whitespace-nowrap truncate">
          Personal AI Studio
        </span>
      </div>

      {/* Zone 2: Clean 4-destination desktop nav */}
      <nav aria-label="Primary workspaces" className="hidden lg:flex items-center gap-1">
        {WORKSPACE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeWorkspace === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectWorkspace(tab.id)}
              aria-current={active ? 'page' : undefined}
              className={`px-3.5 py-2 text-[13px] font-medium rounded-lg inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                active
                  ? 'text-emerald-300 bg-emerald-500/10'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Live mic + Sync status + Account + PWA install + Settings + New Chat */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {micActive && (
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 whitespace-nowrap"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Mic Live
          </span>
        )}

        <SyncStatusBadge
          compact
          authStatus={authStatus}
          user={authUser}
          syncState={syncState}
          onClick={onSyncBadgeClick}
        />

        <button
          type="button"
          onClick={onAccountClick}
          data-testid="topbar-account-button"
          aria-label={
            authUser
              ? `Account settings for ${authUser.email || authUser.displayName || 'signed-in user'}`
              : 'Sign in for cloud sync'
          }
          className={`min-h-[38px] min-w-[38px] px-2 lg:px-2.5 rounded-lg inline-flex items-center justify-center gap-1.5 text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
            authUser
              ? 'text-emerald-200 border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/18'
              : 'text-zinc-300 hover:text-white hover:bg-white/[0.06] border border-white/[0.08]'
          }`}
        >
          <UserCircle2 className="w-4 h-4 shrink-0" />
          <span className="hidden xl:inline max-w-[110px] truncate">
            {authUser ? authUser.displayName || authUser.email?.split('@')[0] || 'Account' : 'Sign In'}
          </span>
        </button>

        <div className="hidden sm:block">
          <PWAInstallButton variant="compact" />
        </div>

        <button
          type="button"
          onClick={onToggleRightDrawer}
          aria-expanded={rightDrawerOpen}
          aria-label="Open settings drawer"
          className={`min-h-[40px] min-w-[40px] px-2.5 lg:px-3 rounded-lg inline-flex items-center justify-center gap-2 text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
            rightDrawerOpen
              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
              : 'text-zinc-300 hover:text-white hover:bg-white/[0.06] border border-white/[0.08]'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">Settings</span>
        </button>

        <button
          type="button"
          onClick={onNewChat}
          aria-label="New Chat"
          className="min-h-[40px] min-w-[40px] px-2.5 sm:px-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#052317] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Chat</span>
        </button>
      </div>
      </div>
    </header>
  );
}
