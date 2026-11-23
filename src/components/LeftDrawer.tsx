import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  Mic,
  Pencil,
  Pin,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { SAMPLE_PROJECTS } from '../data/mockWorkspaceData';
import {
  getProjectFolders,
  normalizeFolderPath,
  sortAndFilterConversations,
  validateProjectFilePath,
} from '../state/workspaceReducer';
import type { Conversation, Project, ProjectFile } from '../types/workspace';

interface LeftDrawerProps {
  mobileOpen: boolean;
  desktopOpen: boolean;
  conversations: Conversation[];
  activeConversationId: string | null;
  projects: Project[];
  activeProject: Project | undefined;
  activeFileId: string | null;
  expandedFolders: string[];
  onCloseMobile: () => void;
  onSelectConversation: (conversationId: string) => void;
  onNewChat: () => void;
  onSelectProject: (projectId: string) => void;
  onPreviewSampleProject: (sampleProjectId: string) => void;
  onCreateProject: (name: string) => void;
  onRenameProject: (projectId: string, name: string) => void;
  onDuplicateProject: (projectId: string) => void;
  onRequestDeleteProject: (project: Project) => void;
  onSelectFile: (fileId: string) => void;
  onCreateFile: (folder: string, name: string) => void;
  onRenameFile: (fileId: string, newName: string) => void;
  onRequestDeleteFile: (file: ProjectFile) => void;
  onCreateFolder: (folderPath: string) => void;
  onRenameFolder: (oldPath: string, newPath: string) => void;
  onRequestDeleteFolder: (folderPath: string, fileCount: number) => void;
  onToggleFolder: (folderPath: string) => void;
}

