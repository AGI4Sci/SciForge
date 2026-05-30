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
        <ContextMenuItem onClick={onCreateFile}>New file</ContextMenuItem>
        <ContextMenuItem onClick={onCreateFolder}>New folder</ContextMenuItem>
      </ContextMenu>
    );
  }

  if (entry.kind === 'folder' || multiSelect) {
    const singleFolder = !multiSelect && entry.kind === 'folder';
    return (
      <ContextMenu x={x} y={y}>
        <ContextMenuItem onClick={onCreateFile}>New file</ContextMenuItem>
        <ContextMenuItem onClick={onCreateFolder}>New folder</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onOpen} disabled={!singleFolder}>Open folder</ContextMenuItem>
        <ContextMenuItem onClick={onToggleFolder} disabled={!singleFolder}>
          {singleFolder && expandedFolders.has(entry.path) ? 'Collapse' : 'Expand'}
        </ContextMenuItem>
        <ContextMenuItem onClick={onRevealInFolder} disabled={multiSelect}>Reveal in Finder</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onReferenceToChat(referenceForWorkspaceEntry(entry))} disabled={multiSelect}>
          <span className="context-menu-item-leading"><Quote size={14} aria-hidden />Add to chat</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCut}>
          <span className="context-menu-item-leading"><Scissors size={14} aria-hidden />Cut{batchLabel}</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopy}>
          <span className="context-menu-item-leading"><ClipboardCopy size={14} aria-hidden />Copy{batchLabel}</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={onPaste} disabled={!canPaste}>
          <span className="context-menu-item-leading"><ClipboardPaste size={14} aria-hidden />Paste</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCopyPath}>Copy path{batchLabel}</ContextMenuItem>
        <ContextMenuItem onClick={onCopyRelativePath}>Copy relative path{batchLabel}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onRename} disabled={multiSelect}>Rename</ContextMenuItem>
        <ContextMenuItem danger onClick={onDelete}>Delete{batchLabel}</ContextMenuItem>
      </ContextMenu>
    );
  }

  return (
    <ContextMenu x={x} y={y}>
      <ContextMenuItem onClick={onOpen}>Open</ContextMenuItem>
      <ContextMenuItem onClick={onOpenInWorkbench}>Open in workspace</ContextMenuItem>
      <ContextMenuItem onClick={onOpenExternal}>Open externally</ContextMenuItem>
      <ContextMenuItem onClick={onRevealInFolder}>Reveal in Finder</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => onReferenceToChat(referenceForWorkspaceEntry(entry))}>
        <span className="context-menu-item-leading"><Quote size={14} aria-hidden />Add to chat</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onCut}>
        <span className="context-menu-item-leading"><Scissors size={14} aria-hidden />Cut</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={onCopy}>
        <span className="context-menu-item-leading"><ClipboardCopy size={14} aria-hidden />Copy</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={onPaste} disabled={!canPaste}>
        <span className="context-menu-item-leading"><ClipboardPaste size={14} aria-hidden />Paste</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onCopyPath}>Copy path</ContextMenuItem>
      <ContextMenuItem onClick={onCopyRelativePath}>Copy relative path</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onRename}>Rename</ContextMenuItem>
      <ContextMenuItem danger onClick={onDelete}>Delete</ContextMenuItem>
    </ContextMenu>
  );
}
