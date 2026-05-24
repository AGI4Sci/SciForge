import { useEffect, useState } from 'react';
import { Quote } from 'lucide-react';
import type { SciForgeReference } from '../../domain';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { resolveAppContextMenuReference, shouldSkipAppContextMenu } from './contextMenuModel';

interface AppContextMenuState {
  x: number;
  y: number;
  reference: SciForgeReference;
}

export function AppContextMenuLayer({
  annotationModeActive,
  onReferenceToChat,
}: {
  annotationModeActive: boolean;
  onReferenceToChat: (reference: SciForgeReference) => void;
}) {
  const [menu, setMenu] = useState<AppContextMenuState | null>(null);

  useEffect(() => {
    function handleContextMenu(event: MouseEvent) {
      if (annotationModeActive) return;
      const rawTarget = event.target instanceof Element ? event.target : undefined;
      if (shouldSkipAppContextMenu(rawTarget)) return;
      const reference = resolveAppContextMenuReference(event);
      if (!reference) return;
      event.preventDefault();
      event.stopPropagation();
      setMenu({
        x: event.clientX,
        y: event.clientY,
        reference,
      });
    }
    document.addEventListener('contextmenu', handleContextMenu, true);
    return () => document.removeEventListener('contextmenu', handleContextMenu, true);
  }, [annotationModeActive]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [menu]);

  if (!menu) return null;

  return (
    <ContextMenu x={menu.x} y={menu.y}>
      <ContextMenuItem
        onClick={() => {
          onReferenceToChat(menu.reference);
          setMenu(null);
        }}
      >
        <span className="context-menu-item-leading">
          <Quote size={14} aria-hidden />
          引用到对话栏
        </span>
      </ContextMenuItem>
    </ContextMenu>
  );
}
