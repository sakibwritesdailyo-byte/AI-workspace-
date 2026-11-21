import { useRef, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  CopyPlus,
  Download,
  Eye,
  FileCode2,
  FilePlus2,
  Folder,
  FolderKanban,
  FolderPlus,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';
import { SAMPLE_PROJECTS } from '../../data/mockWorkspaceData';
import {
  getProjectFolders,
  normalizeFolderPath,
  validateProjectFilePath,
} from '../../state/workspaceReducer';
import type {
  PreviewViewport,
  Project,
  ProjectFile,
  ProjectSubView,
  SaveStatus,
} from '../../types/workspace';
import { CodeStudio } from './CodeStudio';
import { PreviewStudio } from './PreviewStudio';

interface ProjectsWorkspaceProps {
  projects: Project[];
  activeProject: Project | undefined;
  subView: ProjectSubView;
  openFiles: ProjectFile[];
  activeFile: ProjectFile | undefined;
  dirtyFileIds: string[];
  saveStatus: SaveStatus;
  lastSavedAt: string | null;
  storageError: string | null;
  showLineNumbers: boolean;
  previewViewport: PreviewViewport;
  previewNonce: number;
  onChangeSubView: (subView: ProjectSubView) => void;
  onSelectProject: (projectId: string, subView?: ProjectSubView) => void;
  onPreviewSampleProject: (sampleProjectId: string, subView?: ProjectSubView) => void;
  onCloneSampleProject: (sampleProjectId: string) => void;
  onCreateProject: (name: string, description?: string) => void;
  onRenameProject: (projectId: string, name: string) => void;
  onDuplicateProject: (projectId: string) => void;
  onExportProject: (project: Project) => void;
  onRequestDeleteProject: (project: Project) => void;
  onSelectFile: (fileId: string, openCodeStudio?: boolean) => void;
  onCreateFile: (folder: string, name: string) => void;
  onRenameFile: (fileId: string, newName: string) => void;
  onRequestDeleteFile: (file: ProjectFile) => void;
  onCreateFolder: (folderPath: string) => void;
  onRenameFolder: (oldPath: string, newPath: string) => void;
  onRequestDeleteFolder: (folderPath: string, fileCount: number) => void;
  onCloseTab: (fileId: string) => void;
  onChangeFileContent: (fileId: string, content: string) => void;
  onFlushSaveNow: () => void;
  onChangePreviewViewport: (viewport: PreviewViewport) => void;
  onRefreshPreview: () => void;
  onExportWorkspace: () => void;
  onInspectImportFile: (rawJson: string) => { ok: boolean; message?: string };
  onOpenFilesDrawer: () => void;
}

export function ProjectsWorkspace({
  projects,
  activeProject,
  subView,
  openFiles,
  activeFile,
  dirtyFileIds,
  saveStatus,
  lastSavedAt,
  storageError,
  showLineNumbers,
  previewViewport,
  previewNonce,
  onChangeSubView,
  onSelectProject,
  onPreviewSampleProject,
  onCloneSampleProject,
  onCreateProject,
  onRenameProject,
  onDuplicateProject,
  onExportProject,
  onRequestDeleteProject,
  onSelectFile,
  onCreateFile,
  onRenameFile,
  onRequestDeleteFile,
  onCreateFolder,
  onRenameFolder,
  onRequestDeleteFolder,
  onCloseTab,
  onChangeFileContent,
  onFlushSaveNow,
  onChangePreviewViewport,
  onRefreshPreview,
  onExportWorkspace,
  onInspectImportFile,
  onOpenFilesDrawer,
}: ProjectsWorkspaceProps) {
  const [creating, setCreating] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [projectRenameDraft, setProjectRenameDraft] = useState('');

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderDraft, setNewFolderDraft] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [folderRenameDraft, setFolderRenameDraft] = useState('');

  const [creatingFile, setCreatingFile] = useState(false);
  const [newFileFolder, setNewFileFolder] = useState('src');
  const [newFileName, setNewFileName] = useState('');
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [fileRenameDraft, setFileRenameDraft] = useState('');

  const [folderValidationError, setFolderValidationError] = useState<string | null>(null);
  const [fileValidationError, setFileValidationError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameDraft.trim()) return;
    onCreateProject(nameDraft.trim(), descDraft.trim());
    setNameDraft('');
    setDescDraft('');
    setCreating(false);
  };

  const handleProjectRenameSubmit = (e: React.FormEvent, projectId: string) => {
    e.preventDefault();
    if (!projectRenameDraft.trim()) return;
    onRenameProject(projectId, projectRenameDraft.trim());
    setRenamingProjectId(null);
    setProjectRenameDraft('');
  };

  const validateFolderInput = (raw: string): string | null => {
    const trimmed = raw.trim().replace(/\\/g, '/');
    if (
      !trimmed ||
      trimmed.split('/').some((seg) => seg.trim() === '..' || seg.trim() === '.') ||
      /[\0<>:"|?*]/.test(trimmed)
    ) {
      return 'Invalid folder path. Avoid empty segments, ".", "..", or special characters.';
    }
    return null;
  };

  const handleCreateFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateFolderInput(newFolderDraft);
    if (err) {
      setFolderValidationError(err);
      return;
    }
    setFolderValidationError(null);
    const normalized = normalizeFolderPath(newFolderDraft);
    onCreateFolder(normalized);
    setNewFileFolder(normalized);
    setNewFolderDraft('');
    setCreatingFolder(false);
  };

  const handleRenameFolderSubmit = (e: React.FormEvent, oldPath: string) => {
    e.preventDefault();
    const err = validateFolderInput(folderRenameDraft);
    if (err) {
      setFolderValidationError(err);
      return;
    }
    if (activeProject && !activeProject.isSample) {
      const fromPath = normalizeFolderPath(oldPath);
      const toPath = normalizeFolderPath(folderRenameDraft);
      if (fromPath !== toPath) {
        const remap = (f: string) =>
          f === fromPath ? toPath : f.startsWith(`${fromPath}/`) ? `${toPath}${f.slice(fromPath.length)}` : f;
        const seen = new Set<string>();
        for (const file of activeProject.files) {
          const nextFolder = remap(file.folder);
          const key = `${nextFolder}/${file.name}`.toLowerCase();
          if (seen.has(key)) {
            setFolderValidationError(
              `Cannot rename folder to "${toPath}" because "${nextFolder}/${file.name}" would collide with an existing file.`,
            );
            return;
          }
          seen.add(key);
        }
      }
    }
    setFolderValidationError(null);
    onRenameFolder(oldPath, folderRenameDraft.trim());
    setRenamingFolder(null);
    setFolderRenameDraft('');
  };

  const handleCreateFileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || activeProject.isSample) return;
    const validation = validateProjectFilePath(activeProject, newFileFolder, newFileName);
    if (!validation.ok) {
      setFileValidationError(validation.error);
      return;
    }
    setFileValidationError(null);
    onCreateFile(validation.folder, validation.name);
    setNewFileName('');
    setCreatingFile(false);
  };

  const handleRenameFileSubmit = (e: React.FormEvent, file: ProjectFile) => {
    e.preventDefault();
    if (!activeProject || activeProject.isSample) return;
    const validation = validateProjectFilePath(
      activeProject,
      file.folder,
      fileRenameDraft,
      file.id,
    );
    if (!validation.ok) {
      setFileValidationError(validation.error);
      return;
    }
    setFileValidationError(null);
    onRenameFile(file.id, validation.name);
    setRenamingFileId(null);
    setFileRenameDraft('');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const res = onInspectImportFile(text);
      setImportError(res.ok ? null : res.message || 'Invalid backup file.');
    } catch {
      setImportError('Failed to read selected import file.');
    }
  };

  const activeFolders =
    activeProject && !activeProject.isSample ? getProjectFolders(activeProject) : [];

  return (
    <div className="h-full flex flex-col">
      {/* Sub-navigation bar inside Projects */}
      <div className="px-4 sm:px-6 py-2.5 border-b border-white/[0.07] bg-[#0B0E13] flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Project workspace views"
          className="inline-flex items-center p-1 rounded-xl bg-[#10141A] border border-white/[0.08]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={subView === 'overview'}
            onClick={() => onChangeSubView('overview')}
            className={`min-h-[36px] px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
              subView === 'overview'
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FolderKanban className="w-3.5 h-3.5" />
            <span>Overview</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={subView === 'code'}
            disabled={!activeProject}
            onClick={() => onChangeSubView('code')}
            className={`min-h-[36px] px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-40 transition-colors ${
              subView === 'code'
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Code Studio</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={subView === 'preview'}
            disabled={!activeProject}
            onClick={() => onChangeSubView('preview')}
            className={`min-h-[36px] px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-40 transition-colors ${
              subView === 'preview'
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Preview Studio</span>
          </button>
        </div>

        {activeProject && subView === 'overview' && (
          <span className="text-xs text-zinc-400 truncate">
            Active: <strong className="text-zinc-200 font-medium">{activeProject.name}</strong>
          </span>
        )}
      </div>

      {/* Sub-view content */}
      {subView === 'code' && activeProject ? (
        <div className="flex-1 min-h-0">
          <CodeStudio
            project={activeProject}
            openFiles={openFiles}
            activeFile={activeFile}
            dirtyFileIds={dirtyFileIds}
            saveStatus={saveStatus}
            lastSavedAt={lastSavedAt}
            storageError={storageError}
            showLineNumbers={showLineNumbers}
            onSelectFile={(fileId) => onSelectFile(fileId)}
            onCloseTab={onCloseTab}
            onChangeContent={onChangeFileContent}
            onFlushSaveNow={onFlushSaveNow}
            onCloneSampleProject={onCloneSampleProject}
            onOpenPreview={() => onChangeSubView('preview')}
            onOpenFilesDrawer={onOpenFilesDrawer}
          />
        </div>
      ) : subView === 'preview' && activeProject ? (
        <div className="flex-1 min-h-0">
          <PreviewStudio
            project={activeProject}
            viewport={previewViewport}
            previewNonce={previewNonce}
            onChangeViewport={onChangePreviewViewport}
            onRefresh={onRefreshPreview}
            onEditCode={() => onChangeSubView('code')}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto max-w-4xl mx-auto w-full px-4 sm:px-6 py-6 space-y-8">
          {/* Header & Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-zinc-100">Projects</h1>
              <p className="text-xs text-zinc-400 mt-1">
                Local-first projects saved in IndexedDB with CodeMirror 6 and sandboxed preview.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onExportWorkspace}
                className="min-h-[40px] px-3 rounded-xl border border-white/[0.1] text-xs font-medium text-zinc-200 hover:text-zinc-100 hover:bg-white/[0.06] inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Export All
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[40px] px-3 rounded-xl border border-white/[0.1] text-xs font-medium text-zinc-200 hover:text-zinc-100 hover:bg-white/[0.06] inline-flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                Import
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportFile}
                className="hidden"
                aria-label="Import projects JSON"
              />

              <button
                type="button"
                onClick={() => setCreating((prev) => !prev)}
                className="min-h-[40px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#052317] text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <FolderPlus className="w-4 h-4" />
                New Project
              </button>
            </div>
          </div>

          {importError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-2.5 text-xs text-rose-200"
            >
              {importError}
            </div>
          )}

          {creating && (
            <form
              onSubmit={handleCreateSubmit}
              className="rounded-2xl border border-white/[0.1] bg-[#0F1319] p-4 space-y-3"
            >
              <h2 className="text-sm font-semibold text-zinc-100">Create Local Project</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="Project name (e.g. Habit Tracker)"
                  aria-label="Project name"
                  className="h-10 px-3 rounded-xl bg-[#090B0E] border border-white/15 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                  autoFocus
                />
                <input
                  type="text"
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  placeholder="Short description (optional)"
                  aria-label="Project description"
                  className="h-10 px-3 rounded-xl bg-[#090B0E] border border-white/15 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="min-h-[38px] px-3 rounded-lg text-xs text-zinc-300 hover:bg-white/[0.06]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[38px] px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#052317] text-xs font-semibold"
                >
                  Create & Open Code
                </button>
              </div>
            </form>
          )}

          {/* Your Real IndexedDB Projects */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-zinc-400">
              Your Projects ({projects.length})
            </h2>

            {projects.length === 0 ? (
              <div className="py-10 px-4 border-y border-white/[0.06] text-center space-y-3">
                <p className="text-sm font-medium text-zinc-200">No personal projects saved yet</p>
                <p className="text-xs text-zinc-400 max-w-md mx-auto">
                  Create a fresh project above, import a JSON bundle, or clone a sample template
                  below.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.07] border-y border-white/[0.07]">
                {projects.map((project) => {
                  const isActive = activeProject && !activeProject.isSample && activeProject.id === project.id;
                  const isRenaming = renamingProjectId === project.id;
                  return (
                    <div
                      key={project.id}
                      className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        {isRenaming ? (
                          <form
                            onSubmit={(e) => handleProjectRenameSubmit(e, project.id)}
                            className="flex items-center gap-2 max-w-sm"
                          >
                            <input
                              type="text"
                              value={projectRenameDraft}
                              onChange={(e) => setProjectRenameDraft(e.target.value)}
                              aria-label={`Rename project ${project.name}`}
                              className="flex-1 h-9 px-2.5 rounded-lg bg-[#090B0E] border border-emerald-500/60 text-xs text-zinc-100"
                              autoFocus
                            />
                            <button
                              type="submit"
                              aria-label="Save project rename"
                              className="h-9 px-3 rounded-lg bg-emerald-500 text-[#052317] text-xs font-semibold inline-flex items-center gap-1"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenamingProjectId(null)}
                              className="h-9 px-2.5 rounded-lg text-xs text-zinc-300 hover:bg-white/[0.06]"
                            >
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-semibold text-zinc-100 truncate">
                                {project.name}
                              </h3>
                              {isActive && (
                                <span className="text-xs font-medium text-emerald-300">Active</span>
                              )}
                            </div>
                            <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">
                              {project.description}
                            </p>
                            <p className="text-xs text-zinc-400 mt-1 font-mono tabular-nums">
                              {project.files.length === 1 ? '1 file' : `${project.files.length} files`} ·{' '}
                              {(() => {
                                const count = getProjectFolders(project).length;
                                return count === 1 ? '1 folder' : `${count} folders`;
                              })()}{' '}
                              · {project.framework}
                            </p>
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onSelectProject(project.id, 'code')}
                          className="min-h-[40px] px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5"
                        >
                          <Code2 className="w-3.5 h-3.5 text-emerald-400" />
                          Code
                        </button>

                        <button
                          type="button"
                          onClick={() => onSelectProject(project.id, 'preview')}
                          className="min-h-[40px] px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Preview
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setRenamingProjectId(project.id);
                            setProjectRenameDraft(project.name);
                          }}
                          aria-label={`Rename project ${project.name}`}
                          className="min-h-[40px] min-w-[40px] rounded-lg text-zinc-300 hover:text-zinc-100 hover:bg-white/[0.06] inline-flex items-center justify-center"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onDuplicateProject(project.id)}
                          aria-label={`Duplicate project ${project.name}`}
                          className="min-h-[40px] min-w-[40px] rounded-lg text-zinc-300 hover:text-emerald-300 hover:bg-white/[0.06] inline-flex items-center justify-center"
                        >
                          <CopyPlus className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onExportProject(project)}
                          aria-label={`Export project ${project.name}`}
                          className="min-h-[40px] min-w-[40px] rounded-lg text-zinc-300 hover:text-emerald-300 hover:bg-white/[0.06] inline-flex items-center justify-center"
                        >
                          <Download className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onRequestDeleteProject(project)}
                          aria-label={`Delete project ${project.name}`}
                          className="min-h-[40px] min-w-[40px] rounded-lg text-zinc-300 hover:text-rose-300 hover:bg-rose-500/10 inline-flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Active Project Files & Nested Folders Manager (always accessible on Android mobile) */}
          {activeProject && !activeProject.isSample && (
            <section className="space-y-3 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-xs font-semibold text-zinc-400">
                    Files & Folders · {activeProject.name}
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Create nested folders, add files, rename, or open directly in Code Studio.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingFolder((prev) => !prev);
                      setCreatingFile(false);
                      setFolderValidationError(null);
                      setFileValidationError(null);
                    }}
                    className="min-h-[40px] px-3 rounded-lg border border-white/[0.1] text-xs font-medium text-zinc-200 hover:bg-white/[0.06] inline-flex items-center gap-1.5"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-emerald-400" />
                    New Folder
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingFile((prev) => !prev);
                      setCreatingFolder(false);
                      setFolderValidationError(null);
                      setFileValidationError(null);
                    }}
                    className="min-h-[40px] px-3 rounded-lg border border-white/[0.1] text-xs font-medium text-zinc-200 hover:bg-white/[0.06] inline-flex items-center gap-1.5"
                  >
                    <FilePlus2 className="w-3.5 h-3.5 text-emerald-400" />
                    New File
                  </button>
                </div>
              </div>

              {(folderValidationError || fileValidationError) && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-500/35 bg-rose-950/30 px-3.5 py-2.5 text-xs text-rose-200"
                >
                  {fileValidationError || folderValidationError}
                </div>
              )}

              {creatingFolder && (
                <form
                  onSubmit={handleCreateFolderSubmit}
                  className="rounded-xl border border-white/[0.1] bg-[#0F1319] p-3 flex flex-wrap items-center gap-2"
                >
                  <input
                    type="text"
                    value={newFolderDraft}
                    onChange={(e) => {
                      setNewFolderDraft(e.target.value);
                      setFolderValidationError(null);
                    }}
                    placeholder="Folder path (e.g. src/components)"
                    aria-label="New folder path"
                    className="flex-1 min-w-[180px] h-10 px-3 rounded-lg bg-[#090B0E] border border-white/15 text-xs text-zinc-100"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="min-h-[40px] px-3 rounded-lg bg-emerald-500 text-[#052317] text-xs font-semibold"
                  >
                    Create Folder
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingFolder(false);
                      setFolderValidationError(null);
                    }}
                    className="min-h-[40px] px-2.5 rounded-lg text-xs text-zinc-300 hover:bg-white/[0.06]"
                  >
                    Cancel
                  </button>
                </form>
              )}

              {creatingFile && (
                <form
                  onSubmit={handleCreateFileSubmit}
                  className="rounded-xl border border-white/[0.1] bg-[#0F1319] p-3 flex flex-wrap items-center gap-2"
                >
                  <input
                    type="text"
                    value={newFileFolder}
                    onChange={(e) => {
                      setNewFileFolder(e.target.value);
                      setFileValidationError(null);
                    }}
                    placeholder="src/utils"
                    aria-label="Target folder path"
                    className="w-36 h-10 px-2.5 rounded-lg bg-[#090B0E] border border-white/15 text-xs text-zinc-100"
                  />
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => {
                      setNewFileName(e.target.value);
                      setFileValidationError(null);
                    }}
                    placeholder="File name (e.g. app.js)"
                    aria-label="New file name"
                    className="flex-1 min-w-[180px] h-10 px-3 rounded-lg bg-[#090B0E] border border-white/15 text-xs text-zinc-100"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="min-h-[40px] px-3 rounded-lg bg-emerald-500 text-[#052317] text-xs font-semibold"
                  >
                    Create & Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingFile(false);
                      setFileValidationError(null);
                    }}
                    className="min-h-[40px] px-2.5 rounded-lg text-xs text-zinc-300 hover:bg-white/[0.06]"
                  >
                    Cancel
                  </button>
                </form>
              )}

              <div className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
                {activeFolders.map((folder) => {
                  const folderFiles = activeProject.files.filter((f) => f.folder === folder);
                  const subtreeFileCount = activeProject.files.filter(
                    (f) => f.folder === folder || f.folder.startsWith(`${folder}/`),
                  ).length;
                  const canDeleteFolder = activeProject.files.length - subtreeFileCount >= 1;
                  const isRenamingThisFolder = renamingFolder === folder;

                  return (
                    <div key={folder} className="py-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        {isRenamingThisFolder ? (
                          <form
                            onSubmit={(e) => handleRenameFolderSubmit(e, folder)}
                            className="flex items-center gap-2 flex-1"
                          >
                            <input
                              type="text"
                              value={folderRenameDraft}
                              onChange={(e) => {
                                setFolderRenameDraft(e.target.value);
                                setFolderValidationError(null);
                              }}
                              aria-label={`Rename folder ${folder}`}
                              className="h-9 px-2.5 rounded bg-[#090B0E] border border-emerald-500/60 text-xs text-zinc-100"
                              autoFocus
                            />
                            <button
                              type="submit"
                              className="min-h-[36px] px-2.5 rounded bg-emerald-500 text-[#052317] text-xs font-semibold"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingFolder(null);
                                setFolderValidationError(null);
                              }}
                              className="min-h-[36px] px-2 rounded text-xs text-zinc-300"
                            >
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                            <Folder className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="font-mono">{folder}</span>
                            <span className="text-zinc-400">({folderFiles.length})</span>
                          </div>
                        )}

                        {!isRenamingThisFolder && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingFolder(folder);
                                setFolderRenameDraft(folder);
                                setFolderValidationError(null);
                              }}
                              aria-label={`Rename folder ${folder}`}
                              className="min-h-[40px] min-w-[40px] rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] inline-flex items-center justify-center"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={!canDeleteFolder}
                              onClick={() => onRequestDeleteFolder(folder, subtreeFileCount)}
                              aria-label={
                                canDeleteFolder
                                  ? `Delete folder ${folder}`
                                  : `Cannot delete ${folder}: keep at least 1 file in project`
                              }
                              title={
                                canDeleteFolder
                                  ? `Delete folder ${folder}`
                                  : 'Keep at least 1 file in project before deleting this folder'
                              }
                              className="min-h-[40px] min-w-[40px] rounded-md text-zinc-400 hover:text-rose-300 hover:bg-rose-500/10 disabled:opacity-35 disabled:pointer-events-none inline-flex items-center justify-center"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {folderFiles.length > 0 && (
                        <div className="pl-5 space-y-1">
                          {folderFiles.map((file) => {
                            const isRenamingThisFile = renamingFileId === file.id;
                            return (
                              <div
                                key={file.id}
                                className="flex items-center justify-between gap-2 py-1"
                              >
                                {isRenamingThisFile ? (
                                  <form
                                    onSubmit={(e) => handleRenameFileSubmit(e, file)}
                                    className="flex items-center gap-2 flex-1"
                                  >
                                    <input
                                      type="text"
                                      value={fileRenameDraft}
                                      onChange={(e) => {
                                        setFileRenameDraft(e.target.value);
                                        setFileValidationError(null);
                                      }}
                                      aria-label={`Rename file ${file.name}`}
                                      className="h-9 px-2.5 rounded bg-[#090B0E] border border-emerald-500/60 text-xs text-zinc-100 font-mono"
                                      autoFocus
                                    />
                                    <button
                                      type="submit"
                                      className="min-h-[36px] px-2.5 rounded bg-emerald-500 text-[#052317] text-xs font-semibold"
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRenamingFileId(null);
                                        setFileValidationError(null);
                                      }}
                                      className="min-h-[36px] px-2 rounded text-xs text-zinc-300"
                                    >
                                      Cancel
                                    </button>
                                  </form>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => onSelectFile(file.id, true)}
                                      className="min-h-[40px] text-xs font-mono text-zinc-300 hover:text-emerald-300 inline-flex items-center gap-2 truncate"
                                    >
                                      <FileCode2 className="w-3.5 h-3.5 text-emerald-400/80 shrink-0" />
                                      <span className="truncate">{file.name}</span>
                                    </button>

                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setRenamingFileId(file.id);
                                          setFileRenameDraft(file.name);
                                          setFileValidationError(null);
                                        }}
                                        aria-label={`Rename file ${file.name}`}
                                        className="min-h-[40px] min-w-[40px] rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] inline-flex items-center justify-center"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      {activeProject.files.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() => onRequestDeleteFile(file)}
                                          aria-label={`Delete file ${file.name}`}
                                          className="min-h-[40px] min-w-[40px] rounded-md text-zinc-400 hover:text-rose-300 hover:bg-rose-500/10 inline-flex items-center justify-center"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Clearly Separated Sample Templates */}
          <section className="space-y-3 pt-2">
            <div>
              <h2 className="text-xs font-semibold text-zinc-400">
                Sample Templates (Demo Reference)
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Read-only demonstration projects. Clone one to save and edit it in your personal
                IndexedDB workspace.
              </p>
            </div>

            <div className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
              {SAMPLE_PROJECTS.map((sample) => (
                <div
                  key={sample.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-200 truncate">
                      {sample.name}
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">{sample.description}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onPreviewSampleProject(sample.id, 'preview')}
                      className="min-h-[38px] px-3 rounded-lg border border-white/[0.1] text-xs text-zinc-200 hover:text-white hover:bg-white/[0.05] inline-flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Preview Demo
                    </button>
                    <button
                      type="button"
                      onClick={() => onCloneSampleProject(sample.id)}
                      className="min-h-[38px] px-3 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-medium inline-flex items-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Clone to My Projects
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
