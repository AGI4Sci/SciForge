export const themeClassNames = {
  dark: 'theme-dark',
  light: 'theme-light',
} as const;

export type ThemeName = keyof typeof themeClassNames;

export const semanticTokens = [
  'surface',
  'surface-muted',
  'surface-raised',
  'surface-panel',
  'surface-elevated',
  'surface-input',
  'surface-selected',
  'border',
  'border-muted',
  'border-strong',
  'text-primary',
  'text-secondary',
  'text-muted',
  'text-on-accent',
  'accent',
  'danger',
  'warning',
  'shadow',
  'shadow-soft',
  'focus-ring',
  'radius',
  'space-1',
  'space-2',
  'space-3',
  'space-4',
  'space-5',
  'space-6',
] as const;

export type SemanticToken = (typeof semanticTokens)[number];

export function cssVar(token: SemanticToken) {
  return `var(--${token})`;
}
