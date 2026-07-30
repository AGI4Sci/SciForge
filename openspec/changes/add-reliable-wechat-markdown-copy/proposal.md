# Change: Add reliable one-click WeChat Markdown copy

## Why

SciForge renders scientific Markdown well inside the application, but copying the rendered document to a WeChat Official Account loses styles and mathematical formulas because the target editor does not preserve Markdown, external stylesheets, or KaTeX's class-dependent HTML. Users currently need a separate publishing tool even when the complete source document is already open in Workspace Preview.

## What Changes

- Add one explicit “Copy to WeChat” action for complete, non-truncated Markdown workspace previews.
- Render a deterministic single-theme WeChat publication fragment with inline styles rather than copying the live preview DOM.
- Convert inline and display TeX formulas to self-contained MathJax SVG with no external font cache.
- Resolve safe local images through the canonical workspace boundary and embed them in the clipboard HTML.
- Preserve readable headings, paragraphs, quotes, nested lists, tables, links, inline code, fenced code and horizontal rules with WeChat-safe markup.
- Preflight the result and return bounded warnings for unsupported raw HTML, unresolved or remote images, invalid formulas, oversized output and other lossy conversions.
- Write both `text/html` and Markdown `text/plain` representations to the system clipboard through one canonical copy operation.
- Keep the first release deliberately theme-free: one maintained publication profile, no custom CSS, image hosting, draft API, or direct account integration.

## Impact

- Affected Markdown Workspace Preview UI and renderer action contracts.
- Affected publication rendering and clipboard capability in the trusted desktop runtime.
- The existing Markdown Workspace Preview provider owns the action and canonical renderer in the first release; no second preview registration, target-specific IPC, or partial domain extraction is introduced.
- Existing HTML/PDF/DOCX/LaTeX export behavior remains unchanged and shares the canonical Markdown resource and safety helpers.
- New permissively licensed rendering dependencies for MathJax SVG, CSS inlining and code highlighting; Markdown Nice GPL source is used only as behavioral research and is not copied.
