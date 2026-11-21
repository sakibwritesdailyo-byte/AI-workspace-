import type { LiveCaption, MicPermissionState, VoiceSessionState } from '../types/workspace';

export type VoiceEvent =
  | { type: 'REQUEST_MIC' }
  | { type: 'MIC_READY' }
  | { type: 'CONNECTED' }
  | { type: 'THINKING_START' }
  | { type: 'SPEAKING_START' }
  | { type: 'SPEAKING_END' }
  | { type: 'BARGE_IN'; allowBargeIn: boolean }
  | { type: 'TOGGLE_MUTE' }
  | { type: 'TOGGLE_PAUSE' }
  | { type: 'TICK_SECOND' }
  | { type: 'APPEND_CAPTION'; speaker: 'user' | 'assistant'; text: string; timestamp: string }
  | { type: 'ERROR'; message: string; micPermission?: MicPermissionState }
  | { type: 'END_SESSION' };

export const INITIAL_VOICE_SESSION: VoiceSessionState = {
  status: 'disconnected',
  micPermission: 'unknown',
  micActive: false,
  isMuted: false,
  isPaused: false,
  elapsedSeconds: 0,
  captions: [],
  errorMessage: null,
  backendEndpoint: '/api/voice/session',
};

export function isVoiceSessionActive(state: VoiceSessionState): boolean {
  return (
    state.status === 'requesting_mic' ||
    state.status === 'connecting' ||
    state.status === 'listening' ||
    state.status === 'thinking' ||
    state.status === 'speaking' ||
    state.status === 'muted' ||
    state.status === 'paused'
  );
}

export function transitionVoiceSession(
  state: VoiceSessionState,
  event: VoiceEvent,
): VoiceSessionState {
  switch (event.type) {
    case 'REQUEST_MIC':
      return {
        ...state,
        status: 'requesting_mic',
        micActive: false,
        isMuted: false,
        isPaused: false,
        elapsedSeconds: 0,
        captions: [],
        errorMessage: null,
      };

    case 'MIC_READY':
      if (state.status !== 'requesting_mic') return state;
      return {
        ...state,
        status: 'connecting',
        micPermission: 'granted',
        micActive: false,
        errorMessage: null,
      };

    case 'CONNECTED':
      if (state.status !== 'connecting') return state;
      return {
        ...state,
        status: 'listening',
        micPermission: 'granted',
        micActive: true,
        isMuted: false,
        isPaused: false,
        errorMessage: null,
      };

    case 'THINKING_START':
      if (state.status !== 'listening') return state;
      return {
        ...state,
        status: 'thinking',
        micActive: !state.isMuted,
      };

    case 'SPEAKING_START':
      if (
        state.status !== 'listening' &&
        state.status !== 'thinking' &&
        state.status !== 'muted'
      ) {
        return state;
      }
      if (state.isPaused) return state;
      return {
        ...state,
        status: 'speaking',
        micActive: !state.isMuted,
      };

    case 'SPEAKING_END':
      if (state.status !== 'speaking') return state;
      return {
        ...state,
        status: state.isMuted ? 'muted' : 'listening',
        micActive: !state.isMuted && !state.isPaused,
      };

    case 'BARGE_IN':
      if (!event.allowBargeIn || state.status !== 'speaking') return state;
      return {
        ...state,
        status: state.isMuted ? 'muted' : 'listening',
        micActive: !state.isMuted && !state.isPaused,
      };

    case 'TOGGLE_MUTE': {
      if (
        state.status !== 'listening' &&
        state.status !== 'thinking' &&
        state.status !== 'speaking' &&
        state.status !== 'muted' &&
        state.status !== 'paused'
      ) {
        return state;
      }
      const nextMuted = !state.isMuted;
      if (state.isPaused) {
        return {
          ...state,
          isMuted: nextMuted,
          micActive: false,
        };
      }
      return {
        ...state,
        isMuted: nextMuted,
        status: nextMuted ? 'muted' : 'listening',
        micActive: !nextMuted,
      };
    }

    case 'TOGGLE_PAUSE': {
      if (
        state.status !== 'listening' &&
        state.status !== 'thinking' &&
        state.status !== 'speaking' &&
        state.status !== 'muted' &&
        state.status !== 'paused'
      ) {
        return state;
      }
      const nextPaused = !state.isPaused;
      if (nextPaused) {
        return {
          ...state,
          isPaused: true,
          status: 'paused',
          micActive: false,
        };
      }
      return {
        ...state,
        isPaused: false,
        status: state.isMuted ? 'muted' : 'listening',
        micActive: !state.isMuted,
      };
    }

    case 'TICK_SECOND':
      if (
        state.status === 'listening' ||
        state.status === 'thinking' ||
        state.status === 'speaking' ||
        state.status === 'muted'
      ) {
        return {
          ...state,
          elapsedSeconds: state.elapsedSeconds + 1,
        };
      }
      return state;

    case 'APPEND_CAPTION': {
      const trimmed = event.text.trim();
      if (!trimmed) return state;
      const nextCaption: LiveCaption = {
        id: `cap-${state.captions.length + 1}-${event.timestamp}`,
        speaker: event.speaker,
        text: trimmed,
        timestamp: event.timestamp,
      };
      return {
        ...state,
        captions: [...state.captions, nextCaption].slice(-24),
      };
    }

    case 'ERROR':
      return {
        ...state,
        status: 'error',
        micActive: false,
        isMuted: false,
        isPaused: false,
        micPermission: event.micPermission ?? state.micPermission,
        errorMessage: event.message,
      };

    case 'END_SESSION':
      return {
        ...INITIAL_VOICE_SESSION,
        micPermission: state.micPermission,
      };

    default:
      return state;
  }
}

export function formatSessionDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