export function LeftDrawer({
  mobileOpen,
  desktopOpen,
  conversations,
  activeConversationId,
  projects,
  activeProject,
  activeFileId,
  expandedFolders,
  onCloseMobile,
  onSelectConversation,
  onNewChat,
  onSelectProject,
  onPreviewSampleProject,
  onCreateProject,
  onRenameProject,
  onDuplicateProject,
  onRequestDeleteProject,
  onSelectFile,
  onCreateFile,
  onRenameFile,
  onRequestDeleteFile,
  onCreateFolder,
  onRenameFolder,
  onRequestDeleteFolder,
  onToggleFolder,
}: LeftDrawerProps) {
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [projectRenameDraft, setProjectRenameDraft] = useState('');

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [folderRenameDraft, setFolderRenameDraft] = useState('');

  const [creatingFile, setCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileFolder, setNewFileFolder] = useState('src');
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [treeValidationError, setTreeValidationError] = useState<string | null>(null);

  const recentConversations = sortAndFilterConversations(conversations, 'all', '').slice(0, 6);
  const folders = activeProject ? getProjectFolders(activeProject) : [];

  const handleProjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    onCreateProject(newProjectName.trim());
    setNewProjectName('');
    setCreatingProject(false);
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

  const handleFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateFolderInput(newFolderPath);
    if (err) {
      setTreeValidationError(err);
      return;
    }
    setTreeValidationError(null);
    const normalized = normalizeFolderPath(newFolderPath);
    onCreateFolder(normalized);
    setNewFileFolder(normalized);
    setNewFolderPath('');
    setCreatingFolder(false);
  };

  const handleFolderRenameSubmit = (e: React.FormEvent, oldPath: string) => {
    e.preventDefault();
    const err = validateFolderInput(folderRenameDraft);
    if (err) {
      setTreeValidationError(err);
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
            setTreeValidationError(
              `Cannot rename folder to "${toPath}" because "${nextFolder}/${file.name}" collides with an existing file.`,
            );
            return;
          }
          seen.add(key);
        }
      }
    }
    setTreeValidationError(null);
    onRenameFolder(oldPath, folderRenameDraft.trim());
    setRenamingFolder(null);
    setFolderRenameDraft('');
  };

  const handleFileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || activeProject.isSample) return;
    const validation = validateProjectFilePath(activeProject, newFileFolder, newFileName);
    if (!validation.ok) {
      setTreeValidationError(validation.error);
      return;
    }
    setTreeValidationError(null);
    onCreateFile(validation.folder, validation.name);
    setNewFileName('');
    setCreatingFile(false);
  };

  const handleRenameSubmit = (e: React.FormEvent, file: ProjectFile) => {
    e.preventDefault();
    if (!activeProject || activeProject.isSample) return;
    const validation = validateProjectFilePath(activeProject, file.folder, renameDraft, file.id);
    if (!validation.ok) {
      setTreeValidationError(validation.error);
      return;
    }
    setTreeValidationError(null);
    onRenameFile(file.id, validation.name);
    setRenamingFileId(null);
    setRenameDraft('');
  };

  const drawerContent = (
    <div className="flex flex-col h-full bg-sunken text-ink select-none">
      {/* Mobile Drawer Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border lg:hidden">
        <span className="text-sm font-semibold text-ink">Threads & Projects</span>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close drawer"
          className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-raised"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {/* Recent Conversations */}
        <div>
          <div className="px-2 mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted">Recent Conversations</p>
            <button
              type="button"
              onClick={() => {
                onNewChat();
                onCloseMobile();
              }}
              aria-label="Create new conversation"
              className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded-md text-muted hover:text-signal hover:bg-raised"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {recentConversations.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted">
              No saved conversations yet. Start a chat to save locally.
            </p>
          ) : (
            <div className="space-y-0.5">
              {recentConversations.map((conv) => {
                const selected = conv.id === activeConversationId;
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => {
                      onSelectConversation(conv.id);
                      onCloseMobile();
                    }}
                    className={`w-full min-h-[38px] px-2.5 py-1.5 rounded-lg border border-transparent flex items-center gap-2 text-left text-[13px] transition-colors ${
                      selected
                        ? 'bg-signal/10 text-signal border-signal'
                        : 'text-muted hover:text-ink hover:bg-raised'
                    }`}
                  >
                    {conv.kind === 'voice' ? (
                      <Mic className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    ) : (
                      <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    )}
                    <span className="flex-1 truncate">{conv.title}</span>
                    {conv.isPinned && (
                      <Pin className="w-3 h-3 text-signal shrink-0" aria-label="Pinned" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <hr className="border-border" />

        {/* Your Projects */}
        <div>
          <div className="px-2 mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted">Your Projects</p>
            <button
              type="button"
              onClick={() => setCreatingProject((prev) => !prev)}
              aria-label="Create new project"
              className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded-md text-muted hover:text-signal hover:bg-raised"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>

          {creatingProject && (
            <form onSubmit={handleProjectSubmit} className="mb-2.5 px-1 space-y-2">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name..."
                aria-label="New project name"
                className="w-full h-9 px-2.5 rounded-lg bg-raised border border-border text-xs text-ink placeholder:text-muted focus:outline-none focus:border-signal"
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="submit"
                  className="flex-1 h-8 rounded-md bg-signal text-on-signal text-xs font-semibold hover:bg-signal/90"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingProject(false)}
                  className="h-8 px-2.5 rounded-md bg-raised text-xs text-muted hover:bg-raised"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {projects.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted">
              No personal projects yet. Create one or clone a sample template below.
            </p>
          ) : (
            <div className="space-y-1">
              {projects.map((project) => {
                const selected =
                  activeProject && !activeProject.isSample && project.id === activeProject.id;
                const isRenaming = renamingProjectId === project.id;

                if (isRenaming) {
                  return (
                    <form
                      key={project.id}
                      onSubmit={(e) => handleProjectRenameSubmit(e, project.id)}
                      className="flex items-center gap-1 px-1 py-1"
                    >
                      <input
                        type="text"
                        value={projectRenameDraft}
                        onChange={(e) => setProjectRenameDraft(e.target.value)}
                        aria-label={`Rename ${project.name}`}
                        className="flex-1 min-w-0 h-8 px-2 rounded bg-raised border border-signal text-xs text-ink"
                        autoFocus
                      />
                      <button
                        type="submit"
                        aria-label="Save project name"
                        className="h-8 w-8 inline-flex items-center justify-center rounded bg-signal text-on-signal"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  );
                }

                return (
                  <div
                    key={project.id}
                    className={`group flex items-center justify-between rounded-lg border border-transparent pr-1 transition-colors ${
                      selected
                        ? 'bg-signal/10 text-signal border-signal'
                        : 'text-muted hover:text-ink hover:bg-raised'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectProject(project.id);
                        onCloseMobile();
                      }}
                      className="flex-1 min-w-0 min-h-[40px] px-2.5 py-2 text-left"
                    >
                      <div className="text-[13px] font-medium truncate">{project.name}</div>
                      <div className="text-xs text-muted truncate mt-0.5">
                        {project.files.length === 1 ? '1 file' : `${project.files.length} files`} ·{' '}
                        {project.framework}
                      </div>
                    </button>

                    <div className="flex items-center opacity-80 lg:opacity-0 lg:group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingProjectId(project.id);
                          setProjectRenameDraft(project.name);
                        }}
                        aria-label={`Rename project ${project.name}`}
                        className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded text-muted hover:text-ink"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDuplicateProject(project.id)}
                        aria-label={`Duplicate project ${project.name}`}
                        className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded text-muted hover:text-signal"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRequestDeleteProject(project)}
                        aria-label={`Delete project ${project.name}`}
                        className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded text-muted hover:text-signal"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Active Project Files & Folders (only when a personal project is active) */}
        {activeProject && !activeProject.isSample && (
          <div>
            <div className="px-2 mb-2 flex items-center justify-between gap-1">
              <p className="text-xs font-medium text-muted truncate">
                Files · {activeProject.name}
              </p>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setCreatingFolder((prev) => !prev);
                    setCreatingFile(false);
                    setTreeValidationError(null);
                  }}
                  aria-label="Create new folder in active project"
                  className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-md text-muted hover:text-signal hover:bg-raised"
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingFile((prev) => !prev);
                    setCreatingFolder(false);
                    setTreeValidationError(null);
                  }}
                  aria-label="Create new file in active project"
                  className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-md text-muted hover:text-signal hover:bg-raised"
                >
                  <FilePlus2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {treeValidationError && (
              <div
                role="alert"
                className="mb-2 mx-1 rounded-lg border border-signal/35 bg-signal/10 px-2.5 py-2 text-xs text-signal"
              >
                {treeValidationError}
              </div>
            )}

            {creatingFolder && (
              <form onSubmit={handleFolderSubmit} className="mb-2.5 px-1 space-y-2">
                <input
                  type="text"
                  value={newFolderPath}
                  onChange={(e) => {
                    setNewFolderPath(e.target.value);
                    setTreeValidationError(null);
                  }}
                  placeholder="src/components"
                  aria-label="New folder path"
                  className="w-full h-9 px-2.5 rounded-lg bg-raised border border-border text-xs text-ink placeholder:text-muted focus:outline-none focus:border-signal"
                  autoFocus
                />
                <div className="flex items-center gap-1.5">
                  <button
                    type="submit"
                    className="flex-1 h-8 rounded-md bg-signal text-on-signal text-xs font-semibold hover:bg-signal/90"
                  >
                    Add Folder
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingFolder(false);
                      setTreeValidationError(null);
                    }}
                    className="h-8 px-2.5 rounded-md bg-raised text-xs text-muted hover:bg-raised"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {creatingFile && (
              <form onSubmit={handleFileSubmit} className="mb-2.5 px-1 space-y-2">
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newFileFolder}
                    onChange={(e) => {
                      setNewFileFolder(e.target.value);
                      setTreeValidationError(null);
                    }}
                    placeholder="src/utils"
                    aria-label="Folder path"
                    className="w-24 h-9 px-2 rounded-lg bg-raised border border-border text-xs text-ink focus:outline-none focus:border-signal"
                  />
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => {
                      setNewFileName(e.target.value);
                      setTreeValidationError(null);
                    }}
                    placeholder="notes.ts"
                    aria-label="New file name"
                    className="flex-1 min-w-0 h-9 px-2.5 rounded-lg bg-raised border border-border text-xs text-ink placeholder:text-muted focus:outline-none focus:border-signal"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="submit"
                    className="flex-1 h-8 rounded-md bg-signal text-on-signal text-xs font-semibold hover:bg-signal/90"
                  >
                    Add File
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingFile(false);
                      setTreeValidationError(null);
                    }}
                    className="h-8 px-2.5 rounded-md bg-raised text-xs text-muted hover:bg-raised"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-1">
              {folders.map((folder) => {
                const isOpen = expandedFolders.includes(folder);
                const folderFiles = activeProject.files.filter((f) => f.folder === folder);
                const isRenamingFolder = renamingFolder === folder;
                const totalSubtreeFiles = activeProject.files.filter(
                  (f) => f.folder === folder || f.folder.startsWith(`${folder}/`),
                ).length;
                const canDeleteFolder =
                  activeProject.files.length - totalSubtreeFiles >= 1;

                return (
                  <div key={folder}>
                    {isRenamingFolder ? (
                      <form
                        onSubmit={(e) => handleFolderRenameSubmit(e, folder)}
                        className="flex items-center gap-1 py-1 px-1"
                      >
                        <input
                          type="text"
                          value={folderRenameDraft}
                          onChange={(e) => setFolderRenameDraft(e.target.value)}
                          aria-label={`Rename folder ${folder}`}
                          className="flex-1 min-w-0 h-8 px-2 rounded bg-raised border border-signal text-xs text-ink"
                          autoFocus
                        />
                        <button
                          type="submit"
                          aria-label="Save folder name"
                          className="h-8 px-2 rounded bg-signal text-on-signal text-xs font-semibold"
                        >
                          Save
                        </button>
                      </form>
                    ) : (
                      <div className="group flex items-center justify-between rounded-md pr-1 hover:bg-raised">
                        <button
                          type="button"
                          onClick={() => onToggleFolder(folder)}
                          aria-expanded={isOpen}
                          className="flex-1 min-w-0 min-h-[36px] px-2 py-1.5 flex items-center gap-2 text-xs font-medium text-muted"
                        >
                          {isOpen ? (
                            <ChevronDown className="w-3.5 h-3.5 text-muted shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-muted shrink-0" />
                          )}
                          {isOpen ? (
                            <FolderOpen className="w-3.5 h-3.5 text-signal/80 shrink-0" />
                          ) : (
                            <Folder className="w-3.5 h-3.5 text-muted shrink-0" />
                          )}
                          <span className="truncate">{folder}</span>
                        </button>

                        <div className="flex items-center opacity-80 lg:opacity-0 lg:group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingFolder(folder);
                              setFolderRenameDraft(folder);
                              setTreeValidationError(null);
                            }}
                            aria-label={`Rename folder ${folder}`}
                            className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded text-muted hover:text-ink"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!canDeleteFolder}
                            onClick={() => onRequestDeleteFolder(folder, totalSubtreeFiles)}
                            aria-label={
                              canDeleteFolder
                                ? `Delete folder ${folder}`
                                : `Cannot delete ${folder}: keep at least 1 file in project`
                            }
                            title={
                              canDeleteFolder
                                ? `Delete folder ${folder}`
                                : 'Keep at least 1 file in project'
                            }
                            className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded text-muted hover:text-signal disabled:opacity-35 disabled:pointer-events-none"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {isOpen && (
                      <div className="mt-0.5 ml-3 pl-2.5 border-l border-border space-y-0.5">
                        {folderFiles.length === 0 ? (
                          <p className="px-2 py-1 text-xs text-muted italic">Empty folder</p>
                        ) : (
                          folderFiles.map((file) => {
                            const isSelected = file.id === activeFileId;
                            const isRenaming = renamingFileId === file.id;

                            if (isRenaming) {
                              return (
                                <form
                                  key={file.id}
                                  onSubmit={(e) => handleRenameSubmit(e, file)}
                                  className="flex items-center gap-1 py-1"
                                >
                                  <input
                                    type="text"
                                    value={renameDraft}
                                    onChange={(e) => {
                                      setRenameDraft(e.target.value);
                                      setTreeValidationError(null);
                                    }}
                                    aria-label={`Rename ${file.name}`}
                                    className="flex-1 min-w-0 h-8 px-2 rounded bg-raised border border-signal text-xs text-ink"
                                    autoFocus
                                  />
                                  <button
                                    type="submit"
                                    className="h-8 px-2 rounded bg-signal text-on-signal text-xs font-semibold"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRenamingFileId(null);
                                      setTreeValidationError(null);
                                    }}
                                    className="h-8 px-2 rounded text-xs text-muted"
                                  >
                                    Cancel
                                  </button>
                                </form>
                              );
                            }

                            return (
                              <div
                                key={file.id}
                                className={`group flex items-center justify-between rounded-md border border-transparent pr-1 ${
                                  isSelected
                                    ? 'bg-signal/10 text-signal border-signal'
                                    : 'hover:bg-raised'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    onSelectFile(file.id);
                                    onCloseMobile();
                                  }}
                                  className="flex-1 min-w-0 min-h-[38px] px-2 py-1.5 flex items-center gap-2 text-left text-xs font-mono"
                                >
                                  <FileCode2 className="w-3.5 h-3.5 shrink-0 opacity-80" />
                                  <span className="truncate">{file.name}</span>
                                </button>

                                <div className="flex items-center opacity-80 lg:opacity-0 lg:group-hover:opacity-100 focus-within:opacity-100">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRenamingFileId(file.id);
                                      setRenameDraft(file.name);
                                      setTreeValidationError(null);
                                    }}
                                    aria-label={`Rename ${file.name}`}
                                    className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded text-muted hover:text-ink"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  {activeProject.files.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => onRequestDeleteFile(file)}
                                      aria-label={`Delete ${file.name}`}
                                      className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded text-muted hover:text-signal"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <hr className="border-border" />

        {/* Clearly separated Sample Templates */}
        <div>
          <p className="px-2 mb-1.5 text-xs font-medium text-muted">
            Sample Templates (Demo)
          </p>
          <div className="space-y-1">
            {SAMPLE_PROJECTS.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => {
                  onPreviewSampleProject(sample.id);
                  onCloseMobile();
                }}
                className="w-full min-h-[36px] px-2.5 py-1.5 rounded-lg text-left text-xs text-muted hover:text-ink hover:bg-raised transition-colors"
              >
                <div className="truncate font-medium">{sample.name}</div>
                <div className="text-xs text-muted">Demo reference · Read-only</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {desktopOpen && (
        <aside
          aria-label="Conversations and projects drawer"
          className="hidden lg:block w-[272px] shrink-0 border-r border-border h-full overflow-hidden"
        >
          {drawerContent}
        </aside>
      )}

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            aria-hidden="true"
            onClick={onCloseMobile}
            className="fixed inset-0 bg-ink/60 backdrop-blur-sm"
          />
          <aside
            aria-label="Conversations and projects drawer"
            className="relative z-10 w-[296px] max-w-[85vw] h-full border-r border-border"
          >
            {drawerContent}
          </aside>
        </div>
      )}
    </>
  );
}
