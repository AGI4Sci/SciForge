# BioAgent Design System

BioAgent design-system is the shared home for semantic theme tokens and low-level React primitives. It is intentionally small: pages keep their domain layout, while repeated controls and interaction states come from this package.

## Agent quick contract

Use these primitives before adding new page-local controls:

- `Button` / `ActionButton`: icon plus text command buttons with `primary`, `secondary`, `ghost`, `coral`, and `danger` variants.
- `IconButton`: square icon command with `aria-label`, title, and tooltip text from `label`.
- `Badge`: compact status text with `info`, `success`, `warning`, `danger`, `muted`, and `coral`.
- `Card` and `Panel`: framed surfaces for repeated items, summaries, and tool panels.
- `TabBar`: segmented navigation for a small set of modes.
- `SectionHeader`: title, optional icon/subtitle, and optional action slot.
- `EmptyState`: standard empty/loading/recoverable placeholder.
- `Input`, `Select`, `Details`: token-backed form and disclosure primitives.

Theme tokens are semantic CSS variables. Prefer `--surface`, `--surface-muted`, `--surface-raised`, `--border`, `--border-strong`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent`, `--danger`, `--warning`, `--shadow`, `--focus-ring`, `--radius`, and `--space-*` over hard-coded colors or one-off spacing.

The app should mount exactly one theme class, `theme-dark` or `theme-light`, on an ancestor of the UI. Dark is the default through `:root`; light overrides live in the same token layer.

## Human notes

The visual system should feel like a focused scientific workspace: dense enough for repeated work, calm enough for long sessions, and explicit about state. Cards are for individual repeated objects or compact tool panels, not page-sized decoration. Buttons should carry icons when the action is recognizable, and icon-only controls must keep accessible labels.

When extending the system, add semantic tokens before page-local colors. Keep radii at 8px or below unless a component has a strong reason to be softer. New primitives should render without application data and should not import BioAgent runtime, session, or scenario types.
