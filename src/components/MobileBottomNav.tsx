import { FolderKanban, History, MessageSquare, Mic } from 'lucide-react';
import type { WorkspaceId } from '../types/workspace';

interface MobileBottomNavProps {
  activeWorkspace: WorkspaceId;
  micActive: boolean;
  hidden?: boolean;
  onSelectWorkspace: (workspace: WorkspaceId) => void;
}

const MOBILE_TABS: { id: WorkspaceId; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'history', label: 'History', icon: History },
];

export function MobileBottomNav({
  activeWorkspace,
  micActive,
  hidden = false,
  onSelectWorkspace,
}: MobileBottomNavProps) {
  if (hidden) return null;

  return (
    <nav
      aria-label="Mobile navigation"
      className="lg:hidden shrink-0 border-t border-white/[0.08] bg-[#090B0E]/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-4 h-[60px] items-center">
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeWorkspace === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectWorkspace(tab.id)}
              aria-current={active ? 'page' : undefined}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/60 ${
                active ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="relative">
                <Icon className="w-[20px] h-[20px]" />
                {tab.id === 'voice' && micActive && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-emerald-400"
                  />
                )}
              </div>
              <span className="text-[11px] font-medium tracking-tight leading-none whitespace-nowrap">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
