import type { MicPermissionState, VoiceSettings } from '../types/workspace';

export type VoiceStartFailureCode =
  | 'offline'
  | 'mic_unsupported'
  | 'mic_denied'
  | 'mic_not_found'
  | 'mic_error'
  | 'backend_unavailable';

export type VoiceStartResult =
  | {
      ok: true;
      micPermission: 'granted';
      ephemeralToken: string;
      expiresAt: string;
    }
  | {
      ok: false;
      code: VoiceStartFailureCode;
      micPermission: MicPermissionState;
      message: string;
    };

export interface EphemeralVoiceSessionConfig {
  model: string;
  voiceSettings: VoiceSettings;
  systemInstruction: string;
}

/**
 * Provider-independent voice service boundary.
 * Phase 4 will attach the Gemini Live WebSocket audio transport behind this interface
 * using short-lived ephemeral tokens from `/api/voice/session`.
 */
export interface VoiceService {
  readonly backendEndpoint: string;
  checkMicrophoneSupport(): boolean;
  startSession(config: EphemeralVoiceSessionConfig): Promise<VoiceStartResult>;
  stopSession(): void;
  setMuted(muted: boolean): void;
  interrupt(): void;
}

export class BrowserVoiceService implements VoiceService {
  readonly backendEndpoint = '/api/voice/session';
  private activeStream: MediaStream | null = null;

  checkMicrophoneSupport(): boolean {
    return Boolean(
      typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function',
    );
  }

  async startSession(config: EphemeralVoiceSessionConfig): Promise<VoiceStartResult> {
    // 1. Offline check BEFORE requesting microphone permission (BUG-07 fix)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        ok: false,
        code: 'offline',
        micPermission: 'unknown',
        message:
          'You are currently offline. Real-time Gemini Live voice sessions require an internet connection, so microphone permission was not requested.',
      };
    }

    if (!this.checkMicrophoneSupport()) {
      return {
        ok: false,
        code: 'mic_unsupported',
        micPermission: 'unsupported',
        message:
          'Microphone capture (MediaDevices.getUserMedia) is not supported in this browser context.',
      };
    }

    // 2. Request microphone permission only when online and hardware API is supported
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        return {
          ok: false,
          code: 'mic_denied',
          micPermission: 'denied',
          message:
            'Microphone permission was denied. Enable microphone access in your browser settings to start a voice session.',
        };
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return {
          ok: false,
          code: 'mic_not_found',
          micPermission: 'denied',
          message: 'No microphone hardware was detected on this device.',
        };
      }
      return {
        ok: false,
        code: 'mic_error',
        micPermission: 'unknown',
        message:
          err instanceof Error
            ? `Microphone initialization failed: ${err.message}`
            : 'Unable to access the device microphone.',
      };
    }

    // Release test track immediately until Phase 4 Live transport actually opens
    stream.getTracks().forEach((track) => track.stop());
    this.activeStream = null;

    // 3. Request short-lived ephemeral token from backend (no permanent API keys in frontend)
    try {
      const response = await fetch(this.backendEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          voiceName: config.voiceSettings.voiceName,
          languageMode: config.voiceSettings.languageMode,
          allowBargeIn: config.voiceSettings.allowBargeIn,
          systemInstruction: config.systemInstruction,
        }),
      });

      if (!response.ok) {
        return {
          ok: false,
          code: 'backend_unavailable',
          micPermission: 'granted',
          message: `Microphone verified, but Gemini Live token endpoint (${this.backendEndpoint}) returned HTTP ${response.status}. Real-time voice streaming connects in Phase 4.`,
        };
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return {
          ok: false,
          code: 'backend_unavailable',
          micPermission: 'granted',
          message: `Microphone verified, but no Gemini Live token handler is mounted at ${this.backendEndpoint} yet (Phase 4).`,
        };
      }

      const payload = (await response.json()) as {
        ephemeralToken?: string;
        expiresAt?: string;
      };

      if (!payload.ephemeralToken) {
        return {
          ok: false,
          code: 'backend_unavailable',
          micPermission: 'granted',
          message: `Live voice endpoint (${this.backendEndpoint}) did not return an ephemeral session token.`,
        };
      }

      return {
        ok: true,
        micPermission: 'granted',
        ephemeralToken: payload.ephemeralToken,
        expiresAt: payload.expiresAt ?? '',
      };
    } catch {
      return {
        ok: false,
        code: 'backend_unavailable',
        micPermission: 'granted',
        message: `Microphone access granted, but the Gemini Live backend (${this.backendEndpoint}) is not reachable yet. Phase 4 adds ephemeral token minting and live audio streaming.`,
      };
    }
  }

  stopSession(): void {
    if (this.activeStream) {
      this.activeStream.getTracks().forEach((track) => track.stop());
      this.activeStream = null;
    }
  }

  setMuted(muted: boolean): void {
    if (!this.activeStream) return;
    this.activeStream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  interrupt(): void {
    // Phase 4: Send barge-in / client interruption frame on active Gemini Live WebSocket
  }
}

export const voiceService: VoiceService = new BrowserVoiceService();
