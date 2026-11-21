import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_VOICE_SESSION,
  formatSessionDuration,
  isVoiceSessionActive,
  transitionVoiceSession,
} from './voiceStateMachine';

test('initial voice state is disconnected with micActive false', () => {
  assert.equal(INITIAL_VOICE_SESSION.status, 'disconnected');
  assert.equal(INITIAL_VOICE_SESSION.micActive, false);
  assert.equal(isVoiceSessionActive(INITIAL_VOICE_SESSION), false);
});

test('voice session never fakes listening when backend is unavailable or permission denied', () => {
  let state = transitionVoiceSession(INITIAL_VOICE_SESSION, { type: 'REQUEST_MIC' });
  assert.equal(state.status, 'requesting_mic');
  assert.equal(state.micActive, false);

  state = transitionVoiceSession(state, {
    type: 'ERROR',
    message: 'Live voice backend unavailable',
    micPermission: 'granted',
  });
  assert.equal(state.status, 'error');
  assert.equal(state.micActive, false);
  assert.equal(state.micPermission, 'granted');
  assert.equal(isVoiceSessionActive(state), false);
});

test('connected voice session supports thinking, speaking, barge-in, mute, and pause invariants', () => {
  let state = transitionVoiceSession(INITIAL_VOICE_SESSION, { type: 'REQUEST_MIC' });
  state = transitionVoiceSession(state, { type: 'MIC_READY' });
  assert.equal(state.status, 'connecting');
  assert.equal(state.micActive, false);

  state = transitionVoiceSession(state, { type: 'CONNECTED' });
  assert.equal(state.status, 'listening');
  assert.equal(state.micActive, true);

  state = transitionVoiceSession(state, { type: 'THINKING_START' });
  assert.equal(state.status, 'thinking');

  state = transitionVoiceSession(state, { type: 'SPEAKING_START' });
  assert.equal(state.status, 'speaking');

  state = transitionVoiceSession(state, { type: 'BARGE_IN', allowBargeIn: true });
  assert.equal(state.status, 'listening');

  state = transitionVoiceSession(state, { type: 'TOGGLE_MUTE' });
  assert.equal(state.status, 'muted');
  assert.equal(state.micActive, false);

  state = transitionVoiceSession(state, { type: 'TOGGLE_PAUSE' });
  assert.equal(state.status, 'paused');
  assert.equal(state.micActive, false);

  state = transitionVoiceSession(state, { type: 'TOGGLE_PAUSE' });
  assert.equal(state.status, 'muted');

  state = transitionVoiceSession(state, { type: 'END_SESSION' });
  assert.equal(state.status, 'disconnected');
  assert.equal(state.micActive, false);
  assert.equal(formatSessionDuration(75), '01:15');
});
