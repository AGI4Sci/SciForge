import type {
  ButtonHTMLAttributes,
  DetailsHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import React from 'react';
import type { LucideIcon } from 'lucide-react';

export * from './tokens';

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'coral';

export function Badge({
  children,
  variant = 'info',
  glow = false,
  className = '',
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  glow?: boolean;
  className?: string;
}) {
  return <span className={cx('badge', `badge-${variant}`, glow && 'badge-glow', className)}>{children}</span>;
}

export function Card({
  children,
  className = '',
  onClick,
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <section {...props} className={cx('card', onClick && 'clickable', className)} onClick={onClick}>
      {children}
    </section>
  );
}

export function Panel({ children, className = '', ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section {...props} className={cx('panel', className)}>
      {children}
    </section>
  );
}

export function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  className = '',
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={cx('icon-button', className)}
      onClick={onClick}
      title={label}
      aria-label={label}
      data-tooltip={label}
      disabled={disabled}
    >
      <Icon size={17} />
    </button>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'coral' | 'danger';

export function Button({
  icon: Icon,
  children,
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  children: ReactNode;
  variant?: ButtonVariant;
}) {
  return (
    <button {...props} className={cx('action-button', `action-${variant}`, className)}>
      {Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
}

export const ActionButton = Button;

export function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  action,
  className = '',
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('section-header', className)}>
      <div className="section-title-wrap">
        {Icon ? (
          <div className="section-icon">
            <Icon size={18} />
          </div>
        ) : null}
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
  className = '',
}: {
  tabs: Array<{ id: T; label: string; icon?: LucideIcon }>;
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('tabbar', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={cx('tab', active === tab.id && 'active')}
          onClick={() => onChange(tab.id)}
          title={tab.label}
          data-tooltip={tab.label}
          role="tab"
          aria-selected={active === tab.id}
        >
          {tab.icon ? <tab.icon size={14} /> : null}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  label = 'empty',
  title,
  detail,
  children,
  compact = false,
  className = '',
}: {
  label?: string;
  title: string;
  detail?: string;
  children?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('empty-runtime-state', compact && 'compact', className)}>
      <Badge variant="muted">{label}</Badge>
      <strong>{title}</strong>
      {detail ? <p>{detail}</p> : null}
      {children}
    </div>
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('ds-input', className)} />;
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select {...props} className={cx('ds-select', className)}>
      {children}
    </select>
  );
}

export function Details({
  summary,
  children,
  className = '',
  ...props
}: DetailsHTMLAttributes<HTMLDetailsElement> & { summary: ReactNode; children: ReactNode }) {
  return (
    <details {...props} className={cx('ds-details', className)}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
