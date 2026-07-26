# Change: Add agent-native visual perception and capture

## Why

SciForge agents can read and write text directly, but visual work still depends on
several indirect and partially overlapping paths. Visible surfaces use
`surface.inspect`, workspace images use `artifact.inspect`, PDF pages can be
rendered through `gui_pdf_render_image`, and visual-production workers expose
their own review tools. The model must first discover the right subsystem and
then coordinate rendering, region selection, inspection, persistence, and
reference validation across unrelated contracts.

This fragmentation caused a concrete failure: an agent rendered an entire PDF
page, embedded it as the paper's method figure, checked only that the PNG and
Markdown reference existed, and reported completion. The configured visual
router was never called. Adding more PDF-specific prompting would preserve the
same failure mode for browser content, slides, spreadsheets, scientific viewers,
and future visual surfaces.

Visual perception must instead be a small, stable, native agent ability, at the
same level as reading and writing. Source-specific rendering remains extensible,
but the Agent Runtime owns one perception, capture, proof, and completion path.

## What Changes

- Add the direct native agent tools `sciforge_look` and `sciforge_capture` to
  every owned SciForge agent runtime.
- Deliberately supersede the earlier rule that the owned agent tool surface
  contains only `sciforge_discover`, `sciforge_observe`, `sciforge_invoke`, and
  `sciforge_events`. Those four tools remain the only flattened interface for
  product and domain capabilities; `sciforge_look` and `sciforge_capture` are a
  narrowly scoped Host Core exception for universal agent perception.
- Implement one Host-owned Agent Visual Runtime. It is application
  infrastructure, not an independently installable domain package and not a
  generated installed-domain entry.
- Define a generic, owner-aware `VisualSource` SDK contract so built-in surfaces
  and installed domain packages can expose renderable sources without the Host
  knowing domain IDs, MIME-specific behavior, or provider-private state.
- Make `sciforge_look` resolve a source, acquire an immutable visual snapshot,
  route pixels through Model Router's configured visual model, and return typed
  observations, opaque region references, and an attested inspection proof.
- Make `sciforge_capture` materialize a whole snapshot or a region selected by
  `sciforge_look`, persist it within the authorized workspace, and return an
  artifact reference, portable reference data, provenance, digest, and capture
  proof.
- Add a typed completion-proof chain connecting visual inspection, capture, and
  final visual verification. Consumer-owned validators separately verify that
  persisted artifact paths are referenced by their output format.
- Treat the model's final assistant text as a candidate until the Host has
  validated every required terminal receipt. Commit it once on success; discard
  it on failed, cancelled, or unverified completion.
- Feed the Host-owned pending-proof state into runtime pre-tool hooks so
  `view_image` and command execution are denied before dispatch while the native
  visual proof chain is incomplete.
- Re-home existing surface and PDF/image preview rendering behind
  `VisualSource` providers, then delete the old agent-visible inspection and
  PDF-render paths without aliases or fallbacks. Specialized generation release
  review keeps its independent production semantics.
- Update execution governance to direct owned visual work to the native tools,
  deny non-native visual and command paths before dispatch while native proofs
  are pending, and retain receipt observation only for recovery and audit.
- Add architecture, source-build, packaged-build, type-safety, and regression
  coverage for the canonical visual path.

## Capabilities

### New Capabilities

- `agent-native-visual`: Direct, runtime-independent agent perception and capture
  with generic visual sources, Model Router inspection, persisted artifacts,
  typed proofs, and completion validation.

### Modified Capabilities

- `capability-governance`: Allows exactly two Host Core native visual tools in
  addition to the four Broker meta-tools while continuing to reject flattened
  product or domain tools.
- `agent-operation-governance`: Uses typed visual receipts, enforces the complete
  perception-to-reference chain, and routes owned visual fallback attempts back
  to the native tools.
- `domain-module-catalog`: Carries optional generic `VisualSource`
  contributions through the existing manifest and generated composition path;
  it does not install or own the Agent Visual Runtime.
- `workspace-surface-control`: Existing surface rendering becomes a source
  provider for the native visual runtime instead of an agent-visible
  `surface.inspect` capability.

## Impact

- Agent Runtime: two stable native tools, shared runtime-neutral adapters,
  scoped snapshot/region/proof stores, pre-dispatch governance, a Host-owned
  final-response publication barrier, and structured failure receipts.
- Main process: one canonical Agent Visual Runtime, source registry, Model Router
  adapter, workspace artifact persistence, provenance, and lifecycle cleanup.
- Domain SDK and composition: a process-safe `VisualSource` contribution contract
  with owner attribution, deterministic ordering, duplicate rejection, and
  disposal.
- Renderer and domains: existing visible-target publication supplies generic
  source metadata; domain packages implement only their own rendering adapter.
- Model Router: visual requests return schema-validated observations and regions
  bound to the exact snapshot digest.
- Governance and documentation: native-tool allowlist, no-bypass rules, generated
  capability reference, and final-design documentation.
- **BREAKING**: remove `surface.inspect`, `artifact.inspect`,
  `gui_pdf_render_image`, `gui_markdown_validate_images` as an agent completion
  path, visual-review aliases that duplicate native inspection, and old prompt
  guidance. No compatibility forwarding layer is retained.
