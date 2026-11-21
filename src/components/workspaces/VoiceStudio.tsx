import { MessageSquare, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import type {
  ModelSettings,
  VoiceLanguageMode,
  VoiceSessionState,
  VoiceSettings,
} from '../../types/workspace';
import { VoiceOrb } from '../VoiceOrb';

interface VoiceStudioProps {
  session: VoiceSessionState;
  voiceSettings: VoiceSettings;
  modelSettings: ModelSettings;
  onStartSession: () => void;
  onEndSession: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onInterrupt: () => void;
  onUpdateVoiceSettings: (patch: Partial<VoiceSettings>) => void;
  onBackToChat: () => void;
}

const LANGUAGE_CHOICES: { id: VoiceLanguageMode; label: string }[] = [
  { id: 'bilingual', label: 'Bangla + English' },
  { id: 'en', label: 'English' },
  { id: 'bn', label: 'বাংলা' },
];

export function VoiceStudio({
  session,
  voiceSettings,
  modelSettings,
  onStartSession,
  onEndSession,
  onToggleMute,
  onTogglePause,
  onInterrupt,
  onUpdateVoiceSettings,
  onBackToChat,
}: VoiceStudioProps) {
  const isOnline = useOnlineStatus();

  return (
    <div className="min-h-full max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col justify-between gap-8">
      {/* Minimal Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-zinc-100">Voice Studio</h1>
          <p className="text-xs text-zinc-400 mt-0.5 font-mono truncate">{modelSettings.liveModel}</p>
        </div>

        <button
          type="button"
          onClick={onBackToChat}
          className="min-h-[40px] px-3 rounded-lg border border-white/[0.1] text-xs font-medium text-zinc-200 hover:text-zinc-100 hover:bg-white/[0.06] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Text Chat</span>
        </button>
      </div>

      {/* Central Dedicated Voice Orb */}
      <div className="py-2">
        <VoiceOrb
          session={session}
          languageMode={voiceSettings.languageMode}
          allowBargeIn={voiceSettings.allowBargeIn}
          isOnline={isOnline}
          onStartSession={onStartSession}
          onEndSession={onEndSession}
          onToggleMute={onToggleMute}
          onTogglePause={onTogglePause}
          onInterrupt={onInterrupt}
        />
      </div>

      {/* Inline Voice Controls & Honest Privacy / Backend Summary */}
      <div className="border-t border-white/[0.08] pt-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-medium text-zinc-200 block">Spoken Language</span>
            <span className="text-xs text-zinc-400">Select Bangla, English, or bilingual mode</span>
          </div>

          <div
            role="group"
            aria-label="Spoken language selection"
            className="inline-flex items-center p-1 rounded-xl bg-[#10141A] border border-white/[0.08]"
          >
            {LANGUAGE_CHOICES.map((lang) => {
              const active = voiceSettings.languageMode === lang.id;
              return (
                <button
                  key={lang.id}
                  type="button"
                  onClick={() => onUpdateVoiceSettings({ languageMode: lang.id })}
                  aria-pressed={active}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-medium transition-colors ${
                    active
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'text-zinc-300 hover:text-zinc-100'
                  }`}
                >
                  {lang.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-300">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Raw audio recording: <strong className="text-zinc-100 font-medium">Disabled</strong> ·
                Transcript saving:{' '}
                <strong className="text-zinc-100 font-medium">
                  {voiceSettings.saveTranscripts ? 'Enabled' : 'Disabled'}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-2 text-zinc-400">
              {isOnline ? (
                <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              )}
              <span>
                {isOnline
                  ? `Online · Gemini Live endpoint ${session.backendEndpoint} (Phase 4)`
                  : 'Offline · Live voice sessions require an internet connection'}
              </span>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 cursor-pointer min-h-[36px]">
            <input
              type="checkbox"
              checked={voiceSettings.allowBargeIn}
              onChange={(e) => onUpdateVoiceSettings({ allowBargeIn: e.target.checked })}
              className="w-4 h-4 accent-emerald-500 rounded"
            />
            <span className="text-zinc-200">Allow interruption</span>
          </label>
        </div>
      </div>
    </div>
  );
}
