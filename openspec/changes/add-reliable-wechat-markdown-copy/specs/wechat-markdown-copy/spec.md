# WeChat Markdown Copy Requirements

## Requirement: Explicit one-click publication copy

SciForge SHALL expose one “Copy to WeChat” action for a ready, complete Markdown Workspace Preview.

### Scenario: Ready Markdown document

- **WHEN** a complete Markdown preview is ready
- **THEN** the copy action SHALL be enabled
- **AND** one activation SHALL render and copy the complete document.

### Scenario: Truncated document

- **WHEN** the current Markdown observation is truncated
- **THEN** the copy action SHALL be disabled
- **AND** SciForge SHALL explain that partial content cannot be published as a complete article.

## Requirement: Self-contained WeChat HTML

SciForge SHALL generate a deterministic HTML fragment whose document styling does not depend on external stylesheets, CSS classes, fonts or JavaScript.

### Scenario: Paste into a rich-text editor

- **WHEN** the copied `text/html` representation is pasted into a compatible rich-text editor
- **THEN** headings, paragraphs, quotes, lists, tables, code and images SHALL retain the fixed publication theme through inline styles.

## Requirement: Self-contained mathematical formulas

SciForge SHALL convert Markdown TeX math to self-contained SVG for the WeChat publication target.

### Scenario: Valid formulas

- **WHEN** a document contains inline and display formulas
- **THEN** each formula SHALL be represented by SVG that does not use an external or document-global font cache
- **AND** inline formulas SHALL remain inline while display formulas SHALL remain centered blocks.

### Scenario: Invalid formula

- **WHEN** MathJax cannot convert an expression
- **THEN** the copy operation SHALL preserve a readable escaped TeX fallback
- **AND** SHALL report a bounded warning instead of failing the entire document.

## Requirement: Safe image handling

SciForge SHALL resolve Markdown images without escaping the active workspace or performing implicit remote uploads.

### Scenario: Local raster image

- **WHEN** a Markdown image resolves to an allowed workspace-local raster image within configured limits
- **THEN** the copied HTML SHALL embed a safe data URL.

### Scenario: Unsafe or unavailable image

- **WHEN** an image is outside the workspace, unsafe, missing or oversized
- **THEN** SciForge SHALL omit the unsafe resource while preserving useful alt text
- **AND** SHALL report a bounded warning.

### Scenario: Remote image

- **WHEN** an image uses an HTTPS URL
- **THEN** the first release SHALL leave the URL unchanged
- **AND** SHALL warn that final WeChat import behavior depends on the target editor.

## Requirement: Atomic clipboard publication

SciForge SHALL perform one canonical clipboard write only after rendering and preflight succeed.

### Scenario: Successful copy

- **WHEN** rendering and preflight succeed
- **THEN** SciForge SHALL write the self-contained fragment as `text/html`
- **AND** SHALL write the original Markdown as `text/plain`
- **AND** SHALL return conversion counts, warnings and a completion timestamp.

### Scenario: Rendering failure

- **WHEN** rendering or mandatory preflight fails
- **THEN** SciForge SHALL NOT modify the clipboard
- **AND** SHALL show an actionable error.

## Requirement: Canonical Workspace Preview implementation

SciForge SHALL implement WeChat publication through the existing Markdown Workspace Preview provider and generic action transport.

### Scenario: Provider does not support the action

- **WHEN** the active local or remote provider does not advertise `markdown.copyForWechat`
- **THEN** the renderer SHALL hide the action
- **AND** SHALL NOT call a parallel IPC, preload facade or fallback renderer.
