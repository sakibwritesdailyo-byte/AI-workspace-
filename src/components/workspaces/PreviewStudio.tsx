import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Code2, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import { assemblePreviewDocument } from '../../state/workspaceReducer';
import type { PreviewViewport, Project } from '../../types/workspace';
import { validatePreviewMessage } from '../../utils/previewSecurity';

interface PreviewStudioProps {
  project: Project;
  viewport: PreviewViewport;
  previewNonce: number;
  onChangeViewport: (viewport: PreviewViewport) => void;
  onRefresh: () => void;
  onEditCode: () => void;
}

const VIEWPORT_OPTIONS: {
  id: PreviewViewport;
  label: string;
  widthClass: string;
  icon: typeof Smartphone;
}[] = [
  { id: 'mobile', label: 'Mobile', widthClass: 'max-w-[390px]', icon: Smartphone },
  { id: 'tablet', label: 'Tablet', widthClass: 'max-w-[768px]', icon: Tablet },
  { id: 'desktop', label: 'Desktop', widthClass: 'max-w-full', icon: Monitor },
];

export function PreviewStudio({
  project,
  viewport,
  previewNonce,
  onChangeViewport,
  onRefresh,
  onEditCode,
}: PreviewStudioProps) {
  const [runtimeErrors, setRuntimeErrors] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const channelToken = `${project.id}:${previewNonce}`;

  useEffect(() => {
    setRuntimeErrors([]);
  }, [project.id, previewNonce]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const validated = validatePreviewMessage(
        event,
        iframeRef.current?.contentWindow,
        channelToken,
        window.location.origin,
      );
      if (validated) {
        setRuntimeErrors((prev) => [...prev, validated.message]);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [channelToken]);

  const srcDoc = useMemo(
    () => assemblePreviewDocument(project, channelToken),
    [project, channelToken],
  );
  const activeOption = VIEWPORT_OPTIONS.find((v) => v.id === viewport) ?? VIEWPORT_OPTIONS[0];

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-white/[0.08] bg-[#0D1015] flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-zinc-100 truncate">
            Preview · {project.name}
          </h1>
          <p className="text-xs text-zinc-400">
            Sandboxed iframe (`allow-scripts` only · isolated from app state & credentials)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Viewport Switcher */}
          <div
            role="group"
            aria-label="Preview viewport size"
            className="inline-flex items-center p-1 rounded-xl bg-[#090B0E] border border-white/[0.08]"
          >
            {VIEWPORT_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = viewport === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangeViewport(opt.id)}
                  aria-pressed={active}
                  className={`min-h-[36px] px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                    active
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{opt.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh preview"
            className="min-h-[40px] px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={onEditCode}
            className="min-h-[40px] px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5 transition-colors"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Code</span>
          </button>
        </div>
      </div>

      {/* Sandboxed Frame Viewport */}
      <div className="flex-1 min-h-[320px] bg-[#07090C] p-3 sm:p-5 overflow-auto flex justify-center">
        <div
          className={`w-full ${activeOption.widthClass} h-full min-h-[420px] rounded-2xl border border-white/[0.1] bg-[#0B0E12] overflow-hidden shadow-2xl transition-[max-width] duration-200`}
        >
          <iframe
            ref={iframeRef}
            key={`${project.id}-${previewNonce}`}
            title={`Sandboxed preview of ${project.name}`}
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            className="w-full h-full min-h-[420px] border-0 bg-[#0B0E12]"
          />
        </div>
      </div>

      {/* Preview Error Console */}
      {runtimeErrors.length > 0 && (
        <div
          role="alert"
          className="px-4 py-2.5 border-t border-rose-500/30 bg-rose-950/30 text-xs text-rose-200 flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1 font-mono">
            {runtimeErrors.map((err, idx) => (
              <div key={idx}>{err}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
