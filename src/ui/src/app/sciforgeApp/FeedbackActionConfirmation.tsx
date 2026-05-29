import { Fragment, type ReactNode } from 'react';
import { Badge, type BadgeVariant } from '../uiPrimitives';

export interface FeedbackActionConfirmationRow {
  label: string;
  value: ReactNode;
}

export function FeedbackActionConfirmation({
  actionsClassName,
  ariaLabel,
  badgeLabel = 'confirm',
  badgeVariant = 'warning',
  cancelLabel = '取消',
  className,
  confirmDisabled = false,
  confirmLabel,
  gridClassName,
  impact,
  rows,
  title,
  onCancel,
  onConfirm,
}: {
  actionsClassName: string;
  ariaLabel: string;
  badgeLabel?: ReactNode;
  badgeVariant?: BadgeVariant;
  cancelLabel?: ReactNode;
  className: string;
  confirmDisabled?: boolean;
  confirmLabel: ReactNode;
  gridClassName: string;
  impact: ReactNode;
  rows: FeedbackActionConfirmationRow[];
  title: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className={className} role="alertdialog" aria-label={ariaLabel}>
      <div>
        <Badge variant={badgeVariant}>{badgeLabel}</Badge>
        <strong>{title}</strong>
        <p>{impact}</p>
      </div>
      <div className={gridClassName}>
        {rows.map((row, index) => (
          <Fragment key={`${row.label}-${index}`}>
            <span>{row.label}</span>
            <code>{row.value}</code>
          </Fragment>
        ))}
      </div>
      <div className={actionsClassName}>
        <button type="button" onClick={onConfirm} disabled={confirmDisabled}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </section>
  );
}
