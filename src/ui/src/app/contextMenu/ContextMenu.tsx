import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { fitContextMenuPosition } from './contextMenuPosition';

export function ContextMenu({
  x,
  y,
  children,
  onClick,
}: {
  x: number;
  y: number;
  children: ReactNode;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    setVisible(false);
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    const rect = node.getBoundingClientRect();
    setPosition(fitContextMenuPosition(x, y, rect.width, rect.height));
    setVisible(true);
  }, [x, y]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu context-menu-vscode"
      style={{ left: position.x, top: position.y, visibility: visible ? 'visible' : 'hidden' }}
      role="menu"
      onClick={onClick ?? ((event) => event.stopPropagation())}
    >
      {children}
    </div>,
    document.body,
  );
}

export function ContextMenuItem({
  children,
  onClick,
  disabled,
  danger,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? 'danger' : undefined}
      disabled={disabled}
      title={title}
      onClick={() => {
        if (disabled) return;
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

export function ContextMenuSeparator() {
  return <hr className="context-menu-separator" />;
}

export { clampContextMenuPosition } from './contextMenuPosition';
