export type DiagnosticClassification =
  | 'waiting'
  | 'A_tap_never_reaches_textarea'
  | 'B_tap_reaches_no_focus'
  | 'C_focus_lost_immediately'
  | 'D_focus_remains_no_keyboard'
  | 'E_keyboard_opens_layout_unresponsive'
  | 'ok';

export interface TextareaRectSnapshot {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
}

export interface InputDiagnosticEvent {
  seq: number;
  time: string;
  timestampMs: number;
  type: string;
  isTrusted: boolean | null;
  target: string;
  activeElement: string;
  textareaDisabled: boolean | null;
  textareaReadOnly: boolean | null;
  textareaRect: TextareaRectSnapshot | null;
  textareaVisible: boolean | null;
  textareaConnected: boolean | null;
  windowInnerWidth: number;
  windowInnerHeight: number;
  visualViewportWidth: number | null;
  visualViewportHeight: number | null;
  appKeyboardOpen: boolean;
  note?: string;
}

export interface DiagnosticEnvironment {
  inIframe: boolean;
  isStandalonePwa: boolean;
  isTouchDevice: boolean;
  isAndroidUserAgent: boolean;
  viewportMetaContent: string;
  serviceWorkerControlled: boolean;
  serviceWorkerScriptUrl: string | null;
  baselineHeight: number;
  hitTestAtTextareaCenter: string | null;
}

export interface DiagnosticSummary {
  code: DiagnosticClassification;
  headline: string;
  detail: string;
  focusLostImmediately: boolean;
}

const KEYBOARD_SHRINK_THRESHOLD_PX = 120;
const IMMEDIATE_FOCUS_LOSS_MS = 400;

export function describeElement(el: Element | null | undefined): string {
  if (!el) return 'null';
  const tag = el.tagName;
  const id = el.id ? `#${el.id}` : '';
  const aria = el.getAttribute('aria-label');
  if (aria) return `${tag}${id}[aria-label="${aria}"]`;
  const role = el.getAttribute('role');
  if (role) return `${tag}${id}[role="${role}"]`;
  return `${tag}${id}`;
}

export function isTextareaTargetLabel(label: string): boolean {
  return label.startsWith('TEXTAREA') && label.includes('Message input');
}

export function classifyMobileInputDiagnosis(
  events: InputDiagnosticEvent[],
  env: Pick<DiagnosticEnvironment, 'baselineHeight' | 'hitTestAtTextareaCenter'>,
): DiagnosticSummary {
  if (env.hitTestAtTextareaCenter && !isTextareaTargetLabel(env.hitTestAtTextareaCenter)) {
    return {
      code: 'A_tap_never_reaches_textarea',
      headline: 'A. Tap blocked — another element covers the textarea',
      detail: `Hit-test at textarea center resolved to ${env.hitTestAtTextareaCenter} instead of the native TEXTAREA.`,
      focusLostImmediately: false,
    };
  }

  const tapEvents = events.filter(
    (e) =>
      e.type === 'pointerdown' ||
      e.type === 'touchstart' ||
      e.type === 'pointerup' ||
      e.type === 'touchend' ||
      e.type === 'click',
  );
  const textareaTaps = tapEvents.filter((e) => isTextareaTargetLabel(e.target));
  const textareaFocusIn = events.filter(
    (e) => e.type === 'focusin' && isTextareaTargetLabel(e.target),
  );

  if (tapEvents.length === 0 && textareaFocusIn.length === 0) {
    return {
      code: 'waiting',
      headline: 'Waiting for user tap on Message input',
      detail: 'Tap directly inside the Chat Message input box to capture pointer, touch, focus, and viewport events.',
      focusLostImmediately: false,
    };
  }

  if (tapEvents.length > 0 && textareaTaps.length === 0 && textareaFocusIn.length === 0) {
    const lastTap = tapEvents[tapEvents.length - 1];
    return {
      code: 'A_tap_never_reaches_textarea',
      headline: 'A. Tap never reached the textarea',
      detail: `Last ${lastTap.type} hit ${lastTap.target} (isTrusted=${String(lastTap.isTrusted)}) instead of the textarea.`,
      focusLostImmediately: false,
    };
  }

  if (textareaTaps.length > 0 && textareaFocusIn.length === 0) {
    const lastTextareaTap = textareaTaps[textareaTaps.length - 1];
    return {
      code: 'B_tap_reaches_no_focus',
      headline: 'B. Tap reached textarea, but focus did not occur',
      detail: `Received ${lastTextareaTap.type} (isTrusted=${String(lastTextareaTap.isTrusted)}) on textarea, yet no focusin fired and activeElement stayed ${lastTextareaTap.activeElement}.`,
      focusLostImmediately: false,
    };
  }

  // Check if the most recent focusin on textarea was lost immediately
  const lastFocusIn = textareaFocusIn[textareaFocusIn.length - 1];
  const lastFocusIndex = events.lastIndexOf(lastFocusIn);
  const afterFocusEvents = events.slice(lastFocusIndex + 1);

  const immediateLoss = afterFocusEvents.find(
    (e) =>
      (e.type === 'focusout' ||
        e.type === 'blur' ||
        e.type === 'textarea.unmount' ||
        (e.type === 'focusin' && !isTextareaTargetLabel(e.target))) &&
      e.timestampMs - lastFocusIn.timestampMs <= IMMEDIATE_FOCUS_LOSS_MS,
  );

  if (immediateLoss) {
    return {
      code: 'C_focus_lost_immediately',
      headline: 'C. Focus occurred on textarea, then was lost immediately',
      detail: `focusin fired at ${lastFocusIn.time}, followed ${immediateLoss.timestampMs - lastFocusIn.timestampMs}ms later by ${immediateLoss.type} (activeElement=${immediateLoss.activeElement}).`,
      focusLostImmediately: true,
    };
  }

  // Also check if focus left without an immediate timer (e.g. user tapped away vs still focused)
  const latest = events[events.length - 1];
  const stillFocused = isTextareaTargetLabel(latest.activeElement);
  const laterLoss = afterFocusEvents.find(
    (e) =>
      e.type === 'focusout' ||
      e.type === 'blur' ||
      e.type === 'textarea.unmount',
  );

  if (!stillFocused && laterLoss) {
    return {
      code: 'waiting',
      headline: 'Textarea blurred after focus',
      detail: `Textarea held focus for ${laterLoss.timestampMs - lastFocusIn.timestampMs}ms before ${laterLoss.type}. Tap the textarea again to inspect an active session.`,
      focusLostImmediately: false,
    };
  }

  const currentVisibleHeight =
    latest.visualViewportHeight ?? latest.windowInnerHeight;
  const baseline = Math.max(env.baselineHeight, latest.windowInnerHeight);
  const shrinkPx = baseline - currentVisibleHeight;

  if (shrinkPx < KEYBOARD_SHRINK_THRESHOLD_PX && !latest.appKeyboardOpen) {
    return {
      code: 'D_focus_remains_no_keyboard',
      headline: 'D. Focus remained on textarea, but keyboard / viewport shrink did not occur',
      detail: `Textarea is activeElement, connected=${String(latest.textareaConnected)}, visible=${String(latest.textareaVisible)}, disabled=${String(latest.textareaDisabled)}, readOnly=${String(latest.textareaReadOnly)}. Viewport height stayed ${currentVisibleHeight}px (baseline ${baseline}px, delta ${shrinkPx}px). On a physical Android phone this means Android OS did not raise the soft keyboard; on a desktop browser without a virtual keyboard this is expected.`,
      focusLostImmediately: false,
    };
  }

  const rectBottom = latest.textareaRect?.bottom ?? 0;
  if (!latest.appKeyboardOpen || rectBottom > currentVisibleHeight + 2) {
    return {
      code: 'E_keyboard_opens_layout_unresponsive',
      headline: 'E. Viewport shrank, but layout failed to keep textarea above keyboard',
      detail: `Visible height shrank by ${shrinkPx}px to ${currentVisibleHeight}px, appKeyboardOpen=${String(latest.appKeyboardOpen)}, textarea bottom=${Math.round(rectBottom)}px.`,
      focusLostImmediately: false,
    };
  }

  return {
    code: 'ok',
    headline: 'Healthy: tap -> focus -> viewport resize -> composer visible',
    detail: `Trusted focus maintained, viewport shrank ${shrinkPx}px to ${currentVisibleHeight}px, and textarea bottom (${Math.round(rectBottom)}px) sits cleanly inside visible viewport.`,
    focusLostImmediately: false,
  };
}

