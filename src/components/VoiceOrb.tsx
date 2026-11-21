import {
  AlertCircle,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Play,
  Radio,
  Square,
  Volume2,
  Waves,
} from 'lucide-react';
import { formatSessionDuration, isVoiceSessionActive } from '../state/voiceStateMachine';
import type { VoiceLanguageMode, VoiceSessionState } from '../types/workspace';

interface VoiceOrbProps {
  session: VoiceSessionState;
  languageMode: VoiceLanguageMode;
  allowBargeIn: boolean;
  isOnline?: boolean;
  onStartSession: () => void;
  onEndSession: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onInterrupt: () => void;
}

const STATUS_LABELS: Record<VoiceSessionState['status'], string> = {
  disconnected: 'Disconnected · Ready to check mic & connect',
  requesting_mic: 'Requesting microphone permission…',
  connecting: 'Connecting to Gemini Live backend…',
  listening: 'Listening — speak in Bangla or English',
  thinking: 'Thinking…',
  speaking: 'Speaking response',
  muted: 'Microphone muted',
  paused: 'Session paused',
  error: 'Live voice session unavailable',
};

const MIC_PERMISSION_LABELS: Record<VoiceSessionState['micPermission'], string> = {
  unknown: 'Mic permission: Not requested yet',
  prompt: 'Mic permission: Browser prompt pending',
  granted: 'Mic permission: Granted',
  denied: 'Mic permission: Denied',
  unsupported: 'Mic permission: Unsupported in this browser',
};

const LANGUAGE_LABELS: Record<VoiceLanguageMode, string> = {
  bilingual: 'Bangla + English',
  en: 'English',
  bn: 'বাংলা (Bangla)',
};

