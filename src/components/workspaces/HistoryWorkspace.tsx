import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  MessageSquare,
  Mic,
  MoreVertical,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Square,
  Trash2,
} from 'lucide-react';
import { SAMPLE_CONVERSATIONS } from '../../data/mockWorkspaceData';
import { formatSessionDuration } from '../../state/voiceStateMachine';
import { sortAndFilterConversations } from '../../state/workspaceReducer';
import type { Conversation, HistoryFilter, WorkspaceStorageStats } from '../../types/workspace';

interface HistoryWorkspaceProps {
  conversations: Conversation[];
  deletedConversations: Conversation[];
  storageStats: WorkspaceStorageStats;
  activeConversationId: string | null;
  selectedConversationIds: string[];
  filter: HistoryFilter;
  searchQuery: string;
  onChangeFilter: (filter: HistoryFilter) => void;
  onChangeSearch: (query: string) => void;
  onOpenConversation: (conversationId: string) => void;
  onCreateConversation: () => void;
  onRenameConversation: (conversationId: string, title: string) => void;
  onTogglePinConversation: (conversationId: string) => void;
  onRequestDeleteConversation: (conversation: Conversation) => void;
  onToggleSelectConversation: (conversationId: string) => void;
  onSelectAllConversations: (conversationIds: string[]) => void;
  onClearSelection: () => void;
  onRequestBulkDelete: (count: number) => void;
  onRestoreDeleted: (conversationId: string) => void;
  onRequestPermanentDelete: (conversation: Conversation) => void;
  onCloneSampleConversation: (sampleId: string) => void;
}

const FILTER_TABS: { id: HistoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'chat', label: 'Text' },
  { id: 'voice', label: 'Voice' },
  { id: 'pinned', label: 'Pinned' },
];

