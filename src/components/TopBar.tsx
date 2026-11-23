import {
  FolderKanban,
  History,
  MessageSquare,
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
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'history', label: 'History', icon: History },
];

export function TopBar({
  activeWorkspace,
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
    <header className="sticky top-0 z-30 shrink-0 border-b border-border bg-surface backdrop-blur-md pt-[env(safe-area-inset-top)]">
      <div className="h-[52px] px-3 lg:px-5 flex items-center justify-between gap-2 sm:gap-3">
      {/* Zone 1: Drawer toggle + clean single-line brand wordmark */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onToggleLeftDrawer}
          aria-label="Toggle conversations and project files drawer"
          className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/60"
        >
          <PanelLeft className="w-[18px] h-[18px]" />
        </button>

        <span className="text-[15px] font-semibold tracking-tight text-ink whitespace-nowrap truncate">
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
              className={`px-3.5 py-2 text-[13px] font-medium rounded-lg inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/60 ${
                active
                  ? 'text-signal bg-signal/10'
                  : 'text-muted hover:text-ink hover:bg-raised'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Sync status + Account + PWA install + Settings + New Chat */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">

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
          className={`min-h-[38px] min-w-[38px] px-2 lg:px-2.5 rounded-lg inline-flex items-center justify-center gap-1.5 text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/60 ${
            authUser
              ? 'text-signal border border-border bg-signal/10 hover:bg-signal/15'
              : 'text-muted hover:text-ink hover:bg-raised border border-border'
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
          className={`min-h-[40px] min-w-[40px] px-2.5 lg:px-3 rounded-lg inline-flex items-center justify-center gap-2 text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/60 ${
            rightDrawerOpen
              ? 'bg-signal/10 text-signal border border-border'
              : 'text-muted hover:text-ink hover:bg-raised border border-border'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">Settings</span>
        </button>

        <button
          type="button"
          onClick={onNewChat}
          aria-label="New Chat"
          className="min-h-[40px] min-w-[40px] px-2.5 sm:px-3.5 rounded-lg bg-signal hover:bg-signal/90 text-on-signal text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Chat</span>
        </button>
      </div>
      </div>
    </header>
  );
}
