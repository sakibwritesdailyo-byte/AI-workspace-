import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Eye,
  FileCode2,
  FolderTree,
  Loader2,
  Save,
  X,
} from 'lucide-react';
import type { FileLanguage, Project, ProjectFile, SaveStatus } from '../../types/workspace';

interface CodeStudioProps {
  project: Project;
  openFiles: ProjectFile[];
  activeFile: ProjectFile | undefined;
  dirtyFileIds: string[];
  saveStatus: SaveStatus;
  lastSavedAt: string | null;
  storageError: string | null;
  showLineNumbers: boolean;
  onSelectFile: (fileId: string) => void;
  onCloseTab: (fileId: string) => void;
  onChangeContent: (fileId: string, content: string) => void;
  onFlushSaveNow: () => void;
  onCloneSampleProject?: (sampleProjectId: string) => void;
  onOpenPreview: () => void;
  onOpenFilesDrawer?: () => void;
}

function getLanguageExtension(language: FileLanguage) {
  switch (language) {
    case 'html':
      return html();
    case 'css':
      return css();
    case 'typescript':
      return javascript({ typescript: true, jsx: true });
    case 'javascript':
      return javascript({ jsx: true });
    case 'json':
      return json();
    case 'markdown':
    default:
      return markdown();
  }
}

