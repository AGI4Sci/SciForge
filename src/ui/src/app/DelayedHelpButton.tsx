import type { ReactNode } from 'react';
import { cx } from './uiPrimitives';

export function DelayedHelpButton({
  children,
  help,
  className,
  disabled,
  onClick,
}: {
  children: ReactNode;
  help: string;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <span className={cx('delayed-help-control', disabled && 'is-disabled')}>
      <button type="button" className={className} onClick={onClick} disabled={disabled}>
        {children}
      </button>
      <span className="delayed-help-popover" role="tooltip">{help}</span>
    </span>
  );
}