export function VoiceOrb({
  session,
  languageMode,
  allowBargeIn,
  isOnline = true,
  onStartSession,
  onEndSession,
  onToggleMute,
  onTogglePause,
  onInterrupt,
}: VoiceOrbProps) {
  const active = isVoiceSessionActive(session);
  const connectedStreaming =
    session.status === 'listening' ||
    session.status === 'thinking' ||
    session.status === 'speaking' ||
    session.status === 'muted' ||
    session.status === 'paused';

  const latestCaption = session.captions[session.captions.length - 1];

  const handleOrbClick = () => {
    if (!active) {
      onStartSession();
      return;
    }
    if (session.status === 'speaking' && allowBargeIn) {
      onInterrupt();
      return;
    }
    if (connectedStreaming) {
      onToggleMute();
    }
  };

  return (
    <div className="flex flex-col items-center text-center w-full max-w-xl mx-auto">
      {/* Metadata row */}
      <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-zinc-200 font-medium">{LANGUAGE_LABELS[languageMode]}</span>
          <span aria-hidden="true">·</span>
          <span>{MIC_PERMISSION_LABELS[session.micPermission]}</span>
        </div>

        <div className="font-mono tabular-nums text-zinc-400">
          {session.micActive ? (
            <span className="text-emerald-300 font-sans font-medium">
              Mic Active · {formatSessionDuration(session.elapsedSeconds)}
            </span>
          ) : (
            <span>{connectedStreaming ? formatSessionDuration(session.elapsedSeconds) : 'Offline'}</span>
          )}
        </div>
      </div>

      {/* Large Voice Orb */}
      <div className="relative my-2 flex items-center justify-center">
        {session.status === 'listening' && (
          <span
            aria-hidden="true"
            className="orb-pulse-ring absolute w-48 h-48 rounded-full border border-emerald-400/35 pointer-events-none"
          />
        )}
        {session.status === 'speaking' && (
          <span
            aria-hidden="true"
            className="orb-pulse-ring absolute w-52 h-52 rounded-full border-2 border-emerald-400/50 pointer-events-none"
          />
        )}

        <button
          type="button"
          onClick={handleOrbClick}
          disabled={session.status === 'requesting_mic' || session.status === 'connecting'}
          aria-label={
            !active
              ? 'Start voice session'
              : session.status === 'speaking' && allowBargeIn
                ? 'Interrupt response'
                : session.isMuted
                  ? 'Unmute microphone'
                  : 'Mute microphone'
          }
          data-voice-status={session.status}
          className={`relative w-36 h-36 sm:w-44 sm:h-44 rounded-full flex items-center justify-center transition-transform duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-4 focus-visible:ring-offset-[#090B0E] ${
            session.status === 'speaking'
              ? 'bg-gradient-to-br from-emerald-400/30 via-emerald-500/20 to-[#0B1210] border border-emerald-400/60 shadow-[0_0_56px_-14px_rgba(16,185,129,0.55)]'
              : session.status === 'listening'
                ? 'bg-gradient-to-br from-emerald-500/25 via-emerald-600/15 to-[#0B1110] border border-emerald-400/50 shadow-[0_0_44px_-14px_rgba(16,185,129,0.45)]'
                : session.status === 'thinking' || session.status === 'connecting' || session.status === 'requesting_mic'
                  ? 'bg-gradient-to-br from-emerald-500/12 to-[#0D1117] border border-emerald-500/35'
                  : session.status === 'muted' || session.status === 'paused'
                    ? 'bg-[#141920] border border-amber-400/40'
                    : session.status === 'error'
                      ? 'bg-[#191215] border border-rose-500/45'
                      : 'bg-gradient-to-br from-[#161E26] via-[#10151B] to-[#0B0E12] border border-white/15 hover:border-emerald-400/45'
          }`}
        >
          <span
            aria-hidden="true"
            className={`orb-breathe absolute inset-4 rounded-full border ${
              session.micActive
                ? 'border-emerald-400/35 bg-emerald-500/10'
                : 'border-white/[0.08] bg-white/[0.02]'
            }`}
          />
          <span
            aria-hidden="true"
            className="orb-spin-slow absolute inset-7 rounded-full border border-dashed border-emerald-400/20"
          />

          <span className="relative z-10 flex flex-col items-center gap-1.5">
            {session.status === 'speaking' ? (
              <Volume2 className="w-9 h-9 text-emerald-300" />
            ) : session.status === 'listening' ? (
              <Waves className="w-9 h-9 text-emerald-300" />
            ) : session.status === 'thinking' || session.status === 'requesting_mic' ? (
              <Loader2 className="w-9 h-9 text-emerald-300 animate-spin" />
            ) : session.status === 'connecting' ? (
              <Radio className="w-9 h-9 text-emerald-300 animate-pulse" />
            ) : session.status === 'muted' ? (
              <MicOff className="w-9 h-9 text-amber-300" />
            ) : session.status === 'paused' ? (
              <Pause className="w-9 h-9 text-amber-300" />
            ) : session.status === 'error' ? (
              <AlertCircle className="w-9 h-9 text-rose-400" />
            ) : (
              <Mic className="w-9 h-9 text-emerald-400" />
            )}
          </span>
        </button>
      </div>

      {/* State Heading */}
      <p className="mt-5 text-base font-medium text-zinc-100">
        {session.status === 'disconnected' && !isOnline
          ? 'Offline · Connect to the internet for live voice'
          : STATUS_LABELS[session.status]}
      </p>

      {/* Honest error or live caption surface */}
      {session.status === 'error' && session.errorMessage ? (
        <div
          role="alert"
          className="mt-4 w-full rounded-xl border border-rose-500/30 bg-rose-950/25 px-4 py-3 text-left text-xs leading-relaxed text-rose-200 flex items-start gap-2.5"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-rose-100">Voice session could not start</p>
            <p className="mt-1 text-rose-200/90">{session.errorMessage}</p>
          </div>
        </div>
      ) : (
        <div
          aria-live="polite"
          className="mt-4 w-full min-h-[56px] rounded-xl border border-white/[0.08] bg-[#0D1015] px-4 py-3 flex items-center justify-center"
        >
          {latestCaption ? (
            <p className="text-sm text-zinc-200 text-left w-full leading-relaxed">
              <span className="font-medium text-emerald-400 mr-2">
                {latestCaption.speaker === 'user' ? 'You:' : 'Studio:'}
              </span>
              {latestCaption.text}
            </p>
          ) : (
            <p className="text-xs text-zinc-400">
              {connectedStreaming
                ? 'Live captions will stream here while the session is active.'
                : !isOnline
                  ? 'Offline · Microphone permission is not requested while offline.'
                  : `Endpoint: ${session.backendEndpoint} · Mic permission is checked before connecting.`}
            </p>
          )}
        </div>
      )}

      {/* Primary Voice Controls */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5 w-full">
        {!connectedStreaming ? (
          <button
            type="button"
            onClick={onStartSession}
            disabled={session.status === 'requesting_mic' || session.status === 'connecting'}
            className="min-h-[46px] px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-[#052317] text-sm font-semibold inline-flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <Mic className="w-4 h-4" />
            {session.status === 'requesting_mic'
              ? 'Checking Microphone…'
              : session.status === 'connecting'
                ? 'Connecting…'
                : session.status === 'error'
                  ? 'Retry Voice Connection'
                  : 'Start Voice Session'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggleMute}
              className={`min-h-[44px] px-4 rounded-xl text-sm font-medium inline-flex items-center gap-2 border transition-colors ${
                session.isMuted
                  ? 'bg-amber-500/15 text-amber-200 border-amber-500/35 hover:bg-amber-500/25'
                  : 'bg-[#141920] text-zinc-200 border-white/[0.1] hover:bg-white/[0.08]'
              }`}
            >
              {session.isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              {session.isMuted ? 'Unmute' : 'Mute'}
            </button>

            <button
              type="button"
              onClick={onTogglePause}
              className={`min-h-[44px] px-4 rounded-xl text-sm font-medium inline-flex items-center gap-2 border transition-colors ${
                session.isPaused
                  ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/35 hover:bg-emerald-500/25'
                  : 'bg-[#141920] text-zinc-200 border-white/[0.1] hover:bg-white/[0.08]'
              }`}
            >
              {session.isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              {session.isPaused ? 'Resume' : 'Pause'}
            </button>

            {session.status === 'speaking' && allowBargeIn && (
              <button
                type="button"
                onClick={onInterrupt}
                className="min-h-[44px] px-4 rounded-xl text-sm font-medium bg-emerald-500/15 text-emerald-200 border border-emerald-500/30 hover:bg-emerald-500/25 inline-flex items-center gap-2 transition-colors"
              >
                <Waves className="w-4 h-4" />
                Interrupt
              </button>
            )}

            <button
              type="button"
              onClick={onEndSession}
              className="min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-rose-500/15 text-rose-200 border border-rose-500/30 hover:bg-rose-500/25 inline-flex items-center gap-2 transition-colors"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              End Session
            </button>
          </>
        )}
      </div>
    </div>
  );
}
