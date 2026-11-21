import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODEL_SETTINGS, DEFAULT_VOICE_SETTINGS } from '../data/mockWorkspaceData';
import { BrowserVoiceService } from './voiceService';

test('BrowserVoiceService checks offline status before requesting microphone permission (BUG-07)', async () => {
  let getUserMediaCalled = 0;

  const originalNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      onLine: false,
      mediaDevices: {
        getUserMedia: async () => {
          getUserMediaCalled += 1;
          throw new Error('Should not have called getUserMedia while offline');
        },
      },
    },
  });

  try {
    const service = new BrowserVoiceService();
    const result = await service.startSession({
      model: DEFAULT_MODEL_SETTINGS.liveModel,
      voiceSettings: DEFAULT_VOICE_SETTINGS,
      systemInstruction: 'Test',
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'offline');
      assert.equal(result.micPermission, 'unknown');
    }
    assert.equal(getUserMediaCalled, 0);
  } finally {
    if (originalNav) {
      Object.defineProperty(globalThis, 'navigator', originalNav);
    }
  }
});
