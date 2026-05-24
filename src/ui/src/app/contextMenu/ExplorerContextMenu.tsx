import { ClipboardCopy, ClipboardPaste, Quote, Scissors } from 'lucide-react';
import type { SciForgeReference } from '../../domain';
import type { WorkspaceEntry } from '../../api/workspaceClient';
import { referenceForWorkspaceEntry } from '../../../../../packages/support/object-references';
import type { ExplorerSelectedEntry } from '../appShell/explorerSelection';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '../contextMenu/ContextMenu';
import type { WorkspaceClipboardState } from '../contextMenu/workspaceClipboardModel';

export function ExplorerContextMenu({
  x,
  y,
  entry,
  selectedEntries = [],
  expandedFolders,
  clipboard,
  canPaste,
  onOpen,
  onOpenInWorkbench,
  onOpenExternal,
  onRevealInFolder,
  onToggleFolder,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onCopyPath,
  onCopyRelativePath,
  onCut,
  onCopy,
  onPaste,
  onReferenceToChat,
}: {
  x: number;
  y: number;
  entry?: WorkspaceEntry;
  selectedEntries?: ExplorerSelectedEntry[];
  expandedFolders: Set<string>;
  clipboard: WorkspaceClipboardState | null;
  canPaste: boolean;
  onOpen: () => void;
  onOpenInWorkbench: () => void;
  onOpenExternal: () => void;
  onRevealInFolder: () => void;
  onToggleFolder: () => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
  onCopyRelativePath: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onReferenceToChat: (reference: SciForgeReference) => void;
}) {
  const batchCount = selectedEntries.length;
  const multiSelect = batchCount > 1;
  const batchLabel = multiSelect ? ` (${batchCount})` : '';

  if (!entry) {
    return (
      <ContextMenu x={x} y={y}>
        <ContextMenuItem onClick={onCreateFile}>新建文件</ContextMenuItem>
        <ContextMenuItem onClick={onCreateFolder}>新建文件夹</ContextMenuItem>
      </ContextMenu>
    );
  }

  if (entry.kind === 'folder' || multiSelect) {
    const singleFolder = !multiSelect && entry.kind === 'folder';
    return (
      <ContextMenu x={x} y={y}>
        <ContextMenuItem onClick={onCreateFile}>新建文件</ContextMenuItem>
        <ContextMenuItem onClick={onCreateFolder}>新建文件夹</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onOpen} disabled={!singleFolder}>打开文件夹</ContextMenuItem>
        <ContextMenuItem onClick={onToggleFolder} disabled={!singleFolder}>
          {singleFolder && expandedFolders.has(entry.path) ? '折叠' : '展开'}
        </ContextMenuItem>
        <ContextMenuItem onClick={onRevealInFolder} disabled={multiSelect}>在文件管理器中显示</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onReferenceToChat(referenceForWorkspaceEntry(entry))} disabled={multiSelect}>
          <span className="context-menu-item-leading"><Quote size={14} aria-hidden />引用到对话栏</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCut}>
          <span className="context-menu-item-leading"><Scissors size={14} aria-hidden />剪切{batchLabel}</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopy}>
          <span className="context-menu-item-leading"><ClipboardCopy size={14} aria-hidden />复制{batchLabel}</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={onPaste} disabled={!canPaste}>
          <span className="context-menu-item-leading"><ClipboardPaste size={14} aria-hidden />粘贴</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCopyPath}>复制路径{batchLabel}</ContextMenuItem>
        <ContextMenuItem onClick={onCopyRelativePath}>复制相对路径{batchLabel}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onRename} disabled={multiSelect}>重命名</ContextMenuItem>
        <ContextMenuItem danger onClick={onDelete}>删除{batchLabel}</ContextMenuItem>
      </ContextMenu>
    );
  }

  return (
    <ContextMenu x={x} y={y}>
      <ContextMenuItem onClick={onOpen}>打开</ContextMenuItem>
      <ContextMenuItem onClick={onOpenInWorkbench}>在工作台打开</ContextMenuItem>
      <ContextMenuItem onClick={onOpenExternal}>系统默认程序打开</ContextMenuItem>
      <ContextMenuItem onClick={onRevealInFolder}>在文件管理器中显示</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => onReferenceToChat(referenceForWorkspaceEntry(entry))}>
        <span className="context-menu-item-leading"><Quote size={14} aria-hidden />引用到对话栏</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onCut}>
        <span className="context-menu-item-leading"><Scissors size={14} aria-hidden />剪切</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={onCopy}>
        <span className="context-menu-item-leading"><ClipboardCopy size={14} aria-hidden />复制</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={onPaste} disabled={!canPaste}>
        <span className="context-menu-item-leading"><ClipboardPaste size={14} aria-hidden />粘贴</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onCopyPath}>复制路径</ContextMenuItem>
      <ContextMenuItem onClick={onCopyRelativePath}>复制相对路径</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onRename}>重命名</ContextMenuItem>
      <ContextMenuItem danger onClick={onDelete}>删除</ContextMenuItem>
    </ContextMenu>
  );
}
