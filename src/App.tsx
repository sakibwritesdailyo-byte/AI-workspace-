import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ImportPreviewDialog } from './components/ImportPreviewDialog';
import { LeftDrawer } from './components/LeftDrawer';
import { MobileBottomNav } from './components/MobileBottomNav';
import { OfflineBanner } from './components/OfflineBanner';
import { RightDrawer } from './components/RightDrawer';
import { TopBar } from './components/TopBar';
import { AuthModal } from './components/auth/AuthModal';
import { ClaimLocalDataDialog } from './components/auth/ClaimLocalDataDialog';
import { DeleteAccountDialog } from './components/auth/DeleteAccountDialog';
import { ChatStudio } from './components/workspaces/ChatStudio';
import { useMobileKeyboard } from './hooks/useMobileKeyboard';
import { HistoryWorkspace } from './components/workspaces/HistoryWorkspace';
import { ProjectsWorkspace } from './components/workspaces/ProjectsWorkspace';
import {
  buildSingleProjectExportBundle,
  buildWorkspaceExportBundle,
  triggerJsonDownload,
  validateAndInspectImportBundle,
} from './services/backupService';
import { chatService, type ChatErrorCode } from './services/chatService';
import {
  deleteAuthAccount,
  signOutUser,
  subscribeAuthState,
} from './services/firebase/firebaseAuth';
import { testFirestoreConnection } from './services/firebase/firebaseConfig';
import { firestoreService } from './services/firebase/firestoreService';
import {
  CloudSyncCoordinator,
  createInitialSyncEngineState,
} from './services/firebase/syncCoordinator';
import { workspaceRepository } from './services/indexedDbStorage';
import { WorkspacePersistenceCoordinator } from './services/workspacePersistence';
import type { PersistedWorkspaceSnapshot } from './services/workspaceRepository';
import {
  applyImportWorkspaceBundle,
  createInitialWorkspaceState,
  generateStableId,
  getActiveConversation,
  getActiveFile,
  getActiveProject,
  workspaceReducer,
} from './state/workspaceReducer';
import type {
  AuthStatus,
  AuthUserProfile,
  ChatNoticeKind,
  Conversation,
  ImportInspectionPreview,
  Project,
  ProjectFile,
  SyncEngineState,
  WorkspaceId,
  WorkspaceState,
  WorkspaceStorageStats,
} from './types/workspace';

type PendingConfirmation =
  | { kind: 'delete_conversation'; conversation: Conversation }
  | { kind: 'bulk_delete'; count: number }
  | { kind: 'permanent_delete'; conversation: Conversation }
  | { kind: 'clear_chat'; conversation: Conversation }
  | { kind: 'delete_project'; project: Project }
  | { kind: 'delete_file'; file: ProjectFile }
  | { kind: 'delete_folder'; folderPath: string; fileCount: number }
  | { kind: 'clear_all_local' }
  | null;

const INITIAL_STORAGE_STATS: WorkspaceStorageStats = {
  projectCount: 0,
  fileCount: 0,
  conversationCount: 0,
  messageCount: 0,
  voiceSessionCount: 0,
  deletedCount: 0,
  tombstoneCount: 0,
  outboxCount: 0,
  usageBytes: null,
  quotaBytes: null,
  persistedStorage: null,
  storageError: null,
};

function buildSnapshotFromState(state: WorkspaceState): PersistedWorkspaceSnapshot {
  return {
    projects: state.projects,
    conversations: state.conversations,
    deletedConversations: state.deletedConversations,
    voiceSessions: state.voiceSessions,
    preferences: {
      voiceSettings: state.voiceSettings,
      modelSettings: state.modelSettings,
      appSettings: state.appSettings,
      activeProjectId: state.activeProjectId,
      activeConversationId: state.activeConversationId,
      activeFileId: state.activeFileId,
      settingRevisions: state.settingRevisions,
    },
  };
}

