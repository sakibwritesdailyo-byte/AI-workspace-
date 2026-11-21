import { useRef, useState } from 'react';
import {
  Database,
  Download,
  HardDrive,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import { SYSTEM_PROMPT_PRESETS } from '../data/mockWorkspaceData';
import {
  CHAT_MODEL_CATALOG,
  getChatModelDefinition,
  isLegacyAliasedModel,
  LEGACY_MODEL_ALIASES,
  type ThinkingLevelOption,
} from '../shared/modelRegistry';
import type {
  AppSettings,
  AuthStatus,
  AuthUserProfile,
  ModelSettings,
  SyncEngineState,
  VoiceLanguageMode,
  VoiceSettings,
  WorkspaceStorageStats,
} from '../types/workspace';
import { AccountSyncSection } from './auth/AccountSyncSection';
import { PWAInstallButton } from './PWAInstallButton';

interface RightDrawerProps {
  open: boolean;
  voiceSettings: VoiceSettings;
  modelSettings: ModelSettings;
  appSettings: AppSettings;
  storageStats: WorkspaceStorageStats;
  authStatus: AuthStatus;
  authError: string | null;
  authUser: AuthUserProfile | null;
  syncState: SyncEngineState;
  onClose: () => void;
  onUpdateVoiceSettings: (patch: Partial<VoiceSettings>) => void;
  onUpdateModelSettings: (patch: Partial<ModelSettings>) => void;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => void;
  onRequestPersistentStorage: () => Promise<void>;
  onExportWorkspace: () => void;
  onInspectImportFile: (rawJson: string) => { ok: boolean; message?: string };
  onRequestClearLocalData: () => void;
  onOpenAuthModal: (mode: 'signin' | 'signup') => void;
  onSyncNow: () => void;
  onOpenClaimDialog: () => void;
  onDismissConflict: (conflictId: string) => void;
  onSignOut: () => void;
  onRequestDeleteAccount: () => void;
}

const VOICE_PROFILES: VoiceSettings['voiceName'][] = ['Aoede', 'Kore', 'Charon', 'Fenrir', 'Puck'];

function formatBytes(bytes: number | null): string {
  if (bytes === null || Number.isNaN(bytes)) return 'Unavailable';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function RightDrawer({
  open,
  voiceSettings,
  modelSettings,
  appSettings,
  storageStats,
  authStatus,
  authError,
  authUser,
  syncState,
  onClose,
  onUpdateVoiceSettings,
  onUpdateModelSettings,
  onUpdateAppSettings,
  onRequestPersistentStorage,
  onExportWorkspace,
  onInspectImportFile,
  onRequestClearLocalData,
  onOpenAuthModal,
  onSyncNow,
  onOpenClaimDialog,
  onDismissConflict,
  onSignOut,
  onRequestDeleteAccount,
}: RightDrawerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [requestingPersist, setRequestingPersist] = useState(false);

  if (!open) return null;

  const handlePresetChange = (presetId: string) => {
    const preset = SYSTEM_PROMPT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    onUpdateModelSettings({
      systemPromptId: preset.id,
      customSystemPrompt: preset.prompt,
    });
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const result = onInspectImportFile(text);
      setImportError(result.ok ? null : result.message || 'Invalid backup file.');
    } catch {
      setImportError('Unable to read the selected file.');
    }
  };

  const handlePersistClick = async () => {
    setRequestingPersist(true);
    try {
      await onRequestPersistentStorage();
    } finally {
      setRequestingPersist(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
      />

      <aside
        aria-label="Studio settings and storage drawer"
        className="relative z-10 w-full max-w-[360px] h-full bg-[#0C0F14] border-l border-white/[0.09] shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings drawer"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-zinc-300 hover:text-zinc-100 hover:bg-white/[0.06]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6 text-sm">
          {/* Account & Cloud Sync (Firebase) */}
          <AccountSyncSection
            authStatus={authStatus}
            authError={authError}
            user={authUser}
            syncState={syncState}
            onOpenAuthModal={onOpenAuthModal}
            onSyncNow={onSyncNow}
            onOpenClaimDialog={onOpenClaimDialog}
            onDismissConflict={onDismissConflict}
            onSignOut={onSignOut}
            onRequestDeleteAccount={onRequestDeleteAccount}
          />

          <hr className="border-white/[0.07]" />

          {/* App Installation (PWA) */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
              <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
              <span>PWA Installation & Offline App</span>
            </div>
            <PWAInstallButton variant="settings" />
          </section>

          <hr className="border-white/[0.07]" />

          {/* Voice & Audio */}
          <section className="space-y-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
              <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Voice & Audio</span>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs text-zinc-300">Language Mode</span>
              <select
                value={voiceSettings.languageMode}
                onChange={(e) =>
                  onUpdateVoiceSettings({ languageMode: e.target.value as VoiceLanguageMode })
                }
                className="w-full h-10 px-3 rounded-lg bg-[#090B0E] border border-white/15 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
              >
                <option value="bilingual">Bilingual (Bangla + English)</option>
                <option value="en">English Only</option>
                <option value="bn">বাংলা (Bangla Only)</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs text-zinc-300">Voice Profile</span>
              <select
                value={voiceSettings.voiceName}
                onChange={(e) =>
                  onUpdateVoiceSettings({
                    voiceName: e.target.value as VoiceSettings['voiceName'],
                  })
                }
                className="w-full h-10 px-3 rounded-lg bg-[#090B0E] border border-white/15 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
              >
                {VOICE_PROFILES.map((voice) => (
                  <option key={voice} value={voice}>
                    {voice}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center justify-between gap-3 cursor-pointer min-h-[36px]">
              <span className="text-xs text-zinc-200">Allow Voice Interruption (Barge-in)</span>
              <input
                type="checkbox"
                checked={voiceSettings.allowBargeIn}
                onChange={(e) => onUpdateVoiceSettings({ allowBargeIn: e.target.checked })}
                className="w-4 h-4 accent-emerald-500 rounded"
              />
            </label>

            <label className="flex items-center justify-between gap-3 cursor-pointer min-h-[36px]">
              <span className="text-xs text-zinc-200">Save Session Transcripts</span>
              <input
                type="checkbox"
                checked={voiceSettings.saveTranscripts}
                onChange={(e) => onUpdateVoiceSettings({ saveTranscripts: e.target.checked })}
                className="w-4 h-4 accent-emerald-500 rounded"
              />
            </label>
          </section>

          <hr className="border-white/[0.07]" />

          {/* Model & System Prompt */}
          <section className="space-y-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>Model & System Prompt</span>
            </div>

            {(() => {
              const aliasedTarget = LEGACY_MODEL_ALIASES[modelSettings.chatModel];
              const effectiveModelId = aliasedTarget ?? modelSettings.chatModel;
              const selectedCap =
                getChatModelDefinition(effectiveModelId) ?? CHAT_MODEL_CATALOG[0];
              const isLegacy = isLegacyAliasedModel(modelSettings.chatModel);

              return (
                <>
                  <label className="block space-y-1.5">
                    <span className="text-xs text-zinc-300">Standard Chat Model</span>
                    <select
                      value={modelSettings.chatModel}
                      onChange={(e) => onUpdateModelSettings({ chatModel: e.target.value })}
                      className="w-full h-10 px-3 rounded-lg bg-[#090B0E] border border-white/15 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
                    >
                      {CHAT_MODEL_CATALOG.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                      {isLegacy && (
                        <option value={modelSettings.chatModel}>
                          {modelSettings.chatModel} (Legacy → {aliasedTarget})
                        </option>
                      )}
                    </select>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      {selectedCap.description}
                    </p>
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-xs text-zinc-300">Reasoning Depth (Thinking Level)</span>
                    <select
                      value={modelSettings.thinkingLevel ?? 'auto'}
                      onChange={(e) =>
                        onUpdateModelSettings({
                          thinkingLevel: e.target.value as ThinkingLevelOption,
                        })
                      }
                      className="w-full h-10 px-3 rounded-lg bg-[#090B0E] border border-white/15 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="auto">Auto (Model default: {selectedCap.defaultThinkingLevel})</option>
                      {selectedCap.supportedThinkingLevels.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {lvl === 'xhigh'
                            ? 'XHigh (Deepest reasoning)'
                            : lvl === 'high'
                              ? 'High (Thorough)'
                              : lvl === 'medium'
                                ? 'Medium (Balanced)'
                                : lvl === 'low'
                                  ? 'Low (Faster)'
                                  : 'Minimal (Instant)'}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-xs text-zinc-300">System Prompt Preset</span>
                    <select
                      value={modelSettings.systemPromptId}
                      onChange={(e) => handlePresetChange(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg bg-[#090B0E] border border-white/15 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
                    >
                      {SYSTEM_PROMPT_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-xs text-zinc-300">Active System Instruction</span>
                    <textarea
                      rows={3}
                      value={modelSettings.customSystemPrompt}
                      onChange={(e) =>
                        onUpdateModelSettings({ customSystemPrompt: e.target.value })
                      }
                      className="w-full p-2.5 rounded-lg bg-[#090B0E] border border-white/15 text-xs text-zinc-200 leading-relaxed focus:outline-none focus:border-emerald-500 resize-y"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-zinc-300">
                      <span>Temperature {selectedCap.supportsTemperature ? '' : '(Flash Lite only)'}</span>
                      <span className="font-mono tabular-nums text-zinc-100">
                        {selectedCap.supportsTemperature ? modelSettings.temperature.toFixed(1) : 'Auto'}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      disabled={!selectedCap.supportsTemperature}
                      value={modelSettings.temperature}
                      onChange={(e) =>
                        onUpdateModelSettings({ temperature: parseFloat(e.target.value) })
                      }
                      className="w-full accent-emerald-500 disabled:opacity-40"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-3 cursor-pointer min-h-[36px]">
                    <span className="text-xs text-zinc-200">
                      Automatic Fallback ({modelSettings.fallbackModel})
                    </span>
                    <input
                      type="checkbox"
                      checked={modelSettings.autoFallback}
                      onChange={(e) => onUpdateModelSettings({ autoFallback: e.target.checked })}
                      className="w-4 h-4 accent-emerald-500 rounded"
                    />
                  </label>

                  <div className="rounded-xl border border-white/[0.07] bg-[#090B0E] p-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-zinc-300">
                      <span>Live Voice Model (Phase 5)</span>
                      <span className="font-mono text-zinc-400 truncate max-w-[165px]">
                        {modelSettings.liveModel}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-zinc-300">
                      <span>Fallback Chat Model</span>
                      <span className="font-mono text-zinc-400 truncate max-w-[165px]">
                        {modelSettings.fallbackModel}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed pt-1 border-t border-white/[0.06]">
                      Standard text chat routes securely via the server-side Gemini backend; real-time
                      Gemini Live voice activates in Phase 5.
                    </p>
                  </div>
                </>
              );
            })()}
          </section>

          <hr className="border-white/[0.07]" />

          {/* Local Storage & Backup */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              <span>Local Storage & Backup (IndexedDB)</span>
            </div>

            <div
              data-testid="settings-storage-stats"
              className="text-xs text-zinc-300 space-y-1.5 font-mono tabular-nums"
            >
              <div className="flex justify-between">
                <span className="font-sans text-zinc-400">Saved Projects</span>
                <span className="text-zinc-100" data-stat="projects">
                  {storageStats.projectCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-zinc-400">Saved Files</span>
                <span className="text-zinc-100" data-stat="files">
                  {storageStats.fileCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-zinc-400">Saved Conversations</span>
                <span className="text-zinc-100" data-stat="conversations">
                  {storageStats.conversationCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-zinc-400">Saved Messages</span>
                <span className="text-zinc-100" data-stat="messages">
                  {storageStats.messageCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-zinc-400">Voice Session Logs</span>
                <span className="text-zinc-100" data-stat="voice-sessions">
                  {storageStats.voiceSessionCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-zinc-400">Recently Deleted</span>
                <span className="text-zinc-100" data-stat="deleted">
                  {storageStats.deletedCount}
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-white/[0.06]">
                <span className="font-sans text-zinc-400">Device Storage Usage</span>
                <span className="text-zinc-100">
                  {formatBytes(storageStats.usageBytes)} / {formatBytes(storageStats.quotaBytes)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-zinc-400">Persistence Mode</span>
                <span className="font-sans text-zinc-200">
                  {storageStats.persistedStorage === true
                    ? 'Persistent'
                    : storageStats.persistedStorage === false
                      ? 'Best-effort'
                      : 'Unknown'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-zinc-400">Cloud Sync (Firestore)</span>
                <span
                  className={`font-sans font-medium ${
                    !authUser
                      ? 'text-zinc-400'
                      : syncState.status === 'synced'
                        ? 'text-emerald-300'
                        : syncState.status === 'failed'
                          ? 'text-rose-300'
                          : 'text-amber-300'
                  }`}
                >
                  {!authUser
                    ? 'Local Only'
                    : syncState.status === 'synced'
                      ? 'Synced'
                      : syncState.status === 'syncing'
                        ? 'Syncing…'
                        : syncState.status === 'offline'
                          ? 'Offline (Queued)'
                          : syncState.status === 'conflict'
                            ? 'Conflict Resolved'
                            : syncState.status === 'auth_required'
                              ? 'Verify Local Data'
                              : 'Sync Error'}
                </span>
              </div>
            </div>

            {storageStats.persistedStorage !== true && (
              <button
                type="button"
                onClick={() => void handlePersistClick()}
                disabled={requestingPersist}
                className="w-full min-h-[38px] px-3 rounded-lg border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-zinc-200 transition-colors"
              >
                {requestingPersist ? 'Requesting Persistence…' : 'Request Persistent Device Storage'}
              </button>
            )}

            {storageStats.storageError && (
              <p className="text-xs text-rose-300">{storageStats.storageError}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onExportWorkspace}
                className="flex-1 min-h-[40px] px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-zinc-200 inline-flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Export JSON
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 min-h-[40px] px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-zinc-200 inline-flex items-center justify-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                Import JSON
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleFileChange}
                className="hidden"
                aria-label="Import workspace JSON file"
              />
            </div>

            {importError && (
              <p role="alert" className="text-xs text-rose-300">
                {importError}
              </p>
            )}

            <button
              type="button"
              onClick={onRequestClearLocalData}
              className="w-full min-h-[40px] px-3 rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-xs font-medium text-rose-200 inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear All Local IndexedDB Data
            </button>
          </section>

          <hr className="border-white/[0.07]" />

          {/* Storage & Privacy */}
          <section className="space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Privacy & Editor</span>
            </div>

            <div className="flex items-center justify-between gap-3 py-1">
              <div>
                <span className="block text-xs text-zinc-200">Raw Audio Recording</span>
                <span className="block text-xs text-zinc-400">
                  Audio streams are never recorded or stored locally.
                </span>
              </div>
              <span className="text-xs font-mono text-emerald-300 shrink-0">Disabled</span>
            </div>

            <label className="flex items-center justify-between gap-3 cursor-pointer min-h-[36px]">
              <span className="text-xs text-zinc-200">Editor Line Numbers</span>
              <input
                type="checkbox"
                checked={appSettings.showLineNumbers}
                onChange={(e) => onUpdateAppSettings({ showLineNumbers: e.target.checked })}
                className="w-4 h-4 accent-emerald-500 rounded"
              />
            </label>

            <label className="flex items-center justify-between gap-3 cursor-pointer min-h-[36px]">
              <span className="text-xs text-zinc-200">Local Autosave</span>
              <input
                type="checkbox"
                checked={appSettings.autosaveEnabled}
                onChange={(e) => onUpdateAppSettings({ autosaveEnabled: e.target.checked })}
                className="w-4 h-4 accent-emerald-500 rounded"
              />
            </label>

            <p className="text-xs leading-relaxed text-zinc-400 pt-1">
              Permanent API keys are never stored in browser storage or client code.
            </p>
          </section>
        </div>
      </aside>
    </div>
  );
}