function formatSavedTime(iso: string | null): string {
  if (!iso) return 'Saved';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Saved';
  return `Saved ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function CodeStudio({
  project,
  openFiles,
  activeFile,
  dirtyFileIds,
  saveStatus,
  lastSavedAt,
  storageError,
  showLineNumbers,
  onSelectFile,
  onCloseTab,
  onChangeContent,
  onFlushSaveNow,
  onCloneSampleProject,
  onOpenPreview,
  onOpenFilesDrawer,
}: CodeStudioProps) {
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lineNumberCompartmentRef = useRef(new Compartment());
  const readOnly = Boolean(project.isSample);
  const onChangeRef = useRef(onChangeContent);
  onChangeRef.current = onChangeContent;

  const isDirty = activeFile ? dirtyFileIds.includes(activeFile.id) : false;
  const hasUnsavedChanges = dirtyFileIds.length > 0 || saveStatus === 'unsaved';

  // Mount CodeMirror 6 instance whenever activeFile id or language changes
  useEffect(() => {
    const host = editorContainerRef.current;
    if (!host || !activeFile) return;

    const fileId = activeFile.id;
    const state = EditorState.create({
      doc: activeFile.content,
      extensions: [
        lineNumberCompartmentRef.current.of(showLineNumbers ? lineNumbers() : []),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        getLanguageExtension(activeFile.language),
        oneDark,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.theme({
          '&': {
            backgroundColor: '#090B0E',
            color: '#E2E8F0',
            fontSize: '13px',
            height: '100%',
            fontFamily: 'var(--font-mono)',
          },
          '.cm-scroller': {
            overflow: 'auto',
            lineHeight: '1.6',
          },
          '.cm-gutters': {
            backgroundColor: '#0B0E12',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            color: '#71717A',
          },
          '.cm-activeLine': {
            backgroundColor: 'rgba(255,255,255,0.03)',
          },
          '.cm-activeLineGutter': {
            backgroundColor: 'rgba(255,255,255,0.04)',
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(fileId, update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: host,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [activeFile?.id, activeFile?.language, readOnly]);

  // Sync external document updates (e.g., after import/restore) without breaking user typing
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activeFile) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== activeFile.content) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: activeFile.content },
      });
    }
  }, [activeFile?.id, activeFile?.content]);

  // Toggle line numbers dynamically without tearing down undo history
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: lineNumberCompartmentRef.current.reconfigure(
        showLineNumbers ? lineNumbers() : [],
      ),
    });
  }, [showLineNumbers]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Sample Project Read-Only Banner */}
      {readOnly && (
        <div className="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/25 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-amber-200">
            Viewing <strong>Sample Template (Read-Only Demo)</strong>. Clone to edit and persist
            in IndexedDB.
          </span>
          {onCloneSampleProject && (
            <button
              type="button"
              onClick={() => onCloneSampleProject(project.id)}
              className="min-h-[34px] px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#052317] font-semibold inline-flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              Clone to My Projects
            </button>
          )}
        </div>
      )}

      {storageError && (
        <div
          role="alert"
          className="px-4 py-2 bg-rose-950/35 border-b border-rose-500/30 text-xs text-rose-200 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{storageError}</span>
        </div>
      )}

      {/* Editor Header */}
      <div className="px-4 py-2.5 border-b border-white/[0.08] bg-[#0D1015] flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="font-medium text-zinc-200 truncate">{project.name}</span>
            {activeFile && (
              <>
                <span aria-hidden="true">/</span>
                <span className="font-mono text-emerald-300 truncate">{activeFile.path}</span>
              </>
            )}
          </div>
          <p className="text-xs text-zinc-400 mt-0.5 flex items-center gap-1.5">
            <span>CodeMirror 6</span>
            <span aria-hidden="true">·</span>
            {readOnly ? (
              <span>Read-only demo</span>
            ) : saveStatus === 'error' ? (
              <span className="text-rose-300">IndexedDB save error</span>
            ) : saveStatus === 'saving' ? (
              <span className="text-emerald-300 inline-flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Saving to IndexedDB…
              </span>
            ) : hasUnsavedChanges ? (
              <span className="text-amber-300">Unsaved changes</span>
            ) : (
              <span className="text-emerald-300 inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {formatSavedTime(lastSavedAt)} in IndexedDB
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onOpenFilesDrawer && (
            <button
              type="button"
              onClick={onOpenFilesDrawer}
              aria-label="Browse project files and folders"
              className="lg:hidden min-h-[38px] px-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5"
            >
              <FolderTree className="w-3.5 h-3.5 text-emerald-400" />
              <span>Files</span>
            </button>
          )}

          {activeFile && !readOnly && (
            <button
              type="button"
              onClick={onFlushSaveNow}
              disabled={saveStatus === 'saving'}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition-colors ${
                isDirty || hasUnsavedChanges
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35 hover:bg-emerald-500/25'
                  : 'bg-white/[0.04] text-zinc-200 border-white/[0.08] hover:bg-white/[0.08]'
              }`}
            >
              {saveStatus === 'saving' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>
                {saveStatus === 'saving'
                  ? 'Saving…'
                  : isDirty || hasUnsavedChanges
                    ? 'Save Now'
                    : 'Saved'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenPreview}
            className="min-h-[38px] px-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#052317] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </button>
        </div>
      </div>

      {/* Open File Tabs */}
      <div
        role="tablist"
        aria-label="Open project files"
        className="flex items-center gap-1 px-3 py-1.5 bg-[#0A0D11] border-b border-white/[0.08] overflow-x-auto"
      >
        {openFiles.map((file) => {
          const selected = file.id === activeFile?.id;
          const fileDirty = dirtyFileIds.includes(file.id);
          return (
            <div
              key={file.id}
              className={`inline-flex items-center rounded-lg border text-xs font-mono shrink-0 ${
                selected
                  ? 'bg-[#151A22] text-zinc-100 border-emerald-500/35'
                  : 'bg-transparent text-zinc-400 border-transparent hover:bg-white/[0.04] hover:text-zinc-200'
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onSelectFile(file.id)}
                className="min-h-[34px] pl-2.5 pr-1.5 flex items-center gap-1.5"
              >
                <FileCode2 className="w-3.5 h-3.5 text-emerald-400/80" />
                <span>{file.name}</span>
                {fileDirty && <span className="text-amber-300" aria-label="Unsaved">*</span>}
              </button>
              {openFiles.length > 1 && (
                <button
                  type="button"
                  onClick={() => onCloseTab(file.id)}
                  aria-label={`Close ${file.name}`}
                  className="p-1.5 mr-0.5 rounded text-zinc-400 hover:text-zinc-200"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* CodeMirror 6 Mount */}
      <div className="flex-1 min-h-[180px] bg-[#090B0E] overflow-hidden">
        {activeFile ? (
          <div
            ref={editorContainerRef}
            data-testid="codemirror-editor"
            className="w-full h-full min-h-[180px]"
          />
        ) : (
          <div className="h-full flex items-center justify-center p-6 text-sm text-zinc-400">
            Select a file from the project explorer to inspect or edit.
          </div>
        )}
      </div>
    </div>
  );
}
