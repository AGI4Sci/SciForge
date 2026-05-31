import { Archive, Check, Eye, GitBranch, HardDrive, Inbox, Layers, Quote, Square, Tag, type LucideIcon } from 'lucide-react';
import type { SciForgeReference } from '../../domain';
import type { SidebarProjectDescriptor } from '../appShell/sidebarProjectModel';
import type { SidebarVisibleSection, SidebarVisibleSections } from '../appShell/sidebarPreferences';
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
  visibleSections,
  reference,
  onGroupByRepository,
  onToggleVisibleSection,
  onCollapseAll,
  onMarkAllAsRead,
  onReferenceToChat,
}: {
  x: number;
  y: number;
  visibleSections: SidebarVisibleSections;
  reference?: SciForgeReference;
  onGroupByRepository: () => void;
  onToggleVisibleSection: (section: SidebarVisibleSection) => void;
  onCollapseAll: () => void;
  onMarkAllAsRead: () => void;
  onReferenceToChat: (reference: SciForgeReference) => void;
}) {
  return (
    <ContextMenu x={x} y={y}>
      <ContextMenuItem onClick={onGroupByRepository}>
        <span className="context-menu-item-leading"><Layers size={14} aria-hidden />Group by</span>
        <span>Repository</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled>
        <span className="context-menu-item-leading">Show</span>
      </ContextMenuItem>
      <SidebarVisibleSectionItem section="status" label="Status" icon={Eye} visibleSections={visibleSections} onToggle={onToggleVisibleSection} />
      <SidebarVisibleSectionItem section="git" label="Git" icon={GitBranch} visibleSections={visibleSections} onToggle={onToggleVisibleSection} />
      <SidebarVisibleSectionItem section="environment" label="Environment" icon={HardDrive} visibleSections={visibleSections} onToggle={onToggleVisibleSection} />
      <SidebarVisibleSectionItem section="archiveUnread" label="Archive, Unread" icon={Inbox} visibleSections={visibleSections} onToggle={onToggleVisibleSection} />
      <SidebarVisibleSectionItem section="source" label="Source" icon={Tag} visibleSections={visibleSections} onToggle={onToggleVisibleSection} />
      <SidebarVisibleSectionItem section="metadata" label="Metadata" icon={Square} visibleSections={visibleSections} onToggle={onToggleVisibleSection} />
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onCollapseAll}>Collapse All</ContextMenuItem>
      <ContextMenuItem onClick={onMarkAllAsRead}>Mark All as Read</ContextMenuItem>
      <ContextMenuReferenceSection reference={reference} onReferenceToChat={onReferenceToChat} />
    </ContextMenu>
  );
}

function SidebarVisibleSectionItem({
  section,
  label,
  icon: Icon,
  visibleSections,
  onToggle,
}: {
  section: SidebarVisibleSection;
  label: string;
  icon: LucideIcon;
  visibleSections: SidebarVisibleSections;
  onToggle: (section: SidebarVisibleSection) => void;
}) {
  return (
    <ContextMenuItem onClick={() => onToggle(section)}>
      <span className="context-menu-item-leading"><Icon size={14} aria-hidden />{label}</span>
      {menuCheck(visibleSections[section])}
    </ContextMenuItem>
  );
}

export function SidebarProjectActionContextMenu({
  x,
  y,
  project,
  onMarkAllAsRead,
  onArchiveChats,
  onRemoveProject,
}: {
  x: number;
  y: number;
  project: Pick<SidebarProjectDescriptor, 'id' | 'label' | 'detail' | 'current'>;
  onMarkAllAsRead: () => void;
  onArchiveChats: () => void;
  onRemoveProject: () => void;
}) {
  return (
    <ContextMenu x={x} y={y}>
      <ContextMenuItem onClick={onMarkAllAsRead}>
        <span className="context-menu-item-leading"><Check size={14} aria-hidden />Mark All as Read</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={onArchiveChats}>
        <span className="context-menu-item-leading"><Archive size={14} aria-hidden />Archive All</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        danger
        onClick={onRemoveProject}
        title={project.current ? 'Current workspace cannot be removed until another workspace is open. Local files are not deleted.' : 'Remove this project from the sidebar. Local files are not deleted.'}
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
