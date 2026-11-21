import { useState } from 'react';
import { Check, Copy, RotateCcw, X } from 'lucide-react';
import {
  formatDiagnosticReport,
  type DiagnosticEnvironment,
  type DiagnosticSummary,
  type InputDiagnosticEvent,
} from '../utils/inputDiagnostics';

interface InputDiagnosticsPanelProps {
  summary: DiagnosticSummary;
  env: DiagnosticEnvironment;
  events: InputDiagnosticEvent[];
  currentState: {
    activeWorkspace: string;
    keyboardOpen: boolean;
    viewportHeight: number | null;
    chatSending: boolean;
    draftLength: number;
  };
  onClear: () => void;
  onDisable: () => void;
}

const BADGE_CLASSES: Record<DiagnosticSummary['code'], string> = {
  waiting: 'bg-zinc-500/15 text-zinc-200 border-white/15',
  A_tap_never_reaches_textarea: 'bg-rose-500/15 text-rose-200 border-rose-500/35',
  B_tap_reaches_no_focus: 'bg-rose-500/15 text-rose-200 border-rose-500/35',
  C_focus_lost_immediately: 'bg-amber-500/15 text-amber-200 border-amber-500/35',
  D_focus_remains_no_keyboard: 'bg-amber-500/15 text-amber-200 border-amber-500/35',
  E_keyboard_opens_layout_unresponsive: 'bg-rose-500/15 text-rose-200 border-rose-500/35',
  ok: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/35',
};

export function InputDiagnosticsPanel({
  summary,
  env,
  events,
  currentState,
  onClear,
  onDisable,
}: InputDiagnosticsPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyReport = async () => {
    try {
      const text = formatDiagnosticReport(summary, env, events);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable in restricted context
    }
  };

  const envMode = env.isStandalonePwa
    ? 'Installed PWA'
    : env.inIframe
      ? 'Embedded Iframe (Preview)'
      : 'Browser Tab';

  return (
    <section
      aria-label="Mobile input diagnostic panel"
      className="shrink-0 max-h-[38dvh] overflow-y-auto rounded-xl border border-white/[0.14] bg-[#0D1117] p-3 text-[11px] text-zinc-200 space-y-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`px-2 py-0.5 rounded-md border font-mono text-[10px] font-semibold ${BADGE_CLASSES[summary.code]}`}
          >
            {summary.code}
          </span>
          {summary.focusLostImmediately && (
            <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-200 font-medium">
              focusLostImmediately
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => void handleCopyReport()}
            className="min-h-[32px] px-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-zinc-100 inline-flex items-center gap-1"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear input diagnostic log"
            className="min-h-[32px] px-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Clear</span>
          </button>
          <button
            type="button"
            onClick={onDisable}
            aria-label="Disable input diagnostics"
            className="min-h-[32px] px-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            <span>Disable</span>
          </button>
        </div>
      </div>

      <div className="space-y-0.5">
        <p className="font-semibold text-zinc-100">{summary.headline}</p>
        <p className="text-zinc-300 leading-relaxed">{summary.detail}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 rounded-lg bg-[#090B0E] border border-white/[0.06] p-2 font-mono text-[10px] text-zinc-300">
        <div>Mode: {envMode}</div>
        <div>Device: {env.isAndroidUserAgent ? 'Android UA' : 'Non-Android UA'} · Touch={String(env.isTouchDevice)}</div>
        <div>SW: {env.serviceWorkerControlled ? 'active' : 'none'}</div>
        <div>Center Hit: {env.hitTestAtTextareaCenter ?? 'unknown'}</div>
        <div>
          State: ws={currentState.activeWorkspace} kbOpen={String(currentState.keyboardOpen)} vvH={currentState.viewportHeight ?? '-'}
        </div>
        <div>
          Sending={String(currentState.chatSending)} · DraftLen={currentState.draftLength} · BaseH={env.baselineHeight}px
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          Event Sequence ({events.length} latest, newest first)
        </p>
        {events.length === 0 ? (
          <p className="text-zinc-400 italic">No events captured yet. Tap the Message input box below.</p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto font-mono text-[10px]">
            {[...events].reverse().map((ev) => (
              <div
                key={ev.seq}
                className="rounded border border-white/[0.06] bg-[#090B0E] px-2 py-1 leading-snug"
              >
                <div className="flex flex-wrap items-center justify-between gap-1 text-zinc-100">
                  <span>
                    #{ev.seq} <strong className="text-emerald-300">{ev.type}</strong>{' '}
                    <span className="text-zinc-400">[{ev.time}]</span>
                  </span>
                  <span className="text-zinc-300">
                    trusted={String(ev.isTrusted)} kbOpen={String(ev.appKeyboardOpen)}
                  </span>
                </div>
                <div className="text-zinc-300 break-all">
                  target={ev.target} | active={ev.activeElement}
                </div>
                <div className="text-zinc-400">
                  dis={String(ev.textareaDisabled)} ro={String(ev.textareaReadOnly)} vis={String(ev.textareaVisible)} conn={String(ev.textareaConnected)} win={ev.windowInnerWidth}x{ev.windowInnerHeight} vv={ev.visualViewportWidth ?? '-'}x{ev.visualViewportHeight ?? '-'}
                  {ev.textareaRect ? ` rect=[${Math.round(ev.textareaRect.top)}..${Math.round(ev.textareaRect.bottom)}]` : ''}
                  {ev.note ? ` · ${ev.note}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
