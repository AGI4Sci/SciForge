/**
 * Shared class recipes for the identity account surfaces (the account dialog
 * and its Cloud section).
 *
 * Every colour comes from the `--ds-*` token set and every text size is a step
 * on the shared `--ds-text-*` ladder, so these surfaces follow the shell theme
 * without owning a stylesheet. Translucent theme tokens are already
 * alpha-bearing `var()` colours, so the recipes avoid Tailwind opacity
 * modifiers such as `border-accent/40` (Tailwind 3 cannot apply those to
 * `var()` colours).
 */

export const ACCOUNT_PRIMARY_BUTTON_CLASS =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-ds-md font-medium text-accent-foreground transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50'

export const ACCOUNT_SECONDARY_BUTTON_CLASS =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-ds-md font-medium text-ds-ink transition hover:bg-ds-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50'

export const ACCOUNT_GHOST_BUTTON_CLASS =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-ds-sm text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50'

export const ACCOUNT_DANGER_BUTTON_CLASS =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent bg-ds-danger px-3 py-2 text-ds-md font-medium text-white transition enabled:hover:opacity-90 enabled:active:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45'

export const ACCOUNT_ICON_BUTTON_CLASS =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** Square destructive row action (delete). Keeps the shared icon-button geometry. */
export const ACCOUNT_DANGER_ICON_BUTTON_CLASS =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-danger-soft hover:text-ds-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40'

export const ACCOUNT_INPUT_CLASS =
  'w-full rounded-lg border border-ds-border bg-ds-surface-subtle px-3 py-2 text-ds-md text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60'

/** Single-letter avatar for a Local Account or Cloud identity. */
export function accountInitial(displayName: string): string {
  return displayName.trim().charAt(0).toUpperCase() || '?'
}
