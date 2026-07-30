# Design: Reliable one-click WeChat Markdown copy

## Goals

- Make one user click produce clipboard HTML that can be pasted directly into the WeChat Official Account editor.
- Keep formulas, local images, code, tables and nested document structure readable without external CSS, fonts or JavaScript.
- Make the output deterministic, testable and independent from transient preview DOM state.
- Return actionable warnings instead of silently dropping unsupported content.
- Preserve a single canonical Markdown-to-publication and clipboard-write path.

## Non-goals

- Markdown Nice theme parity, a theme marketplace or arbitrary custom CSS.
- Image-hosting accounts, watermarking, direct WeChat authentication or draft submission.
- Pixel-identical reproduction of the in-app preview.
- Executing raw HTML, scripts, embedded iframes or active SVG from the source document.
- Guaranteed preservation of links that WeChat policy itself removes.

## Architecture

### Ownership and action path

The first release extends the existing built-in Markdown Workspace Preview provider rather than partially extracting a new domain package. The current viewer depends on Host-private editing, annotation and resource UI; a complete package migration requires a separate architectural change that first publishes those generic contracts and then removes the built-in implementation atomically.

The main-process Markdown provider owns deterministic rendering, workspace-bounded resource resolution, preflight and clipboard publication. The renderer invokes it through the existing generic Workspace Preview action transport. Do not add a WeChat-specific IPC or preload facade.

The stable action ID is:

- `markdown.copyForWechat`

The action is advertised only by a local provider that can complete the operation and is visible only for a ready Markdown preview. It is disabled for truncated observations because publishing partial content as a complete article would be misleading. Remote providers do not advertise the action until a desktop-owned clipboard handoff contract exists.

### Canonical publication pipeline

```text
Markdown source
  -> delimiter normalization and Markdown parse
  -> safe resource resolution
  -> formula conversion to self-contained SVG
  -> fixed publication-theme rendering with inline styles
  -> compatibility cleanup and bounded preflight
  -> clipboard write(text/html + text/plain)
```

The pipeline consumes the source Markdown, absolute source path and workspace locator/root. It returns:

- self-contained HTML fragment;
- original Markdown plain text;
- counts for formulas and embedded images;
- bounded structured warnings;
- output byte estimate and completion timestamp.

The same renderer is the only producer for this target. The UI never serializes or post-processes the live React preview.

### Inline styling

The first release uses a fixed, versioned stylesheet that is applied by a deterministic CSS inliner after Markdown, MathJax and code rendering. The final preflight strips temporary classes and rejects any remaining `<style>` block, CSS variable, pseudo-element dependency, animation, fixed positioning or script.

The compatibility vocabulary is deliberately small:

- `article`, `section`, `h1`–`h4`, `p`, `span`, `strong`, `em`, `del`;
- `blockquote`, `ul`, `ol`, `li`;
- `table`, `thead`, `tbody`, `tr`, `th`, `td`;
- `pre`, `code`, `hr`, `a`, `img`, and self-contained formula `svg`.

Unsupported headings are normalized without changing their text. Raw HTML is emitted as escaped text or omitted according to the existing safe Markdown policy and produces a warning.

### Formula conversion

The publishing renderer does not reuse KaTeX HTML from the live preview. It parses math nodes, converts each unique expression with MathJax SVG output and configures `fontCache: none` so glyph paths are self-contained.

Inline formulas are wrapped in an inline container aligned to the text baseline. Display formulas use a centered, horizontally scrollable block container. Width, height, `viewBox`, fill/stroke and the minimal MathJax SVG style rules are embedded in the copied fragment.

Invalid TeX does not fail the whole copy. The renderer emits a readable escaped TeX fallback and a warning with a bounded formula index, never the full document. Dangerous TeX packages and commands that can emit active links, HTML or styles are not loaded.

### Images

Local image paths are resolved relative to the Markdown file and read only through the canonical workspace-safe resource boundary. Allowed raster images are embedded as safe data URLs. Unsafe MIME types, paths outside the workspace, missing images and oversized image payloads produce warnings.

Remote HTTPS images remain remote in the first release and produce a warning because WeChat may import or reject them independently. The renderer does not fetch arbitrary remote images and does not silently upload anything.

### Clipboard operation

The explicit user action invokes one capability that renders and writes the final payload to the desktop clipboard as:

- `text/html`: the self-contained publication fragment;
- `text/plain`: the original Markdown source.

Clipboard failure returns an error and leaves no success toast. The renderer shows a success result with conversion counts and, when present, a compact warning summary.

### Limits and failure handling

- Refuse truncated observations.
- Bound Markdown input, number of formulas/images, individual resource size, total embedded bytes and returned warnings.
- Deduplicate identical formulas and image resources during rendering.
- Reject unsafe URLs and active media.
- Never execute source HTML or SVG.
- Preserve the previous clipboard when rendering or validation fails before the final write.

## User experience

The ready Markdown preview exposes a single primary action labeled “复制到公众号”. While running, the action is disabled and shows progress. On success it reports “已复制，可粘贴到公众号”; warnings remain inspectable without requiring a second confirmation.

There are no theme or advanced-setting controls in the first release.

## Verification

- Golden fragment tests for headings, nested lists, quotes, tables, inline/fenced code and links.
- Formula tests for inline/display SVG, self-contained glyphs, deduplication and invalid TeX fallback.
- Image tests for local embedding, path escape, unsafe data URLs, remote images and size limits.
- Security tests proving raw HTML/scripts and active SVG cannot enter clipboard HTML.
- Clipboard tests asserting one `text/html` plus `text/plain` write and no write on preflight failure.
- Renderer tests for visibility, disabled/truncated/running states, success and warning/error feedback.
- Domain manifest, generated composition, package boundary, typecheck, focused regression and packaged-path checks.
- Manual acceptance by pasting a representative scientific article into the current WeChat Official Account editor and checking desktop/mobile previews.
