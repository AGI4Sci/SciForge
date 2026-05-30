import { Archive, Check, Clock, Folder, FolderOpen, Quote, Square } from 'lucide-react';
import type { SciForgeReference } from '../../domain';
import type { SidebarProjectDescriptor } from '../appShell/sidebarProjectModel';
import type { SidebarLayoutMode, SidebarSortMode } from '../appShell/sidebarPreferences';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ContextMenu';

function menuCheck(active: boolean) {
  return active ? <Check size={13} aria-hidden /> : <span aria-hidden />;
}

function ContextMenuReferenceSection({
  reference,
  onReferenceToChat,
}: {
  reference?: SciForgeReference;
  onReferenceToChat: (reference: SciForgeReference) => void;
}) {
  if (!reference) return null;
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => onReferenceToChat(reference)}>
        <span className="context-menu-item-leading"><Quote size={14} aria-hidden />Add to chat</span>
      </ContextMenuItem>
    </>
  );
}

export function SidebarThreadsGlobalContextMenu({
  x,
  y,
  layout,
  sort,
  reference,
  onArchiveAllChats,
  onApplyLayout,
  onMoveCurrentProjectDown,
  onApplySort,
  onReferenceToChat,
}: {
  x: number;
  y: number;
  layout: SidebarLayoutMode;
  sort: SidebarSortMode;
  reference?: SciForgeReference;
  onArchiveAllChats: () => void;
  onApplyLayout: (layout: SidebarLayoutMode) => void;
  onMoveCurrentProjectDown: () => void;
  onApplySort: (sort: SidebarSortMode) => void;
  onReferenceToChat: (reference: SciForgeReference) => void;
}) {
  return (
    <ContextMenu x={x} y={y}>
      <ContextMenuItem onClick={onArchiveAllChats}>
        <span className="context-menu-item-leading"><Archive size={14} aria-hidden />Archive all chats</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => onApplyLayout('by-project')}>
        <span className="context-menu-item-leading"><Folder size={14} aria-hidden />Group by project</span>
        {menuCheck(layout === 'by-project')}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onApplyLayout('recent-projects')}>
        <span className="context-menu-item-leading"><FolderOpen size={14} aria-hidden />Recent projects</span>
        {menuCheck(layout === 'recent-projects')}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onApplyLayout('chronological')}>
        <span className="context-menu-item-leading"><Clock size={14} aria-hidden />Chronological</span>
        {menuCheck(layout === 'chronological')}
      </ContextMenuItem>
      <ContextMenuItem onClick={onMoveCurrentProjectDown}>
        <span className="context-menu-item-leading">Move current project down</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => onApplySort('createdAt')}>
        <span className="context-menu-item-leading"><Clock size={14} aria-hidden />Sort by created time</span>
        {menuCheck(sort === 'createdAt')}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onApplySort('updatedAt')}>
        <span className="context-menu-item-leading"><Clock size={14} aria-hidden />Sort by updated time</span>
        {menuCheck(sort === 'updatedAt')}
      </ContextMenuItem>
      <ContextMenuReferenceSection reference={reference} onReferenceToChat={onReferenceToChat} />
    </ContextMenu>
  );
}

export function SidebarProjectActionContextMenu({
  x,
  y,
  project,
  reference,
  onRevealInFolder,
  onArchiveChats,
  onCopyPath,
  onCopyRelativePath,
  onRemoveProject,
  onReferenceToChat,
}: {
  x: number;
  y: number;
  project: Pick<SidebarProjectDescriptor, 'id' | 'label' | 'detail' | 'current'>;
  reference?: SciForgeReference;
  onRevealInFolder: () => void;
  onArchiveChats: () => void;
  onCopyPath: () => void;
  onCopyRelativePath: () => void;
  onRemoveProject: () => void;
  onReferenceToChat: (reference: SciForgeReference) => void;
}) {
  return (
    <ContextMenu x={x} y={y}>
      <ContextMenuItem onClick={onRevealInFolder}>
        <span className="context-menu-item-leading"><FolderOpen size={14} aria-hidden />Open in Finder</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={onArchiveChats}>
        <span className="context-menu-item-leading"><Archive size={14} aria-hidden />Archive chats</span>
      </ContextMenuItem>
      <ContextMenuReferenceSection reference={reference} onReferenceToChat={onReferenceToChat} />
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onCopyPath} disabled={!project.detail.trim()}>Copy path</ContextMenuItem>
      <ContextMenuItem onClick={onCopyRelativePath} disabled={!project.detail.trim()}>Copy relative path</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        danger
        onClick={onRemoveProject}
        disabled={project.current}
        title={project.current ? 'Open another workspace before removing this project. Local files are not deleted.' : 'Remove this project from the sidebar. Local files are not deleted.'}
      >
        <span className="context-menu-item-leading"><Square size={14} aria-hidden />Remove from Sidebar</span>
      </ContextMenuItem>
    </ContextMenu>
  );
}

export function SidebarProjectCreateContextMenu({
  x,
  y,
  onNewProject,
  onOpenWorkspace,
  onSetCurrentDirectory,
}: {
  x: number;
  y: number;
  onNewProject: () => void;
  onOpenWorkspace: () => void;
  onSetCurrentDirectory: () => void;
}) {
  return (
    <ContextMenu x={x} y={y}>
      <ContextMenuItem onClick={onNewProject}>New Project...</ContextMenuItem>
      <ContextMenuItem onClick={onOpenWorkspace}>Open Workspace...</ContextMenuItem>
      <ContextMenuItem onClick={onSetCurrentDirectory}>Set Current Directory...</ContextMenuItem>
    </ContextMenu>
  );
}