export function formatDiagnosticReport(
  summary: DiagnosticSummary,
  env: DiagnosticEnvironment,
  events: InputDiagnosticEvent[],
): string {
  const lines: string[] = [
    '=== Personal AI Studio — Mobile Input Diagnostic Report ===',
    `Diagnosis: ${summary.code} | ${summary.headline}`,
    `Detail: ${summary.detail}`,
    `Focus Lost Immediately: ${String(summary.focusLostImmediately)}`,
    '--- Environment ---',
    `Standalone PWA: ${String(env.isStandalonePwa)} | In Iframe (Preview): ${String(env.inIframe)}`,
    `Android UA: ${String(env.isAndroidUserAgent)} | Touch Support: ${String(env.isTouchDevice)}`,
    `SW Controlled: ${String(env.serviceWorkerControlled)}${env.serviceWorkerScriptUrl ? ` (${env.serviceWorkerScriptUrl})` : ''}`,
    `Viewport Meta: ${env.viewportMetaContent || 'missing'}`,
    `Baseline Height: ${env.baselineHeight}px | Center Hit-Test: ${env.hitTestAtTextareaCenter ?? 'unknown'}`,
    `--- Events (${events.length}) ---`,
  ];

  for (const ev of events) {
    const rectStr = ev.textareaRect
      ? `rect(${Math.round(ev.textareaRect.top)}..${Math.round(ev.textareaRect.bottom)}, ${Math.round(ev.textareaRect.width)}x${Math.round(ev.textareaRect.height)})`
      : 'rect(null)';
    lines.push(
      `#${ev.seq} [${ev.time}] ${ev.type} trusted=${String(ev.isTrusted)} target=${ev.target} active=${ev.activeElement} dis=${String(ev.textareaDisabled)} ro=${String(ev.textareaReadOnly)} vis=${String(ev.textareaVisible)} conn=${String(ev.textareaConnected)} win=${ev.windowInnerWidth}x${ev.windowInnerHeight} vv=${ev.visualViewportWidth ?? '-'}x${ev.visualViewportHeight ?? '-'} kbOpen=${String(ev.appKeyboardOpen)} ${rectStr}${ev.note ? ` note="${ev.note}"` : ''}`,
    );
  }

  return lines.join('\n');
}
