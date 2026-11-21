import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMobileInputDiagnosis,
  formatDiagnosticReport,
  type DiagnosticEnvironment,
  type InputDiagnosticEvent,
} from './inputDiagnostics';

function makeEvent(
  overrides: Partial<InputDiagnosticEvent> & { seq: number; type: string },
): InputDiagnosticEvent {
  return {
    time: '10:00:00.000',
    timestampMs: 1000 + overrides.seq * 20,
    isTrusted: true,
    target: 'TEXTAREA[aria-label="Message input"]',
    activeElement: 'BODY',
    textareaDisabled: false,
    textareaReadOnly: false,
    textareaRect: { top: 720, left: 60, width: 260, height: 44, bottom: 764 },
    textareaVisible: true,
    textareaConnected: true,
    windowInnerWidth: 390,
    windowInnerHeight: 844,
    visualViewportWidth: 390,
    visualViewportHeight: 844,
    appKeyboardOpen: false,
    ...overrides,
  };
}

const baseEnv: DiagnosticEnvironment = {
  inIframe: false,
  isStandalonePwa: true,
  isTouchDevice: true,
  isAndroidUserAgent: true,
  viewportMetaContent: 'width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content',
  serviceWorkerControlled: true,
  serviceWorkerScriptUrl: '/sw.js',
  baselineHeight: 844,
  hitTestAtTextareaCenter: 'TEXTAREA[aria-label="Message input"]',
};

test('classifyMobileInputDiagnosis distinguishes waiting and A/B/C/D/E/ok failure modes', () => {
  assert.equal(classifyMobileInputDiagnosis([], baseEnv).code, 'waiting');

  // Case A: Hit-test blocked by overlay
  assert.equal(
    classifyMobileInputDiagnosis([], {
      ...baseEnv,
      hitTestAtTextareaCenter: 'DIV[role="dialog"]',
    }).code,
    'A_tap_never_reaches_textarea',
  );

  // Case A: Tap hits non-textarea element
  assert.equal(
    classifyMobileInputDiagnosis(
      [makeEvent({ seq: 1, type: 'pointerdown', target: 'DIV' })],
      baseEnv,
    ).code,
    'A_tap_never_reaches_textarea',
  );

  // Case B: Tap reaches textarea but focusin never fires
  assert.equal(
    classifyMobileInputDiagnosis(
      [
        makeEvent({ seq: 1, type: 'pointerdown' }),
        makeEvent({ seq: 2, type: 'click' }),
      ],
      baseEnv,
    ).code,
    'B_tap_reaches_no_focus',
  );

  // Case C: Focus occurs then lost immediately within 400ms
  const caseC = classifyMobileInputDiagnosis(
    [
      makeEvent({ seq: 1, type: 'pointerdown', timestampMs: 1000 }),
      makeEvent({
        seq: 2,
        type: 'focusin',
        timestampMs: 1020,
        activeElement: 'TEXTAREA[aria-label="Message input"]',
      }),
      makeEvent({
        seq: 3,
        type: 'focusout',
        timestampMs: 1080,
        activeElement: 'BODY',
      }),
    ],
    baseEnv,
  );
  assert.equal(caseC.code, 'C_focus_lost_immediately');
  assert.equal(caseC.focusLostImmediately, true);

  // Case D: Focus remains on textarea, but Android keyboard did not shrink viewport
  const caseD = classifyMobileInputDiagnosis(
    [
      makeEvent({ seq: 1, type: 'pointerdown', timestampMs: 1000 }),
      makeEvent({
        seq: 2,
        type: 'focusin',
        timestampMs: 1020,
        activeElement: 'TEXTAREA[aria-label="Message input"]',
      }),
      makeEvent({
        seq: 3,
        type: 'click',
        timestampMs: 1030,
        activeElement: 'TEXTAREA[aria-label="Message input"]',
      }),
    ],
    baseEnv,
  );
  assert.equal(caseD.code, 'D_focus_remains_no_keyboard');
  assert.equal(caseD.focusLostImmediately, false);

  // Case E: Viewport shrinks but textarea sits below visible height or appKeyboardOpen stays false
  assert.equal(
    classifyMobileInputDiagnosis(
      [
        makeEvent({
          seq: 1,
          type: 'focusin',
          activeElement: 'TEXTAREA[aria-label="Message input"]',
        }),
        makeEvent({
          seq: 2,
          type: 'visualViewport.resize',
          activeElement: 'TEXTAREA[aria-label="Message input"]',
          visualViewportHeight: 480,
          appKeyboardOpen: true,
          textareaRect: { top: 720, left: 60, width: 260, height: 44, bottom: 764 },
        }),
      ],
      baseEnv,
    ).code,
    'E_keyboard_opens_layout_unresponsive',
  );

  // Healthy OK case
  const okSummary = classifyMobileInputDiagnosis(
    [
      makeEvent({
        seq: 1,
        type: 'focusin',
        activeElement: 'TEXTAREA[aria-label="Message input"]',
      }),
      makeEvent({
        seq: 2,
        type: 'visualViewport.resize',
        activeElement: 'TEXTAREA[aria-label="Message input"]',
        visualViewportHeight: 480,
        appKeyboardOpen: true,
        textareaRect: { top: 420, left: 60, width: 260, height: 44, bottom: 464 },
      }),
    ],
    baseEnv,
  );
  assert.equal(okSummary.code, 'ok');

  const report = formatDiagnosticReport(okSummary, baseEnv, [
    makeEvent({ seq: 1, type: 'focusin', activeElement: 'TEXTAREA[aria-label="Message input"]' }),
  ]);
  assert.match(report, /Diagnosis: ok/);
  assert.match(report, /Standalone PWA: true/);
});
