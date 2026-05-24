import { Archive, Check, Clock, Edit3, Folder, FolderOpen, Pin, Quote, Square } from 'lucide-react';
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
        <span className="context-menu-item-leading"><Quote size={14} aria-hidden />引用到对话栏</span>
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
        <span className="context-menu-item-leading"><Archive size={14} aria-hidden />归档所有聊天</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => onApplyLayout('by-project')}>
        <span className="context-menu-item-leading"><Folder size={14} aria-hidden />按项目整理</span>
        {menuCheck(layout === 'by-project')}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onApplyLayout('recent-projects')}>
        <span className="context-menu-item-leading"><FolderOpen size={14} aria-hidden />近期项目</span>
        {menuCheck(layout === 'recent-projects')}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onApplyLayout('chronological')}>
        <span className="context-menu-item-leading"><Clock size={14} aria-hidden />按时间顺序</span>
        {menuCheck(layout === 'chronological')}
      </ContextMenuItem>
      <ContextMenuItem onClick={onMoveCurrentProjectDown}>
        <span className="context-menu-item-leading">下移当前项目</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => onApplySort('createdAt')}>
        <span className="context-menu-item-leading"><Clock size={14} aria-hidden />按创建时间排序</span>
        {menuCheck(sort === 'createdAt')}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onApplySort('updatedAt')}>
        <span className="context-menu-item-leading"><Clock size={14} aria-hidden />按更新时间排序</span>
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
  onPinProject,
  onRevealInFolder,
  onRenameProject,
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
  onPinProject: () => void;
  onRevealInFolder: () => void;
  onRenameProject: () => void;
  onArchiveChats: () => void;
  onCopyPath: () => void;
  onCopyRelativePath: () => void;
  onRemoveProject: () => void;
  onReferenceToChat: (reference: SciForgeReference) => void;
}) {
  return (
    <ContextMenu x={x} y={y}>
      <ContextMenuItem onClick={onPinProject}>
        <span className="context-menu-item-leading"><Pin size={14} aria-hidden />置顶项目</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={onRevealInFolder}>
        <span className="context-menu-item-leading"><FolderOpen size={14} aria-hidden />在“访达”中打开</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={onRenameProject}>
        <span className="context-menu-item-leading"><Edit3 size={14} aria-hidden />重命名项目</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={onArchiveChats}>
        <span className="context-menu-item-leading"><Archive size={14} aria-hidden />归档对话</span>
      </ContextMenuItem>
      <ContextMenuReferenceSection reference={reference} onReferenceToChat={onReferenceToChat} />
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onCopyPath} disabled={!project.detail.trim()}>复制路径</ContextMenuItem>
      <ContextMenuItem onClick={onCopyRelativePath} disabled={!project.detail.trim()}>复制相对路径</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem danger onClick={onRemoveProject} disabled={project.current}>
        <span className="context-menu-item-leading"><Square size={14} aria-hidden />移除</span>
      </ContextMenuItem>
    </ContextMenu>
  );
}

export function SidebarProjectCreateContextMenu({
  x,
  y,
  onCreateBlankProject,
  onUseExistingFolder,
}: {
  x: number;
  y: number;
  onCreateBlankProject: () => void;
  onUseExistingFolder: () => void;
}) {
  return (
    <ContextMenu x={x} y={y}>
      <ContextMenuItem onClick={onCreateBlankProject}>新建空白项目</ContextMenuItem>
      <ContextMenuItem onClick={onUseExistingFolder}>使用现有文件夹</ContextMenuItem>
    </ContextMenu>
  );
}