export default function App() {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, createInitialWorkspaceState);
  const [desktopLeftOpen, setDesktopLeftOpen] = useState(true);
  const [confirmState, setConfirmState] = useState<PendingConfirmation>(null);
  const [importPreview, setImportPreview] = useState<ImportInspectionPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importDialogError, setImportDialogError] = useState<string | null>(null);
  const [storageStats, setStorageStats] = useState<WorkspaceStorageStats>(INITIAL_STORAGE_STATS);

  const [authStatus, setAuthStatus] = useState<AuthStatus>('initializing');
  const [authUser, setAuthUser] = useState<AuthUserProfile | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncEngineState>(createInitialSyncEngineState);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'signup'>('signin');
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);
  const [deleteAccountNeedsReauth, setDeleteAccountNeedsReauth] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  const { keyboardOpen, viewportHeight } = useMobileKeyboard();

  const stateRef = useRef(state);
  stateRef.current = state;

  const authUserRef = useRef<AuthUserProfile | null>(authUser);
  authUserRef.current = authUser;

  const authEpochRef = useRef(0);
  const lastAppliedAuthUidRef = useRef<string | null | '__UNSET__'>('__UNSET__');
  const activeChatAbortRef = useRef<AbortController | null>(null);
  const activeStreamGenIdRef = useRef(0);

  const coordinatorRef = useRef<WorkspacePersistenceCoordinator | null>(null);
  const syncCoordinatorRef = useRef<CloudSyncCoordinator | null>(null);

  if (!coordinatorRef.current) {
    coordinatorRef.current = new WorkspacePersistenceCoordinator(
      workspaceRepository,
      () => ({
        hydrated: stateRef.current.hydrated,
        autosaveEnabled: stateRef.current.appSettings.autosaveEnabled,
        dataRevision: stateRef.current.dataRevision,
        uiRevision: stateRef.current.uiRevision,
        ownerUid: stateRef.current.activeOwnerUid,
        snapshot: buildSnapshotFromState(stateRef.current),
      }),
      {
        onSaving: () => {
          dispatch({ type: 'SET_SAVE_STATUS', status: 'saving', error: null });
        },
        onSaved: (persistedRevision, savedAt, stats) => {
          setStorageStats(stats);
          dispatch({
            type: 'SET_SAVE_STATUS',
            status: 'saved',
            savedAt,
            persistedRevision,
            error: null,
          });
          if (stateRef.current.activeOwnerUid) {
            syncCoordinatorRef.current?.notifyLocalDataChanged();
          }
        },
        onError: (msg) => {
          dispatch({ type: 'SET_SAVE_STATUS', status: 'error', error: msg });
          setStorageStats((prev) => ({ ...prev, storageError: msg }));
        },
      },
      180,
    );
  }

  if (!syncCoordinatorRef.current) {
    syncCoordinatorRef.current = new CloudSyncCoordinator(
      workspaceRepository,
      firestoreService,
      {
        onStateChange: (nextSyncState) => {
          setSyncState(nextSyncState);
          if (nextSyncState.ownershipPausedReason !== null) {
            setClaimError(null);
            setClaimDialogOpen(true);
          }
        },
        onRemoteChangesApplied: (mergedSnapshot) => {
          const persistedRev = coordinatorRef.current?.getLastPersistedRevision() ?? 0;
          const uiRev = stateRef.current.uiRevision;
          coordinatorRef.current?.resetBaseline(mergedSnapshot, persistedRev, uiRev);
          dispatch({
            type: 'APPLY_REMOTE_SNAPSHOT',
            snapshot: mergedSnapshot,
            syncedAt: new Date().toISOString(),
          });
          void workspaceRepository
            .getStorageStats({ activeOwnerUid: stateRef.current.activeOwnerUid })
            .then((stats) => setStorageStats(stats))
            .catch(() => {});
        },
      },
    );
  }

  const activeProject = getActiveProject(state);
  const activeFile = getActiveFile(state);
  const activeConversation = getActiveConversation(state);

  const openFiles = activeProject
    ? state.openFileIds
        .map((id) => activeProject.files.find((f) => f.id === id))
        .filter((file): file is ProjectFile => Boolean(file))
    : [];

  const refreshStorageStats = useCallback(async () => {
    const stats = await workspaceRepository.getStorageStats({
      activeOwnerUid: stateRef.current.activeOwnerUid,
    });
    setStorageStats(stats);
  }, []);

  const flushPersistToDb = useCallback(async () => {
    await coordinatorRef.current?.flush();
  }, []);

  // 1. Hydrate local-first workspace on startup & verify Firestore reachability
  useEffect(() => {
    let cancelled = false;
    void testFirestoreConnection().catch(() => {});

    workspaceRepository
      .loadWorkspace({ activeOwnerUid: null })
      .then(async (snapshot) => {
        if (cancelled) return;
        coordinatorRef.current?.markHydrated(snapshot, 0, 0);
        dispatch({ type: 'HYDRATE_FROM_STORAGE', snapshot, activeOwnerUid: null });
        if (lastAppliedAuthUidRef.current === '__UNSET__') {
          lastAppliedAuthUidRef.current = null;
        }
        const stats = await workspaceRepository.getStorageStats({ activeOwnerUid: null });
        if (!cancelled) {
          setStorageStats(stats);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const errorMsg =
            err instanceof Error
              ? `IndexedDB unavailable: ${err.message}`
              : 'Unable to load local IndexedDB storage.';
          dispatch({ type: 'SET_STORAGE_ERROR', error: errorMsg });
          setStorageStats((prev) => ({ ...prev, storageError: errorMsg }));
        }
      });

    return () => {
      cancelled = true;
      coordinatorRef.current?.dispose();
      syncCoordinatorRef.current?.dispose();
    };
  }, []);

  // 1b. Subscribe to Firebase Authentication & switch account-scoped IndexedDB state cleanly
  useEffect(() => {
    const unsubscribe = subscribeAuthState(
      (user) => {
        const epoch = ++authEpochRef.current;
        setAuthError(null);
        setAuthUser(user);
        setAuthStatus(user ? 'signed_in' : 'signed_out');

        void (async () => {
          const nextUid = user?.uid ?? null;
          if (lastAppliedAuthUidRef.current !== '__UNSET__' && lastAppliedAuthUidRef.current !== nextUid) {
            activeStreamGenIdRef.current += 1;
            activeChatAbortRef.current?.abort();
            activeChatAbortRef.current = null;
          }
          if (stateRef.current.hydrated) {
            await coordinatorRef.current?.flush();
          }
          if (epoch !== authEpochRef.current) return;

          if (lastAppliedAuthUidRef.current !== nextUid || !stateRef.current.hydrated) {
            const scopedSnapshot = await workspaceRepository.loadWorkspace({
              activeOwnerUid: nextUid,
            });
            if (epoch !== authEpochRef.current) return;

            coordinatorRef.current?.resetBaseline(scopedSnapshot, 0, 0);
            dispatch({
              type: 'SET_ACTIVE_OWNER_AND_HYDRATE',
              activeOwnerUid: nextUid,
              snapshot: scopedSnapshot,
            });
            lastAppliedAuthUidRef.current = nextUid;

            const stats = await workspaceRepository.getStorageStats({ activeOwnerUid: nextUid });
            if (epoch !== authEpochRef.current) return;
            setStorageStats(stats);
          }

          await syncCoordinatorRef.current?.setAuthUser(user);
        })().catch((err) => {
          if (epoch !== authEpochRef.current) return;
          const msg = err instanceof Error ? err.message : 'Unable to switch workspace account scope.';
          setAuthError(msg);
        });
      },
      (errorMsg) => {
        setAuthStatus('error');
        setAuthError(errorMsg);
      },
    );

    const handleOnline = () => syncCoordinatorRef.current?.setOnlineStatus(true);
    const handleOffline = () => syncCoordinatorRef.current?.setOnlineStatus(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 2. Debounced, revision-tracked incremental autosave to IndexedDB
  useEffect(() => {
    if (!state.hydrated || !state.appSettings.autosaveEnabled) return;
    coordinatorRef.current?.scheduleSave();
  }, [
    state.hydrated,
    state.appSettings.autosaveEnabled,
    state.dataRevision,
    state.uiRevision,
  ]);

  // Flush pending changes when tab is hidden or page is unloading
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void flushPersistToDb();
      }
    };
    const handleBeforeUnload = () => {
      void flushPersistToDb();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [flushPersistToDb]);

  // 3. Voice session elapsed timer strictly when streaming
  useEffect(() => {
    const status = state.voiceSession.status;
    if (
      status !== 'listening' &&
      status !== 'thinking' &&
      status !== 'speaking' &&
      status !== 'muted'
    ) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      dispatch({ type: 'VOICE_EVENT', event: { type: 'TICK_SECOND' } });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.voiceSession.status]);

  // 4. Escape closes modals or drawers
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (deleteAccountOpen && !deleteAccountBusy) {
        setDeleteAccountOpen(false);
        return;
      }
      if (authModalOpen) {
        setAuthModalOpen(false);
        return;
      }
      if (confirmState) {
        setConfirmState(null);
        return;
      }
      if (importPreview && !importBusy) {
        setImportDialogError(null);
        setImportPreview(null);
        return;
      }
      if (state.rightDrawerOpen) {
        dispatch({ type: 'SET_RIGHT_DRAWER', open: false });
      }
      if (state.leftDrawerOpen) {
        dispatch({ type: 'SET_LEFT_DRAWER', open: false });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    confirmState,
    importPreview,
    importBusy,
    authModalOpen,
    deleteAccountOpen,
    deleteAccountBusy,
    state.rightDrawerOpen,
    state.leftDrawerOpen,
  ]);

  const handleToggleLeftDrawer = () => {
    if (window.innerWidth >= 1024) {
      setDesktopLeftOpen((prev) => !prev);
    } else {
      dispatch({ type: 'TOGGLE_LEFT_DRAWER' });
    }
  };

  const handleSelectWorkspace = (workspace: WorkspaceId) => {
    void flushPersistToDb();
    dispatch({ type: 'SET_WORKSPACE', workspace });
  };

  const abortActiveChatStream = useCallback(() => {
    activeStreamGenIdRef.current += 1;
    if (activeChatAbortRef.current) {
      activeChatAbortRef.current.abort();
      activeChatAbortRef.current = null;
    }
  }, []);

  const mapChatErrorToNoticeKind = (code: ChatErrorCode): ChatNoticeKind => {
    switch (code) {
      case 'offline':
        return 'offline';
      case 'auth_required':
        return 'auth_required';
      case 'rate_limited':
      case 'quota_exceeded':
        return 'rate_limited';
      case 'missing_api_key':
      case 'invalid_api_key':
      case 'backend_unavailable':
        return 'backend_unavailable';
      default:
        return 'error';
    }
  };

  const runChatStreamForConversation = async (
    targetConversationId: string,
    historyForRequest: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  ) => {
    abortActiveChatStream();
    const genId = ++activeStreamGenIdRef.current;
    const controller = new AbortController();
    activeChatAbortRef.current = controller;

    const modelSettings = stateRef.current.modelSettings;
    let streamedText = '';
    let streamedModel: string | undefined;
    let streamedFallback = false;

    const result = await chatService.streamMessage(
      {
        model: modelSettings.chatModel,
        fallbackModel: modelSettings.fallbackModel,
        autoFallback: modelSettings.autoFallback,
        thinkingLevel: modelSettings.thinkingLevel,
        temperature: modelSettings.temperature,
        maxOutputTokens: modelSettings.maxOutputTokens,
        systemInstruction: modelSettings.customSystemPrompt,
        messages: historyForRequest,
      },
      {
        signal: controller.signal,
        onMeta: (meta) => {
          if (genId !== activeStreamGenIdRef.current) return;
          streamedModel = meta.modelUsed;
          streamedFallback = meta.fallbackUsed;
          dispatch({
            type: 'CHAT_STREAM_META',
            conversationId: targetConversationId,
            modelUsed: meta.modelUsed,
            fallbackUsed: meta.fallbackUsed,
          });
        },
        onDelta: (delta, accumulated) => {
          if (genId !== activeStreamGenIdRef.current) return;
          streamedText = accumulated;
          dispatch({
            type: 'CHAT_STREAM_DELTA',
            conversationId: targetConversationId,
            delta,
          });
        },
      },
    );

    if (activeChatAbortRef.current === controller) {
      activeChatAbortRef.current = null;
    }

    if (genId !== activeStreamGenIdRef.current) {
      return;
    }

    if (result.ok) {
      dispatch({
        type: 'CHAT_RESPONSE_RECEIVED',
        conversationId: targetConversationId,
        reply: result.reply,
        modelUsed: result.modelUsed,
        fallbackUsed: result.fallbackUsed,
        usage: result.usage,
      });
      return;
    }

    if (result.code === 'aborted') {
      const partial = (result.partialReply ?? streamedText).trim();
      if (partial) {
        dispatch({
          type: 'CHAT_RESPONSE_RECEIVED',
          conversationId: targetConversationId,
          reply: partial,
          modelUsed: result.modelUsed ?? streamedModel,
          fallbackUsed: streamedFallback,
          stopped: true,
        });
      } else {
        dispatch({
          type: 'CHAT_RESPONSE_RECEIVED',
          conversationId: targetConversationId,
          reply: '',
        });
      }
      return;
    }

    const partialOnErr = (result.partialReply ?? streamedText).trim();
    if (partialOnErr) {
      dispatch({
        type: 'CHAT_RESPONSE_RECEIVED',
        conversationId: targetConversationId,
        reply: partialOnErr,
        modelUsed: result.modelUsed ?? streamedModel,
        fallbackUsed: streamedFallback,
        stopped: true,
      });
    }

    dispatch({
      type: 'CHAT_RESPONSE_FAILED',
      kind: mapChatErrorToNoticeKind(result.code),
      message: result.message,
      retryable: result.retryable,
    });
  };

  // Real-time Gemini streaming flow: persists user message locally first, then streams from authenticated backend
  const handleSendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || stateRef.current.chatSending) return;

    const currentConv = getActiveConversation(stateRef.current);
    const targetConversationId = currentConv?.id ?? generateStableId('conv');
    const historyForRequest = [
      ...(currentConv?.messages ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: trimmed },
    ];

    dispatch({
      type: 'SEND_USER_MESSAGE',
      text: trimmed,
      conversationId: targetConversationId,
    });

    await runChatStreamForConversation(targetConversationId, historyForRequest);
  };

  const handleStopChatGeneration = () => {
    if (!activeChatAbortRef.current) {
      dispatch({
        type: 'CHAT_RESPONSE_RECEIVED',
        conversationId: stateRef.current.activeConversationId ?? '',
        reply: '',
      });
      return;
    }
    // Abort without incrementing genId so runChatStreamForConversation commits partialReply cleanly
    activeChatAbortRef.current.abort();
  };

  const handleRetryLastMessage = async () => {
    const currentConv = getActiveConversation(stateRef.current);
    if (!currentConv || currentConv.messages.length === 0 || stateRef.current.chatSending) return;

    dispatch({ type: 'RETRY_CHAT_REQUEST' });
    await runChatStreamForConversation(
      currentConv.id,
      currentConv.messages.map((m) => ({ role: m.role, content: m.content })),
    );
  };

  const handleRegenerateLastResponse = async () => {
    const currentConv = getActiveConversation(stateRef.current);
    if (!currentConv || currentConv.messages.length === 0 || stateRef.current.chatSending) return;

    const lastMsg = currentConv.messages[currentConv.messages.length - 1];
    const trimmedHistory =
      lastMsg.role === 'assistant' ? currentConv.messages.slice(0, -1) : currentConv.messages;
    if (trimmedHistory.length === 0) return;

    dispatch({ type: 'PREPARE_REGENERATE_RESPONSE', conversationId: currentConv.id });
    await runChatStreamForConversation(
      currentConv.id,
      trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
    );
  };

  const handleExportWorkspace = () => {
    const bundle = buildWorkspaceExportBundle({
      projects: state.projects,
      conversations: state.conversations,
      deletedConversations: state.deletedConversations,
      voiceSessions: state.voiceSessions,
      voiceSettings: state.voiceSettings,
      modelSettings: state.modelSettings,
      appSettings: state.appSettings,
    });
    triggerJsonDownload(
      `personal-ai-studio-backup-${new Date().toISOString().slice(0, 10)}.json`,
      bundle,
    );
  };

  const handleExportProject = (project: Project) => {
    const slug = project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const bundle = buildSingleProjectExportBundle(project);
    triggerJsonDownload(
      `${slug || 'project'}-backup-${new Date().toISOString().slice(0, 10)}.json`,
      bundle,
    );
  };

  const handleInspectImportFile = (rawJson: string): { ok: boolean; message?: string } => {
    const inspection = validateAndInspectImportBundle(rawJson, {
      projectIds: state.projects.map((p) => p.id),
      conversationIds: state.conversations.map((c) => c.id),
      deletedIds: state.deletedConversations.map((c) => c.id),
      voiceSessionIds: state.voiceSessions.map((v) => v.id),
    });

    if (!inspection.valid || !inspection.bundle) {
      return { ok: false, message: inspection.error || 'Backup validation failed.' };
    }

    setImportDialogError(null);
    setImportPreview(inspection);
    return { ok: true };
  };

  const handleConfirmImport = async (
    duplicateStrategy: 'skip' | 'copy',
    restorePreferences: boolean,
  ) => {
    if (!importPreview?.bundle || importBusy) return;
    setImportBusy(true);
    setImportDialogError(null);
    try {
      await coordinatorRef.current?.flush();
      const previousCommitted =
        coordinatorRef.current?.getLastCommittedSnapshot() ??
        buildSnapshotFromState(createInitialWorkspaceState());
      const candidateState = applyImportWorkspaceBundle(stateRef.current, {
        bundle: importPreview.bundle,
        duplicateStrategy,
        restorePreferences,
      });
      const candidateSnapshot = buildSnapshotFromState(candidateState);
      const stats = await workspaceRepository.importWorkspaceSnapshot(
        previousCommitted,
        candidateSnapshot,
        { ownerUid: stateRef.current.activeOwnerUid },
      );
      coordinatorRef.current?.resetBaseline(
        candidateSnapshot,
        candidateState.dataRevision,
        candidateState.uiRevision,
      );
      setStorageStats(stats);
      dispatch({
        type: 'APPLY_COMMITTED_IMPORT',
        nextState: candidateState,
        savedAt: new Date().toISOString(),
      });
      setImportPreview(null);
      if (stateRef.current.activeOwnerUid) {
        syncCoordinatorRef.current?.notifyLocalDataChanged();
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed persisting backup into IndexedDB. Your previous workspace remains intact.';
      setImportDialogError(msg);
    } finally {
      setImportBusy(false);
    }
  };

  const handleRevertUnsavedChanges = () => {
    const committed = coordinatorRef.current?.getLastCommittedSnapshot();
    if (!committed) return;
    coordinatorRef.current?.resetBaseline(
      committed,
      stateRef.current.dataRevision,
      stateRef.current.uiRevision,
    );
    dispatch({
      type: 'ROLLBACK_TO_COMMITTED_SNAPSHOT',
      snapshot: committed,
      activeOwnerUid: stateRef.current.activeOwnerUid,
    });
  };

  const handleRequestPersistentStorage = async () => {
    await workspaceRepository.requestPersistentStorage();
    await refreshStorageStats();
  };

  const handleOpenAuthModal = (mode: 'signin' | 'signup') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  };

  const handleSyncNow = async () => {
    await coordinatorRef.current?.flush();
    await syncCoordinatorRef.current?.syncNow({ reason: 'manual' });
  };

  const handleSyncBadgeClick = () => {
    if (!authUser) {
      handleOpenAuthModal('signin');
      return;
    }
    if (syncState.ownershipPausedReason !== null) {
      setClaimError(null);
      setClaimDialogOpen(true);
      return;
    }
    void refreshStorageStats();
    dispatch({ type: 'SET_RIGHT_DRAWER', open: true });
  };

  const handleAccountClick = () => {
    if (!authUser) {
      handleOpenAuthModal('signin');
      return;
    }
    void refreshStorageStats();
    dispatch({ type: 'SET_RIGHT_DRAWER', open: true });
  };

  const handleClaimAction = async (
    choice: 'claim_and_merge' | 'keep_local_separate' | 'confirm_account_switch',
  ) => {
    if (claimBusy) return;
    setClaimBusy(true);
    setClaimError(null);
    try {
      await coordinatorRef.current?.flush();
      await syncCoordinatorRef.current?.resolveOwnershipPrompt(choice);
      setClaimDialogOpen(false);
      await refreshStorageStats();
    } catch (err) {
      setClaimError(
        err instanceof Error ? err.message : 'Unable to complete ownership confirmation.',
      );
    } finally {
      setClaimBusy(false);
    }
  };

  const handleSignOut = async () => {
    await coordinatorRef.current?.flush();
    const res = await signOutUser();
    if (!res.ok) {
      setAuthError(res.message || 'Sign out failed.');
      return;
    }
    setClaimDialogOpen(false);
  };

  const handleConfirmDeleteAccount = async (options: {
    deleteLocalData: boolean;
    reauthPassword?: string;
    reauthWithGoogle?: boolean;
  }) => {
    const targetUser = authUserRef.current;
    if (!targetUser || deleteAccountBusy) return;

    setDeleteAccountBusy(true);
    setDeleteAccountError(null);
    const deletedUid = targetUser.uid;

    try {
      await coordinatorRef.current?.flush();
      const res = await deleteAuthAccount({
        cleanupCloudData: (uid) => firestoreService.deleteAllUserCloudData(uid),
        reauthPassword: options.reauthPassword,
        reauthWithGoogle: options.reauthWithGoogle,
      });

      if (!res.ok) {
        if (res.errorCode === 'auth/requires-recent-login') {
          setDeleteAccountNeedsReauth(true);
        }
        setDeleteAccountError(res.message || 'Unable to delete account.');
        return;
      }

      if (options.deleteLocalData) {
        const emptySnapshot = buildSnapshotFromState(createInitialWorkspaceState(null));
        if (coordinatorRef.current) {
          await coordinatorRef.current.runExclusiveClear(
            () => workspaceRepository.deleteAccountLocalData(deletedUid),
            emptySnapshot,
          );
        } else {
          await workspaceRepository.deleteAccountLocalData(deletedUid);
        }
      }

      setDeleteAccountOpen(false);
      setDeleteAccountNeedsReauth(false);
      setDeleteAccountError(null);
      setClaimDialogOpen(false);
    } catch (err) {
      setDeleteAccountError(
        err instanceof Error ? err.message : 'Account deletion failed unexpectedly.',
      );
    } finally {
      setDeleteAccountBusy(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmState) return;
    if (confirmState.kind === 'delete_conversation') {
      if (confirmState.conversation.id === stateRef.current.activeConversationId) {
        abortActiveChatStream();
      }
      dispatch({ type: 'DELETE_CONVERSATION', conversationId: confirmState.conversation.id });
    } else if (confirmState.kind === 'bulk_delete') {
      abortActiveChatStream();
      dispatch({ type: 'BULK_DELETE_CONVERSATIONS' });
    } else if (confirmState.kind === 'permanent_delete') {
      dispatch({
        type: 'PERMANENTLY_DELETE_CONVERSATION',
        conversationId: confirmState.conversation.id,
      });
    } else if (confirmState.kind === 'clear_chat') {
      abortActiveChatStream();
      dispatch({ type: 'CLEAR_ACTIVE_CONVERSATION' });
    } else if (confirmState.kind === 'delete_project') {
      dispatch({ type: 'DELETE_PROJECT', projectId: confirmState.project.id });
    } else if (confirmState.kind === 'delete_file') {
      dispatch({ type: 'DELETE_FILE', fileId: confirmState.file.id });
    } else if (confirmState.kind === 'delete_folder') {
      dispatch({ type: 'DELETE_FOLDER', folderPath: confirmState.folderPath });
    } else if (confirmState.kind === 'clear_all_local') {
      abortActiveChatStream();
      const currentOwnerUid = stateRef.current.activeOwnerUid;
      const resetSnapshot = buildSnapshotFromState(createInitialWorkspaceState(currentOwnerUid));
      try {
        const stats = coordinatorRef.current
          ? await coordinatorRef.current.runExclusiveClear(
              () => workspaceRepository.clearAllData(),
              resetSnapshot,
            )
          : await workspaceRepository.clearAllData();
        setStorageStats(stats);
        dispatch({ type: 'CLEAR_ALL_LOCAL_DATA', activeOwnerUid: currentOwnerUid });
        void syncCoordinatorRef.current?.refreshDiagnostics();
      } catch (err) {
        const msg =
          err instanceof Error
            ? `Failed clearing IndexedDB data: ${err.message}`
            : 'Failed clearing local IndexedDB data.';
        dispatch({ type: 'SET_STORAGE_ERROR', error: msg });
        setStorageStats((prev) => ({ ...prev, storageError: msg }));
      }
    }
    setConfirmState(null);
  };

  const confirmCopy = (() => {
    if (!confirmState) return { title: '', description: '', confirmLabel: 'Confirm' };
    switch (confirmState.kind) {
      case 'delete_conversation':
        return {
          title: `Delete "${confirmState.conversation.title}"?`,
          description:
            'This conversation and all of its messages will be moved to Recently Deleted.',
          confirmLabel: 'Delete Conversation',
        };
      case 'bulk_delete':
        return {
          title: `Delete ${confirmState.count} selected ${
            confirmState.count === 1 ? 'conversation' : 'conversations'
          }?`,
          description:
            'All selected conversations and their messages will be moved to Recently Deleted.',
          confirmLabel: `Delete ${confirmState.count} ${
            confirmState.count === 1 ? 'Conversation' : 'Conversations'
          }`,
        };
      case 'permanent_delete':
        return {
          title: `Permanently delete "${confirmState.conversation.title}"?`,
          description:
            'This conversation, its messages, and linked voice session logs will be permanently removed from IndexedDB.',
          confirmLabel: 'Delete Forever',
        };
      case 'clear_chat':
        return {
          title: `Clear messages in "${confirmState.conversation.title}"?`,
          description:
            'All messages inside this conversation will be cleared. Other conversations remain untouched.',
          confirmLabel: 'Clear Messages',
        };
      case 'delete_project':
        return {
          title: `Delete project "${confirmState.project.name}"?`,
          description:
            'All folders and files inside this project will be removed from local IndexedDB storage.',
          confirmLabel: 'Delete Project',
        };
      case 'delete_file':
        return {
          title: `Delete file "${confirmState.file.name}"?`,
          description: `This removes "${confirmState.file.path}" from the active project in IndexedDB.`,
          confirmLabel: 'Delete File',
        };
      case 'delete_folder':
        return {
          title: `Delete folder "${confirmState.folderPath}"?`,
          description:
            confirmState.fileCount > 0
              ? `This removes the folder and ${confirmState.fileCount} file(s) inside it from IndexedDB.`
              : 'This removes the empty folder from the project.',
          confirmLabel: 'Delete Folder',
        };
      case 'clear_all_local':
        return {
          title: 'Clear all local IndexedDB data?',
          description:
            'This removes all saved projects, files, conversations, messages, voice logs, trash, and settings stored on this device.',
          confirmLabel: 'Clear Everything',
        };
    }
  })();

  const isFlexScrollWorkspace =
    state.activeWorkspace === 'chat' ||
    (state.activeWorkspace === 'projects' &&
      (state.projectSubView === 'code' || state.projectSubView === 'preview'));

  return (
    <div
      style={keyboardOpen && viewportHeight ? { height: `${viewportHeight}px` } : undefined}
      className="h-[100dvh] flex flex-col bg-[#090B0E] text-[#ECEFF4] overflow-hidden"
    >
      <TopBar
        activeWorkspace={state.activeWorkspace}
        rightDrawerOpen={state.rightDrawerOpen}
        authStatus={authStatus}
        authUser={authUser}
        syncState={syncState}
        onSelectWorkspace={handleSelectWorkspace}
        onToggleLeftDrawer={handleToggleLeftDrawer}
        onToggleRightDrawer={() => {
          void refreshStorageStats();
          dispatch({ type: 'TOGGLE_RIGHT_DRAWER' });
        }}
        onSyncBadgeClick={handleSyncBadgeClick}
        onAccountClick={handleAccountClick}
        onNewChat={() => {
          abortActiveChatStream();
          dispatch({ type: 'CREATE_CONVERSATION', kind: 'chat' });
        }}
      />

      <OfflineBanner />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <LeftDrawer
          mobileOpen={state.leftDrawerOpen}
          desktopOpen={desktopLeftOpen}
          conversations={state.conversations}
          activeConversationId={state.activeConversationId}
          projects={state.projects}
          activeProject={activeProject}
          activeFileId={state.activeFileId}
          expandedFolders={state.expandedFolders}
          onCloseMobile={() => dispatch({ type: 'SET_LEFT_DRAWER', open: false })}
          onSelectConversation={(conversationId) => {
            abortActiveChatStream();
            dispatch({ type: 'SELECT_CONVERSATION', conversationId, openChat: true });
          }}
          onNewChat={() => {
            abortActiveChatStream();
            dispatch({ type: 'CREATE_CONVERSATION', kind: 'chat' });
          }}
          onSelectProject={(projectId) => dispatch({ type: 'SELECT_PROJECT', projectId })}
          onPreviewSampleProject={(sampleProjectId) =>
            dispatch({ type: 'PREVIEW_SAMPLE_PROJECT', sampleProjectId, subView: 'code' })
          }
          onCreateProject={(name) => dispatch({ type: 'CREATE_PROJECT', name })}
          onRenameProject={(projectId, name) =>
            dispatch({ type: 'RENAME_PROJECT', projectId, name })
          }
          onDuplicateProject={(projectId) =>
            dispatch({ type: 'DUPLICATE_PROJECT', projectId })
          }
          onRequestDeleteProject={(project) =>
            setConfirmState({ kind: 'delete_project', project })
          }
          onSelectFile={(fileId) =>
            dispatch({ type: 'SELECT_FILE', fileId, openCodeStudio: true })
          }
          onCreateFile={(folder, name) => dispatch({ type: 'CREATE_FILE', folder, name })}
          onRenameFile={(fileId, newName) => dispatch({ type: 'RENAME_FILE', fileId, newName })}
          onRequestDeleteFile={(file) => setConfirmState({ kind: 'delete_file', file })}
          onCreateFolder={(folderPath) => dispatch({ type: 'CREATE_FOLDER', folderPath })}
          onRenameFolder={(oldPath, newPath) =>
            dispatch({ type: 'RENAME_FOLDER', oldPath, newPath })
          }
          onRequestDeleteFolder={(folderPath, fileCount) =>
            setConfirmState({ kind: 'delete_folder', folderPath, fileCount })
          }
          onToggleFolder={(folderPath) => dispatch({ type: 'TOGGLE_FOLDER', folderPath })}
        />

        <main
          id="main-workspace"
          className={`flex-1 min-w-0 min-h-0 ${
            isFlexScrollWorkspace ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'
          }`}
        >
          {state.saveStatus === 'error' && state.storageError && (
            <div
              role="alert"
              className="mx-3 sm:mx-6 mt-3 rounded-xl border border-rose-500/35 bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-100 flex flex-wrap items-center justify-between gap-2.5 shrink-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-rose-300 shrink-0" />
                <span className="truncate sm:whitespace-normal">{state.storageError}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void flushPersistToDb()}
                  className="min-h-[34px] px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#052317] font-semibold"
                >
                  Retry Save
                </button>
                {coordinatorRef.current?.getLastCommittedSnapshot() && (
                  <button
                    type="button"
                    onClick={handleRevertUnsavedChanges}
                    className="min-h-[34px] px-3 rounded-lg border border-white/15 hover:bg-white/[0.08] text-zinc-200 font-medium"
                  >
                    Revert Unsaved
                  </button>
                )}
              </div>
            </div>
          )}

          {state.workspaceNotice && (
            <div
              role="alert"
              className="mx-3 sm:mx-6 mt-3 rounded-xl border border-amber-500/35 bg-amber-500/12 px-3.5 py-2.5 text-xs text-amber-100 flex items-center justify-between gap-3 shrink-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-amber-300 shrink-0" />
                <span className="truncate sm:whitespace-normal">{state.workspaceNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: 'CLEAR_WORKSPACE_NOTICE' })}
                aria-label="Dismiss workspace notice"
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-amber-200 hover:bg-white/[0.08] shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {state.activeWorkspace === 'chat' && (
            <ChatStudio
              hydrated={state.hydrated}
              conversations={state.conversations}
              activeConversation={activeConversation}
              modelSettings={state.modelSettings}
              storageError={state.storageError}
              authStatus={authStatus}
              authUser={authUser}
              chatSending={state.chatSending}
              chatStreaming={state.chatStreaming}
              chatNotice={state.chatNotice}
              keyboardOpen={keyboardOpen}
              viewportHeight={viewportHeight}
              onSelectConversation={(conversationId) => {
                abortActiveChatStream();
                dispatch({ type: 'SELECT_CONVERSATION', conversationId });
              }}
              onNewConversation={() => {
                abortActiveChatStream();
                dispatch({ type: 'CREATE_CONVERSATION', kind: 'chat' });
              }}
              onRenameConversation={(conversationId, title) =>
                dispatch({ type: 'RENAME_CONVERSATION', conversationId, title })
              }
              onTogglePinConversation={(conversationId) =>
                dispatch({ type: 'TOGGLE_PIN_CONVERSATION', conversationId })
              }
              onRequestClearActiveConversation={() => {
                if (activeConversation) {
                  setConfirmState({ kind: 'clear_chat', conversation: activeConversation });
                }
              }}
              onSendMessage={(text) => void handleSendMessage(text)}
              onStopGenerating={handleStopChatGeneration}
              onRetryLastMessage={() => void handleRetryLastMessage()}
              onRegenerateLastResponse={() => void handleRegenerateLastResponse()}
              onDismissNotice={() => dispatch({ type: 'CLEAR_CHAT_NOTICE' })}
              onOpenSignIn={() => handleOpenAuthModal('signin')}
            />
          )}

          {state.activeWorkspace === 'projects' && (
            <ProjectsWorkspace
              projects={state.projects}
              activeProject={activeProject}
              subView={state.projectSubView}
              openFiles={openFiles}
              activeFile={activeFile}
              dirtyFileIds={state.dirtyFileIds}
              saveStatus={state.saveStatus}
              lastSavedAt={state.lastSavedAt}
              storageError={state.storageError}
              showLineNumbers={state.appSettings.showLineNumbers}
              previewViewport={state.previewViewport}
              previewNonce={state.previewNonce}
              onChangeSubView={(subView) => {
                void flushPersistToDb();
                dispatch({ type: 'SET_PROJECT_SUBVIEW', subView });
              }}
              onSelectProject={(projectId, subView) =>
                dispatch({ type: 'SELECT_PROJECT', projectId, subView })
              }
              onPreviewSampleProject={(sampleProjectId, subView) =>
                dispatch({ type: 'PREVIEW_SAMPLE_PROJECT', sampleProjectId, subView })
              }
              onCloneSampleProject={(sampleProjectId) =>
                dispatch({ type: 'CLONE_SAMPLE_PROJECT', sampleProjectId })
              }
              onCreateProject={(name, description) =>
                dispatch({ type: 'CREATE_PROJECT', name, description })
              }
              onRenameProject={(projectId, name) =>
                dispatch({ type: 'RENAME_PROJECT', projectId, name })
              }
              onDuplicateProject={(projectId) =>
                dispatch({ type: 'DUPLICATE_PROJECT', projectId })
              }
              onExportProject={handleExportProject}
              onRequestDeleteProject={(project) =>
                setConfirmState({ kind: 'delete_project', project })
              }
              onSelectFile={(fileId, openCodeStudio) =>
                dispatch({ type: 'SELECT_FILE', fileId, openCodeStudio })
              }
              onCreateFile={(folder, name) => dispatch({ type: 'CREATE_FILE', folder, name })}
              onRenameFile={(fileId, newName) => dispatch({ type: 'RENAME_FILE', fileId, newName })}
              onRequestDeleteFile={(file) => setConfirmState({ kind: 'delete_file', file })}
              onCreateFolder={(folderPath) => dispatch({ type: 'CREATE_FOLDER', folderPath })}
              onRenameFolder={(oldPath, newPath) =>
                dispatch({ type: 'RENAME_FOLDER', oldPath, newPath })
              }
              onRequestDeleteFolder={(folderPath, fileCount) =>
                setConfirmState({ kind: 'delete_folder', folderPath, fileCount })
              }
              onCloseTab={(fileId) => dispatch({ type: 'CLOSE_FILE_TAB', fileId })}
              onChangeFileContent={(fileId, content) =>
                dispatch({ type: 'UPDATE_FILE_CONTENT', fileId, content })
              }
              onFlushSaveNow={() => void flushPersistToDb()}
              onChangePreviewViewport={(viewport) =>
                dispatch({ type: 'SET_PREVIEW_VIEWPORT', viewport })
              }
              onRefreshPreview={() => dispatch({ type: 'REFRESH_PREVIEW' })}
              onExportWorkspace={handleExportWorkspace}
              onInspectImportFile={handleInspectImportFile}
              onOpenFilesDrawer={() => dispatch({ type: 'SET_LEFT_DRAWER', open: true })}
            />
          )}

          {state.activeWorkspace === 'history' && (
            <HistoryWorkspace
              conversations={state.conversations}
              deletedConversations={state.deletedConversations}
              storageStats={storageStats}
              activeConversationId={state.activeConversationId}
              selectedConversationIds={state.selectedConversationIds}
              filter={state.historyFilter}
              searchQuery={state.historySearch}
              onChangeFilter={(filter) => dispatch({ type: 'SET_HISTORY_FILTER', filter })}
              onChangeSearch={(query) => dispatch({ type: 'SET_HISTORY_SEARCH', query })}
              onOpenConversation={(conversationId) =>
                dispatch({ type: 'SELECT_CONVERSATION', conversationId, openChat: true })
              }
              onCreateConversation={() =>
                dispatch({ type: 'CREATE_CONVERSATION', kind: 'chat' })
              }
              onRenameConversation={(conversationId, title) =>
                dispatch({ type: 'RENAME_CONVERSATION', conversationId, title })
              }
              onTogglePinConversation={(conversationId) =>
                dispatch({ type: 'TOGGLE_PIN_CONVERSATION', conversationId })
              }
              onRequestDeleteConversation={(conversation) =>
                setConfirmState({ kind: 'delete_conversation', conversation })
              }
              onToggleSelectConversation={(conversationId) =>
                dispatch({ type: 'TOGGLE_SELECT_CONVERSATION', conversationId })
              }
              onSelectAllConversations={(conversationIds) =>
                dispatch({ type: 'SELECT_ALL_CONVERSATIONS', conversationIds })
              }
              onClearSelection={() => dispatch({ type: 'CLEAR_SELECTED_CONVERSATIONS' })}
              onRequestBulkDelete={(count) => setConfirmState({ kind: 'bulk_delete', count })}
              onRestoreDeleted={(conversationId) =>
                dispatch({ type: 'RESTORE_DELETED_CONVERSATION', conversationId })
              }
              onRequestPermanentDelete={(conversation) =>
                setConfirmState({ kind: 'permanent_delete', conversation })
              }
              onCloneSampleConversation={(sampleConversationId) =>
                dispatch({ type: 'CLONE_SAMPLE_CONVERSATION', sampleConversationId })
              }
            />
          )}
        </main>
      </div>

      <RightDrawer
        open={state.rightDrawerOpen}
        voiceSettings={state.voiceSettings}
        modelSettings={state.modelSettings}
        appSettings={state.appSettings}
        storageStats={storageStats}
        authStatus={authStatus}
        authError={authError}
        authUser={authUser}
        syncState={syncState}
        onClose={() => dispatch({ type: 'SET_RIGHT_DRAWER', open: false })}
        onUpdateVoiceSettings={(patch) => dispatch({ type: 'UPDATE_VOICE_SETTINGS', patch })}
        onUpdateModelSettings={(patch) => dispatch({ type: 'UPDATE_MODEL_SETTINGS', patch })}
        onUpdateAppSettings={(patch) => dispatch({ type: 'UPDATE_APP_SETTINGS', patch })}
        onRequestPersistentStorage={handleRequestPersistentStorage}
        onExportWorkspace={handleExportWorkspace}
        onInspectImportFile={handleInspectImportFile}
        onRequestClearLocalData={() => {
          dispatch({ type: 'SET_RIGHT_DRAWER', open: false });
          setConfirmState({ kind: 'clear_all_local' });
        }}
        onOpenAuthModal={handleOpenAuthModal}
        onSyncNow={() => void handleSyncNow()}
        onOpenClaimDialog={() => {
          setClaimError(null);
          setClaimDialogOpen(true);
        }}
        onDismissConflict={(conflictId) => syncCoordinatorRef.current?.dismissConflict(conflictId)}
        onSignOut={() => void handleSignOut()}
        onRequestDeleteAccount={() => {
          dispatch({ type: 'SET_RIGHT_DRAWER', open: false });
          setDeleteAccountError(null);
          setDeleteAccountNeedsReauth(false);
          setDeleteAccountOpen(true);
        }}
      />

      <AuthModal
        open={authModalOpen}
        initialMode={authModalMode}
        onClose={() => setAuthModalOpen(false)}
      />

      <ClaimLocalDataDialog
        open={claimDialogOpen}
        user={authUser}
        pauseReason={
          syncState.ownershipPausedReason ??
          (claimDialogOpen && (syncState.ownershipSummary?.unclaimedCount ?? 0) > 0
            ? 'unclaimed_local_data_present'
            : null)
        }
        ownershipSummary={syncState.ownershipSummary}
        busy={claimBusy}
        error={claimError}
        onClaimAndMerge={() => void handleClaimAction('claim_and_merge')}
        onKeepSeparate={() => void handleClaimAction('keep_local_separate')}
        onConfirmAccountSwitch={() => void handleClaimAction('confirm_account_switch')}
        onSignOut={() => void handleSignOut()}
      />

      <DeleteAccountDialog
        open={deleteAccountOpen}
        user={authUser}
        busy={deleteAccountBusy}
        needsReauth={deleteAccountNeedsReauth}
        error={deleteAccountError}
        onConfirmDelete={(options) => void handleConfirmDeleteAccount(options)}
        onCancel={() => {
          if (!deleteAccountBusy) {
            setDeleteAccountError(null);
            setDeleteAccountNeedsReauth(false);
            setDeleteAccountOpen(false);
          }
        }}
      />

      <ImportPreviewDialog
        preview={importPreview}
        importing={importBusy}
        importError={importDialogError}
        onConfirm={(strategy, restore) => void handleConfirmImport(strategy, restore)}
        onCancel={() => {
          if (!importBusy) {
            setImportDialogError(null);
            setImportPreview(null);
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
        onConfirm={() => void handleConfirmAction()}
        onCancel={() => setConfirmState(null)}
      />

      <MobileBottomNav
        activeWorkspace={state.activeWorkspace}
        hidden={keyboardOpen}
        onSelectWorkspace={handleSelectWorkspace}
      />
    </div>
  );
}