export function HistoryWorkspace({
  conversations,
  deletedConversations,
  storageStats,
  activeConversationId,
  selectedConversationIds,
  filter,
  searchQuery,
  onChangeFilter,
  onChangeSearch,
  onOpenConversation,
  onCreateConversation,
  onRenameConversation,
  onTogglePinConversation,
  onRequestDeleteConversation,
  onToggleSelectConversation,
  onSelectAllConversations,
  onClearSelection,
  onRequestBulkDelete,
  onRestoreDeleted,
  onRequestPermanentDelete,
  onCloneSampleConversation,
}: HistoryWorkspaceProps) {
  const [bulkMode, setBulkMode] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [showTrash, setShowTrash] = useState(false);
  const [showSamples, setShowSamples] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(event.target as Node)
      ) {
        setOpenMenuId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuId(null);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuId]);

  const filtered = sortAndFilterConversations(conversations, filter, searchQuery);
  const selectedSet = new Set(selectedConversationIds);

  const handleToggleBulkMode = () => {
    if (bulkMode) {
      onClearSelection();
      setBulkMode(false);
    } else {
      setBulkMode(true);
      setOpenMenuId(null);
    }
  };

  const handleRenameSubmit = (e: React.FormEvent, id: string) => {
    e.preventDefault();
    if (renameDraft.trim()) {
      onRenameConversation(id, renameDraft.trim());
    }
    setRenamingId(null);
    setRenameDraft('');
  };

  return (
    <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-5 space-y-6">
      {/* Header using shared DB-backed storageStats */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">History</h1>
          <p className="text-xs text-zinc-300 mt-0.5 tabular-nums">
            {storageStats.conversationCount} saved · {storageStats.deletedCount} recently deleted
          </p>
        </div>

        <div className="flex items-center gap-2">
          {conversations.length > 0 && (
            <button
              type="button"
              onClick={handleToggleBulkMode}
              className={`min-h-[40px] px-3 rounded-xl border text-xs font-medium transition-colors ${
                bulkMode
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                  : 'border-white/[0.12] text-zinc-200 hover:bg-white/[0.06]'
              }`}
            >
              {bulkMode ? 'Done' : 'Select'}
            </button>
          )}

          <button
            type="button"
            onClick={onCreateConversation}
            className="min-h-[40px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#052317] text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>
      </div>

      {/* Filter & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filter conversations"
          className="inline-flex items-center p-1 rounded-xl bg-[#10141A] border border-white/[0.08] self-start"
        >
          {FILTER_TABS.map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeFilter(tab.id)}
                aria-pressed={active}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'text-zinc-300 hover:text-zinc-100'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <label className="relative flex-1 sm:max-w-xs">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onChangeSearch(e.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-[#10141A] border border-white/[0.1] text-xs text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500"
          />
        </label>
      </div>

      {/* Bulk Action Bar */}
      {bulkMode && (
        <div className="rounded-xl border border-white/[0.12] bg-[#10141A] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-zinc-100 font-medium font-mono tabular-nums">
              {selectedConversationIds.length} selected
            </span>
            <button
              type="button"
              onClick={() =>
                selectedConversationIds.length === filtered.length
                  ? onClearSelection()
                  : onSelectAllConversations(filtered.map((c) => c.id))
              }
              className="text-emerald-300 hover:underline font-medium"
            >
              {selectedConversationIds.length === filtered.length ? 'Clear All' : 'Select All'}
            </button>
          </div>

          <button
            type="button"
            disabled={selectedConversationIds.length === 0}
            onClick={() => onRequestBulkDelete(selectedConversationIds.length)}
            className="min-h-[36px] px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-40 text-rose-200 font-semibold inline-flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Selected
          </button>
        </div>
      )}

      {/* Your Saved Conversations */}
      <section aria-label="Your saved conversations">
        {filtered.length === 0 ? (
          <div className="py-10 px-4 border-y border-white/[0.08] text-center space-y-2">
            <p className="text-sm font-medium text-zinc-100">
              {conversations.length === 0
                ? 'No saved conversations yet'
                : 'No conversations match your filter'}
            </p>
            <p className="text-xs text-zinc-400">
              {conversations.length === 0
                ? 'Start a new chat above or expand Sample Transcripts below to explore a reference example.'
                : 'Try clearing your search query or switching filter tabs.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
            {filtered.map((conv) => {
              const isCurrent = conv.id === activeConversationId;
              const isSelected = selectedSet.has(conv.id);
              const isMenuOpen = openMenuId === conv.id;
              const isRenaming = renamingId === conv.id;

              return (
                <article
                  key={conv.id}
                  className={`relative py-4 flex items-start justify-between gap-3 ${
                    isCurrent ? 'bg-emerald-500/[0.04]' : ''
                  }`}
                >
                  {bulkMode && (
                    <button
                      type="button"
                      onClick={() => onToggleSelectConversation(conv.id)}
                      aria-label={`Select ${conv.title}`}
                      aria-pressed={isSelected}
                      className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-zinc-300 hover:bg-white/[0.06] shrink-0"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Square className="w-4 h-4 text-zinc-400" />
                      )}
                    </button>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300 mb-1">
                      <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                        {conv.kind === 'voice' ? (
                          <Mic className="w-3.5 h-3.5" />
                        ) : (
                          <MessageSquare className="w-3.5 h-3.5" />
                        )}
                        {conv.kind === 'voice' ? 'Voice' : 'Text'}
                      </span>
                      {conv.isPinned && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-zinc-200">
                            <Pin className="w-3 h-3 text-emerald-400" />
                            Pinned
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-zinc-400">
                        {conv.messages.length} turns
                      </span>
                      {typeof conv.durationSeconds === 'number' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums text-zinc-400">
                            {formatSessionDuration(conv.durationSeconds)}
                          </span>
                        </>
                      )}
                    </div>

                    {isRenaming ? (
                      <form
                        onSubmit={(e) => handleRenameSubmit(e, conv.id)}
                        className="flex items-center gap-2 my-1"
                      >
                        <input
                          type="text"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          aria-label={`Rename ${conv.title}`}
                          className="flex-1 min-w-0 h-9 px-2.5 rounded-lg bg-[#090B0E] border border-emerald-500/60 text-sm text-zinc-100 focus:outline-none"
                          autoFocus
                        />
                        <button
                          type="submit"
                          className="h-9 px-3 rounded-lg bg-emerald-500 text-[#052317] text-xs font-semibold"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          className="h-9 px-2.5 rounded-lg bg-white/[0.06] text-xs text-zinc-200"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenConversation(conv.id)}
                        className="text-left group block w-full"
                      >
                        <h2 className="text-sm sm:text-base font-semibold text-zinc-100 group-hover:text-emerald-300 transition-colors truncate">
                          {conv.title}
                        </h2>
                        {conv.summary && (
                          <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                            {conv.summary}
                          </p>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Three-dot action menu */}
                  {!bulkMode && (
                    <div
                      ref={isMenuOpen ? menuContainerRef : undefined}
                      className="relative flex items-center gap-1 shrink-0"
                    >
                      <button
                        type="button"
                        onClick={() => onOpenConversation(conv.id)}
                        aria-label={`Open ${conv.title}`}
                        className="hidden sm:inline-flex min-h-[38px] px-3 rounded-lg bg-white/[0.05] hover:bg-emerald-500 hover:text-[#052317] text-xs font-medium text-zinc-200 items-center gap-1 transition-colors"
                      >
                        <span>Open</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setOpenMenuId(isMenuOpen ? null : conv.id)}
                        aria-label={`More actions for ${conv.title}`}
                        aria-expanded={isMenuOpen}
                        className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-zinc-300 hover:text-zinc-100 hover:bg-white/[0.06]"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {isMenuOpen && (
                        <div
                          role="menu"
                          aria-label={`Actions for ${conv.title}`}
                          className="absolute right-0 top-11 z-20 w-44 rounded-xl border border-white/[0.12] bg-[#131820] py-1 shadow-2xl"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuId(null);
                              setRenamingId(conv.id);
                              setRenameDraft(conv.title);
                            }}
                            className="w-full min-h-[40px] px-3 text-left text-xs text-zinc-200 hover:bg-white/[0.06] flex items-center gap-2.5"
                          >
                            <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                            Rename
                          </button>

                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuId(null);
                              onTogglePinConversation(conv.id);
                            }}
                            className="w-full min-h-[40px] px-3 text-left text-xs text-zinc-200 hover:bg-white/[0.06] flex items-center gap-2.5"
                          >
                            <Pin className="w-3.5 h-3.5 text-emerald-400" />
                            {conv.isPinned ? 'Unpin' : 'Pin'}
                          </button>

                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuId(null);
                              onRequestDeleteConversation(conv);
                            }}
                            className="w-full min-h-[40px] px-3 text-left text-xs text-rose-300 hover:bg-rose-500/10 flex items-center gap-2.5"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Recently Deleted Recovery Section */}
      {deletedConversations.length > 0 && (
        <section className="pt-2">
          <button
            type="button"
            onClick={() => setShowTrash((prev) => !prev)}
            aria-expanded={showTrash}
            className="w-full min-h-[40px] flex items-center justify-between text-xs font-semibold text-zinc-300 hover:text-zinc-100"
          >
            <span className="inline-flex items-center gap-1.5">
              {showTrash ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Recently Deleted ({storageStats.deletedCount})
            </span>
            <span className="font-normal text-zinc-400">Recoverable locally</span>
          </button>

          {showTrash && (
            <div className="mt-2 divide-y divide-white/[0.06] border-y border-white/[0.06]">
              {deletedConversations.map((deleted) => (
                <div
                  key={deleted.id}
                  className="py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-zinc-200 truncate">{deleted.title}</div>
                    <div className="text-xs text-zinc-400">
                      {deleted.messages.length} messages · Deleted
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onRestoreDeleted(deleted.id)}
                      className="min-h-[36px] px-3 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 font-medium inline-flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestPermanentDelete(deleted)}
                      className="min-h-[36px] px-3 rounded-lg text-rose-300 hover:bg-rose-500/10"
                    >
                      Delete Forever
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Clearly Separated Sample Transcripts (Demo Reference) */}
      <section className="pt-2">
        <button
          type="button"
          onClick={() => setShowSamples((prev) => !prev)}
          aria-expanded={showSamples}
          className="w-full min-h-[40px] flex items-center justify-between text-xs font-semibold text-zinc-300 hover:text-zinc-100"
        >
          <span className="inline-flex items-center gap-1.5">
            {showSamples ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            Sample Transcripts (Demo Reference · {SAMPLE_CONVERSATIONS.length})
          </span>
          <span className="font-normal text-zinc-400">Separated from your history</span>
        </button>

        {showSamples && (
          <div className="mt-2 divide-y divide-white/[0.06] border-y border-white/[0.06]">
            {SAMPLE_CONVERSATIONS.map((sample) => (
              <div
                key={sample.id}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-200">{sample.title}</div>
                  <p className="text-xs text-zinc-400 mt-0.5">{sample.summary}</p>
                </div>

                <button
                  type="button"
                  onClick={() => onCloneSampleConversation(sample.id)}
                  className="min-h-[38px] px-3 rounded-lg border border-white/[0.12] hover:bg-white/[0.06] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5 shrink-0"
                >
                  <Copy className="w-3.5 h-3.5 text-emerald-400" />
                  Copy to My History
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
