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
      <span className="delayed-help-progress" aria-hidden>
        <svg viewBox="0 0 24 24" focusable="false">
          <circle className="delayed-help-track" cx="12" cy="12" r="9" />
          <circle className="delayed-help-ring" cx="12" cy="12" r="9" />
        </svg>
      </span>
      <span className="delayed-help-popover" role="tooltip">{help}</span>
    </span>
  );
}
