import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bug,
  Check,
  Copy,
  Eraser,
  Loader2,
  LogIn,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  WifiOff,
} from 'lucide-react';
import { getChatModelDefinition, LEGACY_MODEL_ALIASES } from '../../shared/modelRegistry';
import { sortAndFilterConversations } from '../../state/workspaceReducer';
import type {
  AuthStatus,
  AuthUserProfile,
  ChatNoticeState,
  ChatStreamingState,
  Conversation,
  ModelSettings,
} from '../../types/workspace';
import {
  classifyMobileInputDiagnosis,
  describeElement,
  type DiagnosticEnvironment,
  type InputDiagnosticEvent,
} from '../../utils/inputDiagnostics';
import { InputDiagnosticsPanel } from '../InputDiagnosticsPanel';
import { MarkdownMessage } from '../MarkdownMessage';
import { shouldSubmitComposerKey } from './chatComposerUtils';

const INPUT_DEBUG_STORAGE_KEY = 'personal-ai-studio:input-debug';
let persistedDiagEvents: InputDiagnosticEvent[] = [];
let persistedDiagSeq = 0;

function getInitialInputDebugState(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const param = params.get('inputDebug');
    if (param === '1') {
      window.localStorage.setItem(INPUT_DEBUG_STORAGE_KEY, '1');
      return true;
    }
    if (param === '0') {
      window.localStorage.setItem(INPUT_DEBUG_STORAGE_KEY, '0');
      return false;
    }
    return window.localStorage.getItem(INPUT_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

interface ChatStudioProps {
  hydrated: boolean;
  conversations: Conversation[];
  activeConversation: Conversation | undefined;
  modelSettings: ModelSettings;
  storageError: string | null;
  authStatus: AuthStatus;
  authUser: AuthUserProfile | null;
  chatSending: boolean;
  chatStreaming: ChatStreamingState | null;
  chatNotice: ChatNoticeState | null;
  keyboardOpen?: boolean;
  viewportHeight?: number | null;
  onSelectConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  onRenameConversation: (conversationId: string, title: string) => void;
  onTogglePinConversation: (conversationId: string) => void;
  onRequestClearActiveConversation: () => void;
  onSendMessage: (text: string) => void;
  onStopGenerating: () => void;
  onRetryLastMessage: () => void;
  onRegenerateLastResponse: () => void;
  onDismissNotice: () => void;
  onOpenSignIn: () => void;
}

const STARTER_PROMPTS = [
  'Summarize my architecture plan for Android PWA + Kotlin Compose.',
  'বাংলা এবং ইংরেজিতে আজকের কাজের একটি সংক্ষিপ্ত চেকলিস্ট তৈরি করো।',
  'Help me draft a clean TypeScript service module.',
];

export function ChatStudio({
  hydrated,
  conversations,
  activeConversation,
  modelSettings,
  storageError,
  authStatus,
  authUser,
  chatSending,
  chatStreaming,
  chatNotice,
  keyboardOpen = false,
  viewportHeight = null,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onTogglePinConversation,
  onRequestClearActiveConversation,
  onSendMessage,
  onStopGenerating,
  onRetryLastMessage,
  onRegenerateLastResponse,
  onDismissNotice,
  onOpenSignIn,
}: ChatStudioProps) {
  const [draft, setDraft] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [inputDebugEnabled, setInputDebugEnabled] = useState<boolean>(getInitialInputDebugState);
  const [diagEvents, setDiagEvents] = useState<InputDiagnosticEvent[]>(() => persistedDiagEvents);
  const [diagHitTest, setDiagHitTest] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const diagPanelWrapperRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const mountedRef = useRef(true);
  const inputDebugRef = useRef(inputDebugEnabled);
  inputDebugRef.current = inputDebugEnabled;
  const diagBaselineHeightRef = useRef<number>(
    typeof window !== 'undefined'
      ? Math.max(window.innerHeight || 0, window.visualViewport?.height ?? 0)
      : 0,
  );
  const liveKeyboardRef = useRef({ keyboardOpen, viewportHeight, chatSending, draftLength: 0 });
  liveKeyboardRef.current = {
    keyboardOpen,
    viewportHeight,
    chatSending,
    draftLength: draft.length,
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const recentThreads = sortAndFilterConversations(conversations, 'all', '').slice(0, 5);

  const captureDiagnosticEvent = useCallback(
    (
      type: string,
      isTrusted: boolean | null,
      targetEl: Element | null,
      note?: string,
      syncState = true,
    ) => {
      if (typeof window === 'undefined') return;
      const ta = textareaRef.current;
      const rect = ta ? ta.getBoundingClientRect() : null;
      const style = ta ? window.getComputedStyle(ta) : null;
      const visible = Boolean(
        ta &&
          rect &&
          rect.width > 0 &&
          rect.height > 0 &&
          style &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0',
      );
      const vv = window.visualViewport;
      const now = new Date();
      const time =
        now.toTimeString().slice(0, 8) + '.' + String(now.getMilliseconds()).padStart(3, '0');
      diagBaselineHeightRef.current = Math.max(
        diagBaselineHeightRef.current,
        window.innerHeight || 0,
        vv?.height ?? 0,
      );

      if (syncState && mountedRef.current && ta && rect && rect.width > 0 && rect.height > 0) {
        const centerEl = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        setDiagHitTest(describeElement(centerEl));
      }

      const nextSeq = ++persistedDiagSeq;
      const entry: InputDiagnosticEvent = {
        seq: nextSeq,
        time,
        timestampMs: Date.now(),
        type,
        isTrusted,
        target: describeElement(targetEl),
        activeElement: describeElement(document.activeElement),
        textareaDisabled: ta ? ta.disabled : null,
        textareaReadOnly: ta ? ta.readOnly : null,
        textareaRect: rect
          ? {
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              bottom: rect.bottom,
            }
          : null,
        textareaVisible: ta ? visible : null,
        textareaConnected: ta ? ta.isConnected : null,
        windowInnerWidth: window.innerWidth,
        windowInnerHeight: window.innerHeight,
        visualViewportWidth: vv ? Math.round(vv.width) : null,
        visualViewportHeight: vv ? Math.round(vv.height) : null,
        appKeyboardOpen: liveKeyboardRef.current.keyboardOpen,
        note,
      };
      persistedDiagEvents = [...persistedDiagEvents.slice(-59), entry];
      if (syncState && mountedRef.current) {
        setDiagEvents(persistedDiagEvents);
      }
    },
    [],
  );

  // Passive diagnostic listeners — active ONLY when inputDebugEnabled is true
  useEffect(() => {
    if (!inputDebugEnabled || typeof window === 'undefined') return undefined;

    const ta = textareaRef.current;
    captureDiagnosticEvent('textarea.mount', null, ta);

    const handleDocEvent = (event: Event) => {
      const targetNode = event.target as Node | null;
      if (targetNode && diagPanelWrapperRef.current?.contains(targetNode)) {
        return;
      }
      captureDiagnosticEvent(
        event.type,
        typeof event.isTrusted === 'boolean' ? event.isTrusted : null,
        event.target instanceof Element ? event.target : null,
      );
    };

    const handleTextareaBlur = (event: FocusEvent) => {
      captureDiagnosticEvent(
        'blur',
        event.isTrusted,
        event.target instanceof Element ? event.target : null,
      );
    };

    const handleWindowResize = (event: Event) => {
      captureDiagnosticEvent('window.resize', event.isTrusted, document.activeElement);
    };

    const handleVvResize = (event: Event) => {
      captureDiagnosticEvent('visualViewport.resize', event.isTrusted, document.activeElement);
    };

    const docEvents = [
      'pointerdown',
      'pointerup',
      'touchstart',
      'touchend',
      'click',
      'focusin',
      'focusout',
    ] as const;

    for (const type of docEvents) {
      document.addEventListener(type, handleDocEvent, { capture: true, passive: true });
    }
    ta?.addEventListener('blur', handleTextareaBlur, { passive: true });
    window.addEventListener('resize', handleWindowResize, { passive: true });
    const vv = window.visualViewport;
    vv?.addEventListener('resize', handleVvResize, { passive: true });

    return () => {
      for (const type of docEvents) {
        document.removeEventListener(type, handleDocEvent, { capture: true });
      }
      ta?.removeEventListener('blur', handleTextareaBlur);
      window.removeEventListener('resize', handleWindowResize);
      vv?.removeEventListener('resize', handleVvResize);
      if (inputDebugRef.current) {
        captureDiagnosticEvent('textarea.unmount', null, ta, undefined, false);
      }
    };
  }, [inputDebugEnabled, captureDiagnosticEvent]);

  // Log relevant React state transitions when diagnostic mode is active
  const prevStateSnapRef = useRef({ keyboardOpen, viewportHeight, chatSending });
  useEffect(() => {
    if (!inputDebugEnabled) {
      prevStateSnapRef.current = { keyboardOpen, viewportHeight, chatSending };
      return;
    }
    const prev = prevStateSnapRef.current;
    if (
      prev.keyboardOpen !== keyboardOpen ||
      prev.viewportHeight !== viewportHeight ||
      prev.chatSending !== chatSending
    ) {
      prevStateSnapRef.current = { keyboardOpen, viewportHeight, chatSending };
      captureDiagnosticEvent(
        'state.change',
        null,
        textareaRef.current,
        `kbOpen=${String(keyboardOpen)} vvH=${String(viewportHeight)} sending=${String(chatSending)}`,
      );
    }
  }, [inputDebugEnabled, keyboardOpen, viewportHeight, chatSending, captureDiagnosticEvent]);

  const diagEnv: DiagnosticEnvironment = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        inIframe: false,
        isStandalonePwa: false,
        isTouchDevice: false,
        isAndroidUserAgent: false,
        viewportMetaContent: '',
        serviceWorkerControlled: false,
        serviceWorkerScriptUrl: null,
        baselineHeight: 0,
        hitTestAtTextareaCenter: null,
      };
    }
    const meta = document.querySelector('meta[name="viewport"]');
    const nav = window.navigator as Navigator & { standalone?: boolean };
    return {
      inIframe: window.self !== window.top,
      isStandalonePwa:
        window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true,
      isTouchDevice: 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0,
      isAndroidUserAgent: /android/i.test(navigator.userAgent || ''),
      viewportMetaContent: meta?.getAttribute('content') || '',
      serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
      serviceWorkerScriptUrl: navigator.serviceWorker?.controller?.scriptURL ?? null,
      baselineHeight: diagBaselineHeightRef.current,
      hitTestAtTextareaCenter: diagHitTest,
    };
  }, [diagHitTest, diagEvents.length, inputDebugEnabled]);

  const diagSummary = useMemo(
    () => classifyMobileInputDiagnosis(diagEvents, diagEnv),
    [diagEvents, diagEnv],
  );

  const toggleInputDebug = (next?: boolean) => {
    setInputDebugEnabled((prev) => {
      const target = typeof next === 'boolean' ? next : !prev;
      try {
        window.localStorage.setItem(INPUT_DEBUG_STORAGE_KEY, target ? '1' : '0');
      } catch {
        // Ignore storage restrictions
      }
      if (!target) {
        persistedDiagEvents = [];
        setDiagEvents([]);
      }
      return target;
    });
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(44, Math.min(el.scrollHeight, 128))}px`;
  }, [draft]);

  const activeStreaming =
    chatStreaming && activeConversation && chatStreaming.conversationId === activeConversation.id
      ? chatStreaming
      : null;

  useEffect(() => {
    const scroller = messageListRef.current;
    if (!scroller) return;
    isNearBottomRef.current = true;
    scroller.scrollTop = scroller.scrollHeight;
  }, [
    activeConversation?.id,
    activeConversation?.messages.length,
    chatSending,
    activeStreaming?.text,
    chatNotice?.message,
  ]);

  useEffect(() => {
    const scroller = messageListRef.current;
    if (!scroller || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const handleMessageScroll = () => {
    const scroller = messageListRef.current;
    if (!scroller) return;
    isNearBottomRef.current =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
  };

  const submitDraft = () => {
    if (!draft.trim() || chatSending) return;
    onSendMessage(draft);
    setDraft('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitDraft();
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const nativeComposing = (e.nativeEvent as KeyboardEvent).isComposing;
    if (shouldSubmitComposerKey(e.key, e.shiftKey, nativeComposing)) {
      e.preventDefault();
      submitDraft();
    }
  };

  const handleStartRename = () => {
    if (!activeConversation) return;
    setTitleDraft(activeConversation.title);
    setEditingTitle(true);
  };

  const handleSaveRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeConversation && titleDraft.trim()) {
      onRenameConversation(activeConversation.id, titleDraft.trim());
    }
    setEditingTitle(false);
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1800);
    } catch {
      // Clipboard unavailable in restricted context
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col max-w-3xl mx-auto w-full px-3 sm:px-6 pt-3 pb-2 sm:py-4 gap-2.5">
      {/* Compact Conversation Header */}
      <div className="shrink-0 flex items-center justify-between gap-2 pb-3 border-b border-white/[0.08]">
        <div className="min-w-0 flex-1">
          {activeConversation && editingTitle ? (
            <form onSubmit={handleSaveRename} className="flex items-center gap-2">
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                aria-label="Rename current conversation"
                className="flex-1 min-w-0 h-9 px-2.5 rounded-lg bg-[#10141A] border border-emerald-500/60 text-sm text-zinc-100 focus:outline-none"
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
                onClick={() => setEditingTitle(false)}
                className="h-9 px-2.5 rounded-lg bg-white/[0.06] text-xs text-zinc-200"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-base sm:text-lg font-semibold text-zinc-100 truncate">
                {activeConversation ? activeConversation.title : 'New Conversation'}
              </h1>
              {activeConversation && (
                <button
                  type="button"
                  onClick={handleStartRename}
                  aria-label="Rename conversation"
                  className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] shrink-0"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <div className="text-xs text-zinc-400 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="whitespace-nowrap">
              {(() => {
                const effectiveId =
                  LEGACY_MODEL_ALIASES[modelSettings.chatModel] ?? modelSettings.chatModel;
                const cap = getChatModelDefinition(effectiveId);
                return cap ? cap.shortLabel : modelSettings.chatModel;
              })()}
            </span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">
              {activeConversation
                ? `${activeConversation.messages.length} message${
                    activeConversation.messages.length === 1 ? '' : 's'
                  }`
                : 'Local-first IndexedDB thread'}
            </span>
            {authStatus !== 'initializing' && !authUser && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={onOpenSignIn}
                  className="text-emerald-300 hover:text-emerald-200 underline decoration-emerald-400/40 whitespace-nowrap"
                >
                  Sign in for AI
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {activeConversation && (
            <>
              <button
                type="button"
                onClick={() => onTogglePinConversation(activeConversation.id)}
                aria-label={
                  activeConversation.isPinned ? 'Unpin conversation' : 'Pin conversation'
                }
                aria-pressed={activeConversation.isPinned}
                className={`min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg transition-colors ${
                  activeConversation.isPinned
                    ? 'text-emerald-400 bg-emerald-500/10'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]'
                }`}
              >
                <Pin className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onRequestClearActiveConversation}
                disabled={activeConversation.messages.length === 0}
                aria-label="Clear current conversation messages"
                title="Clear messages in this conversation only"
                className="min-h-[40px] px-2.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-zinc-100 hover:bg-white/[0.06] disabled:opacity-35 disabled:pointer-events-none inline-flex items-center gap-1.5 transition-colors"
              >
                <Eraser className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Clear Chat</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => toggleInputDebug()}
            aria-label="Toggle input diagnostics"
            aria-pressed={inputDebugEnabled}
            title="Toggle mobile input diagnostics"
            className={`min-h-[40px] min-w-[40px] px-2 inline-flex items-center justify-center gap-1 rounded-lg text-xs font-medium transition-colors ${
              inputDebugEnabled
                ? 'text-emerald-300 bg-emerald-500/15'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]'
            }`}
          >
            <Bug className="w-4 h-4" />
            <span className="hidden md:inline">Diag</span>
          </button>

          <button
            type="button"
            onClick={onNewConversation}
            aria-label="Start new conversation"
            className="hidden sm:inline-flex min-h-[40px] px-2.5 rounded-lg text-xs font-medium text-emerald-300 hover:bg-emerald-500/10 items-center gap-1 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>New</span>
          </button>
        </div>
      </div>

      {/* Compact Recent Conversations Switcher */}
      {recentThreads.length > 1 && (
        <div
          aria-label="Recent conversations"
          className="shrink-0 flex items-center gap-1.5 overflow-x-auto pb-1"
        >
          {recentThreads.map((conv) => {
            const isCurrent = conv.id === activeConversation?.id;
            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => onSelectConversation(conv.id)}
                className={`min-h-[36px] max-w-[200px] px-3 rounded-lg text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                  isCurrent
                    ? 'bg-emerald-500/15 text-emerald-300 font-medium'
                    : 'bg-[#10141A] text-zinc-300 hover:text-zinc-100 hover:bg-white/[0.06]'
                }`}
              >
                {conv.isPinned && <Pin className="w-3 h-3 shrink-0" />}
                <span className="truncate">{conv.title}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Storage error state */}
      {storageError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-950/25 px-3.5 py-2.5 text-xs text-rose-200"
        >
          {storageError}
        </div>
      )}

      {/* Temporary non-blocking Mobile Input Diagnostic Panel */}
      {inputDebugEnabled && (
        <div ref={diagPanelWrapperRef} className="shrink-0">
          <InputDiagnosticsPanel
            summary={diagSummary}
            env={diagEnv}
            events={diagEvents}
            currentState={{
              activeWorkspace: 'chat',
              keyboardOpen,
              viewportHeight,
              chatSending,
              draftLength: draft.length,
            }}
            onClear={() => {
              persistedDiagEvents = [];
              setDiagEvents([]);
            }}
            onDisable={() => toggleInputDebug(false)}
          />
        </div>
      )}

      {/* Spacious Message Area */}
      <div
        ref={messageListRef}
        onScroll={handleMessageScroll}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-2 space-y-5"
      >
        {!hydrated ? (
          <div className="py-12 text-center text-xs text-zinc-400">
            Loading local conversations from IndexedDB…
          </div>
        ) : !activeConversation || activeConversation.messages.length === 0 ? (
          <div className="min-h-[260px] flex flex-col items-center justify-center text-center px-4 py-8">
            <h2 className="text-lg font-medium text-zinc-100">
              {activeConversation ? 'Ready when you are' : 'Personal AI Studio'}
            </h2>
            <p className="text-xs text-zinc-300 mt-1.5 max-w-md leading-relaxed">
              Messages save automatically in IndexedDB on this device. Type below to start a
              conversation.
            </p>

            <div className="mt-6 w-full max-w-md divide-y divide-white/[0.06] border-y border-white/[0.06] text-left">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onSendMessage(prompt)}
                  className="w-full py-3 px-2 text-xs text-zinc-200 hover:text-emerald-300 hover:bg-white/[0.03] transition-colors flex items-center justify-between gap-3"
                >
                  <span className="leading-relaxed">{prompt}</span>
                  <Send className="w-3.5 h-3.5 shrink-0 opacity-70" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {activeConversation.messages.map((msg, idx) => {
              const isUser = msg.role === 'user';
              const isSystem = msg.role === 'system';
              const senderLabel = isUser ? 'You' : isSystem ? 'System' : 'Gemini';
              const isLastAssistant =
                !isUser && !isSystem && idx === activeConversation.messages.length - 1;
              return (
                <article
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1 px-1 text-xs text-muted">
                    <span
                      className={
                        isUser
                          ? 'text-ink font-medium'
                          : isSystem
                            ? 'text-muted font-medium'
                            : 'text-signal font-medium'
                      }
                    >
                      {senderLabel}
                    </span>
                    {!isUser && msg.modelUsed && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-[11px] text-muted">
                          {msg.modelUsed}
                          {msg.fallbackUsed ? ' (fallback)' : ''}
                        </span>
                      </>
                    )}
                    {msg.source === 'voice' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Voice</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{msg.timestamp}</span>
                    {msg.stopped && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-muted">Stopped early</span>
                      </>
                    )}
                  </div>

                  <div
                    className={\`max-w-[92%] sm:max-w-[82%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed [&_.my-2\\.5]:!bg-sunken [&_.my-2\\.5>div]:!bg-raised [&_.my-2\\.5_pre]:!bg-sunken [&_.my-2\\.5_pre]:!font-mono \${
                      isUser
                        ? 'bg-raised text-ink border border-border'
                        : isSystem
                          ? 'bg-sunken text-muted border border-border italic'
                          : 'bg-surface text-ink border border-border'
                    }`}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    ) : (
                      <MarkdownMessage content={msg.content} />
                    )}

                    {!isUser && (
                      <div className="mt-2.5 pt-2 border-t border-border flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => handleCopy(msg.id, msg.content)}
                            className="min-h-[32px] inline-flex items-center gap-1.5 text-xs text-muted hover:text-signal transition-colors"
                          >
                            {copiedId === msg.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-signal" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>

                          {isLastAssistant && !chatSending && (
                            <button
                              type="button"
                              onClick={onRegenerateLastResponse}
                              aria-label="Regenerate response"
                              className="min-h-[32px] inline-flex items-center gap-1.5 text-xs text-muted hover:text-signal transition-colors"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Regenerate</span>
                            </button>
                          )}
                        </div>

                        {msg.usage &&
                          (typeof msg.usage.promptTokens === 'number' ||
                            typeof msg.usage.outputTokens === 'number') && (
                            <span className="text-[11px] font-mono tabular-nums text-muted">
                              {msg.usage.promptTokens ?? 0} in · {msg.usage.outputTokens ?? 0} out
                            </span>
                          )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}

            {chatSending && activeStreaming && (
              <article
                aria-live="polite"
                aria-label="Streaming Gemini response"
                className="flex flex-col items-start"
              >
                <div className="flex items-center gap-2 mb-1 px-1 text-xs text-muted">
                  <span className="text-signal font-medium">Gemini</span>
                  {activeStreaming.modelUsed && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-[11px]">
                        {activeStreaming.modelUsed}
                        {activeStreaming.fallbackUsed ? ' (fallback)' : ''}
                      </span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-signal">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>{activeStreaming.text ? 'Streaming…' : 'Thinking…'}</span>
                  </span>
                </div>

                <div className="max-w-[92%] sm:max-w-[82%] rounded-2xl px-4 py-3 border border-border bg-surface">
                  {activeStreaming.text ? (
                    <MarkdownMessage content={activeStreaming.text} streaming />
                  ) : (
                    <p className="text-xs text-muted">
                      Connecting to Gemini ({modelSettings.chatModel})…
                    </p>
                  )}
                </div>
              </article>
            )}
          </>
        )}

        {/* Honest backend / auth / offline notice — never fakes an AI reply */}
        {chatNotice && (
          <div
            role="status"
            aria-live="polite"
            className={`rounded-xl border px-3.5 py-3 text-xs leading-relaxed flex flex-wrap items-start justify-between gap-3 ${
              chatNotice.kind === 'offline' || chatNotice.kind === 'rate_limited'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                : 'border-white/[0.12] bg-[#11161D] text-zinc-200'
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              {chatNotice.kind === 'offline' ? (
                <WifiOff className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
              ) : chatNotice.kind === 'auth_required' ? (
                <LogIn className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1 min-w-0">
                <p className="font-medium text-zinc-100">
                  {chatNotice.kind === 'offline'
                    ? 'Offline — Saved Locally'
                    : chatNotice.kind === 'auth_required'
                      ? 'Sign In Required for Live Gemini Chat'
                      : chatNotice.kind === 'rate_limited'
                        ? 'Rate Limit Reached'
                        : chatNotice.kind === 'backend_unavailable'
                          ? 'AI Backend Configuration Needed'
                          : 'Chat Request Interrupted'}
                </p>
                <p className="text-zinc-300 break-words">{chatNotice.message}</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {chatNotice.kind === 'auth_required' ? (
                <button
                  type="button"
                  onClick={onOpenSignIn}
                  className="min-h-[40px] px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#052317] font-semibold inline-flex items-center gap-1.5"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Sign In</span>
                </button>
              ) : (
                chatNotice.retryable !== false && (
                  <button
                    type="button"
                    onClick={onRetryLastMessage}
                    disabled={chatSending}
                    aria-label="Retry chat request"
                    className="min-h-[40px] px-3 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] disabled:opacity-50 disabled:pointer-events-none text-zinc-100 inline-flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${chatSending ? 'animate-spin' : ''}`} />
                    <span>{chatSending ? 'Retrying…' : 'Retry'}</span>
                  </button>
                )
              )}
              <button
                type="button"
                onClick={onDismissNotice}
                aria-label="Dismiss notice"
                className="min-h-[40px] px-2.5 rounded-lg text-zinc-400 hover:text-zinc-100"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Compact Composer */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 flex items-end gap-2 rounded-2xl border border-white/[0.12] bg-[#0E1218] p-1.5"
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleComposerKeyDown}
          inputMode="text"
          enterKeyHint="send"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          placeholder="Message in English or বাংলা…"
          aria-label="Message input"
          className="flex-1 min-w-0 min-h-[44px] max-h-32 py-2.5 px-2 bg-transparent text-base sm:text-sm leading-6 text-zinc-100 placeholder:text-zinc-400 focus:outline-none resize-none overflow-y-auto"
        />

        {chatSending ? (
          <button
            type="button"
            onClick={onStopGenerating}
            aria-label="Stop generating"
            title="Stop generating"
            className="min-h-[44px] min-w-[44px] sm:px-4 rounded-xl bg-rose-500/20 border border-rose-500/35 hover:bg-rose-500/30 text-rose-200 text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors shrink-0"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span className="hidden sm:inline">Stop</span>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Send message"
            className="min-h-[44px] min-w-[44px] sm:px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/[0.06] disabled:text-zinc-400 text-[#052317] text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors shrink-0"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Send</span>
          </button>
        )}
      </form>
    </div>
  );
}
