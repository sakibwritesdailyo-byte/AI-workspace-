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
      <div className="px-4 sm:px-6 py-2.5 border-b border-border bg-sunken flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Project workspace views"
          className="inline-flex items-center p-1 rounded-xl bg-raised border border-border"
        >
          <button
            type="button"
            role="tab"
            aria-selected={subView === 'overview'}
            onClick={() => onChangeSubView('overview')}
            className={`min-h-[36px] px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
              subView === 'overview'
                ? 'bg-signal/10 text-signal'
                : 'text-muted hover:text-ink'
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
                ? 'bg-signal/10 text-signal'
                : 'text-muted hover:text-ink'
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
                ? 'bg-signal/10 text-signal'
                : 'text-muted hover:text-ink'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Preview Studio</span>
          </button>
        </div>

        {activeProject && subView === 'overview' && (
          <span className="text-xs text-muted truncate">
            Active: <strong className="text-ink font-medium">{activeProject.name}</strong>
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
              <h1 className="text-xl font-semibold text-ink">Projects</h1>
              <p className="text-xs text-muted mt-1">
                Local-first projects saved in IndexedDB with CodeMirror 6 and sandboxed preview.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onExportWorkspace}
                className="min-h-[40px] px-3 rounded-xl border border-border text-xs font-medium text-ink hover:text-ink hover:bg-surface inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Export All
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[40px] px-3 rounded-xl border border-border text-xs font-medium text-ink hover:text-ink hover:bg-surface inline-flex items-center gap-1.5"
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
                className="min-h-[40px] px-4 rounded-xl bg-signal hover:bg-signal/90 text-on-signal text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <FolderPlus className="w-4 h-4" />
                New Project
              </button>
            </div>
          </div>

          {importError && (
            <div
              role="alert"
              className="rounded-xl border border-border bg-raised px-4 py-2.5 text-xs text-signal"
            >
              {importError}
            </div>
          )}

          {creating && (
            <form
              onSubmit={handleCreateSubmit}
              className="rounded-2xl border border-border bg-raised p-4 space-y-3"
            >
              <h2 className="text-sm font-semibold text-ink">Create Local Project</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="Project name (e.g. Habit Tracker)"
                  aria-label="Project name"
                  className="h-10 px-3 rounded-xl bg-raised border border-border text-xs text-ink placeholder:text-muted focus:outline-none focus:border-signal"
                  autoFocus
                />
                <input
                  type="text"
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  placeholder="Short description (optional)"
                  aria-label="Project description"
                  className="h-10 px-3 rounded-xl bg-raised border border-border text-xs text-ink placeholder:text-muted focus:outline-none focus:border-signal"
                />
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="min-h-[38px] px-3 rounded-lg text-xs text-muted hover:bg-surface"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[38px] px-4 rounded-lg bg-signal hover:bg-signal/90 text-on-signal text-xs font-semibold"
                >
                  Create & Open Code
                </button>
              </div>
            </form>
          )}

          {/* Your Real IndexedDB Projects */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-muted">
              Your Projects ({projects.length})
            </h2>

            {projects.length === 0 ? (
              <div className="py-10 px-4 border-y border-border text-center space-y-3">
                <p className="text-sm font-medium text-ink">No personal projects saved yet</p>
                <p className="text-xs text-muted max-w-md mx-auto">
                  Create a fresh project above, import a JSON bundle, or clone a sample template
                  below.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border border-y border-border">
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
                              className="flex-1 h-9 px-2.5 rounded-lg bg-raised border border-signal text-xs text-ink"
                              autoFocus
                            />
                            <button
                              type="submit"
                              aria-label="Save project rename"
                              className="h-9 px-3 rounded-lg bg-signal text-on-signal text-xs font-semibold inline-flex items-center gap-1"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenamingProjectId(null)}
                              className="h-9 px-2.5 rounded-lg text-xs text-muted hover:bg-surface"
                            >
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-semibold text-ink truncate">
                                {project.name}
                              </h3>
                              {isActive && (
                                <span className="text-xs font-medium text-signal">Active</span>
                              )}
                            </div>
                            <p className="text-xs text-muted mt-0.5 line-clamp-1">
                              {project.description}
                            </p>
                            <p className="text-xs text-muted mt-1 font-mono tabular-nums">
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
                          className="min-h-[40px] px-3 rounded-lg bg-raised hover:bg-surface text-xs font-medium text-ink inline-flex items-center gap-1.5"
                        >
                          <Code2 className="w-3.5 h-3.5 text-signal" />
                          Code
                        </button>

                        <button
                          type="button"
                          onClick={() => onSelectProject(project.id, 'preview')}
                          className="min-h-[40px] px-3 rounded-lg bg-raised hover:bg-surface text-xs font-medium text-ink inline-flex items-center gap-1.5"
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
                          className="min-h-[40px] min-w-[40px] rounded-lg text-muted hover:text-ink hover:bg-surface inline-flex items-center justify-center"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onDuplicateProject(project.id)}
                          aria-label={`Duplicate project ${project.name}`}
                          className="min-h-[40px] min-w-[40px] rounded-lg text-muted hover:text-signal hover:bg-surface inline-flex items-center justify-center"
                        >
                          <CopyPlus className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onExportProject(project)}
                          aria-label={`Export project ${project.name}`}
                          className="min-h-[40px] min-w-[40px] rounded-lg text-muted hover:text-signal hover:bg-surface inline-flex items-center justify-center"
                        >
                          <Download className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onRequestDeleteProject(project)}
                          aria-label={`Delete project ${project.name}`}
                          className="min-h-[40px] min-w-[40px] rounded-lg text-muted hover:text-signal hover:bg-signal/10 inline-flex items-center justify-center"
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
            <section className="space-y-3 pt-3 rounded-xl border border-border bg-sunken p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-xs font-semibold text-muted">
                    Files & Folders · {activeProject.name}
                  </h2>
                  <p className="text-xs text-muted mt-0.5">
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
                    className="min-h-[40px] px-3 rounded-lg border border-border text-xs font-medium text-ink hover:bg-surface inline-flex items-center gap-1.5"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-signal" />
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
                    className="min-h-[40px] px-3 rounded-lg border border-border text-xs font-medium text-ink hover:bg-surface inline-flex items-center gap-1.5"
                  >
                    <FilePlus2 className="w-3.5 h-3.5 text-signal" />
                    New File
                  </button>
                </div>
              </div>

              {(folderValidationError || fileValidationError) && (
                <div
                  role="alert"
                  className="rounded-xl border border-border bg-raised px-3.5 py-2.5 text-xs text-signal"
                >
                  {fileValidationError || folderValidationError}
                </div>
              )}

              {creatingFolder && (
                <form
                  onSubmit={handleCreateFolderSubmit}
                  className="rounded-xl border border-border bg-raised p-3 flex flex-wrap items-center gap-2"
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
                    className="flex-1 min-w-[180px] h-10 px-3 rounded-lg bg-raised border border-border text-xs text-ink"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="min-h-[40px] px-3 rounded-lg bg-signal text-on-signal text-xs font-semibold"
                  >
                    Create Folder
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingFolder(false);
                      setFolderValidationError(null);
                    }}
                    className="min-h-[40px] px-2.5 rounded-lg text-xs text-muted hover:bg-surface"
                  >
                    Cancel
                  </button>
                </form>
              )}

              {creatingFile && (
                <form
                  onSubmit={handleCreateFileSubmit}
                  className="rounded-xl border border-border bg-raised p-3 flex flex-wrap items-center gap-2"
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
                    className="w-36 h-10 px-2.5 rounded-lg bg-raised border border-border text-xs text-ink"
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
                    className="flex-1 min-w-[180px] h-10 px-3 rounded-lg bg-raised border border-border text-xs text-ink"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="min-h-[40px] px-3 rounded-lg bg-signal text-on-signal text-xs font-semibold"
                  >
                    Create & Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingFile(false);
                      setFileValidationError(null);
                    }}
                    className="min-h-[40px] px-2.5 rounded-lg text-xs text-muted hover:bg-surface"
                  >
                    Cancel
                  </button>
                </form>
              )}

              <div className="divide-y divide-border border-y border-border">
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
                              className="h-9 px-2.5 rounded bg-raised border border-signal text-xs text-ink"
                              autoFocus
                            />
                            <button
                              type="submit"
                              className="min-h-[36px] px-2.5 rounded bg-signal text-on-signal text-xs font-semibold"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingFolder(null);
                                setFolderValidationError(null);
                              }}
                              className="min-h-[36px] px-2 rounded text-xs text-muted"
                            >
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <div className="flex items-center gap-2 text-xs font-medium text-ink">
                            <Folder className="w-3.5 h-3.5 text-signal" />
                            <span className="font-mono">{folder}</span>
                            <span className="text-muted">({folderFiles.length})</span>
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
                              className="min-h-[40px] min-w-[40px] rounded-md text-muted hover:text-ink hover:bg-surface inline-flex items-center justify-center"
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
                              className="min-h-[40px] min-w-[40px] rounded-md text-muted hover:text-signal hover:bg-signal/10 disabled:opacity-35 disabled:pointer-events-none inline-flex items-center justify-center"
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
                                      className="h-9 px-2.5 rounded bg-raised border border-signal text-xs text-ink font-mono"
                                      autoFocus
                                    />
                                    <button
                                      type="submit"
                                      className="min-h-[36px] px-2.5 rounded bg-signal text-on-signal text-xs font-semibold"
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRenamingFileId(null);
                                        setFileValidationError(null);
                                      }}
                                      className="min-h-[36px] px-2 rounded text-xs text-muted"
                                    >
                                      Cancel
                                    </button>
                                  </form>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => onSelectFile(file.id, true)}
                                      className={`min-h-[40px] px-2 rounded-lg text-xs font-mono inline-flex items-center gap-2 truncate transition-colors ${ activeFile?.id === file.id ? 'bg-signal/10 text-signal' : 'text-muted hover:text-ink' }`}
                                    >
                                      <FileCode2 className="w-3.5 h-3.5 text-signal/80 shrink-0" />
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
                                        className="min-h-[40px] min-w-[40px] rounded-md text-muted hover:text-ink hover:bg-surface inline-flex items-center justify-center"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      {activeProject.files.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() => onRequestDeleteFile(file)}
                                          aria-label={`Delete file ${file.name}`}
                                          className="min-h-[40px] min-w-[40px] rounded-md text-muted hover:text-signal hover:bg-signal/10 inline-flex items-center justify-center"
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
              <h2 className="text-xs font-semibold text-muted">
                Sample Templates (Demo Reference)
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Read-only demonstration projects. Clone one to save and edit it in your personal
                IndexedDB workspace.
              </p>
            </div>

            <div className="divide-y divide-border border-y border-border">
              {SAMPLE_PROJECTS.map((sample) => (
                <div
                  key={sample.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">
                      {sample.name}
                    </div>
                    <p className="text-xs text-muted mt-0.5">{sample.description}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onPreviewSampleProject(sample.id, 'preview')}
                      className="min-h-[38px] px-3 rounded-lg border border-border text-xs text-ink hover:text-ink hover:bg-surface inline-flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Preview Demo
                    </button>
                    <button
                      type="button"
                      onClick={() => onCloneSampleProject(sample.id)}
                      className="min-h-[38px] px-3 rounded-lg bg-signal/10 hover:bg-signal/15 text-signal text-xs font-medium inline-flex items-center gap-1.5"
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
