# Tasks: Add agent-native visual perception and capture

## 1. Contracts and invariants

- [x] 1.1 Define strict shared schemas for native look/capture requests, visual
  source descriptors, immutable snapshots, normalized regions, persisted
  artifacts, failures, and proof summaries.
- [x] 1.2 Define opaque, caller/workspace/turn-scoped snapshot, region,
  artifact, and proof references with integrity validation.
- [x] 1.3 Define runtime-owned inspection/capture proofs and typed completion
  receipts with their digest- and parent-linking rules.
- [x] 1.4 Add schema tests for duplicate IDs, invalid regions, forged
  references, cross-workspace access, unsupported output paths, and malformed
  proof chains.

## 2. Host Core Agent Visual Runtime

- [x] 2.1 Implement one owner-aware `VisualSourceRegistry` with deterministic
  ordering, duplicate rejection, atomic batch activation, and reverse-order
  disposal.
- [x] 2.2 Implement source resolution without domain-ID, plugin-ID, or MIME-type
  switches in Host Core.
- [x] 2.3 Implement immutable snapshot acquisition, digesting, scoped reference
  issuance, bounded retention, and lifecycle cleanup.
- [x] 2.4 Implement `look` orchestration through the configured Model Router
  visual route with strict structured-result and region validation.
- [x] 2.5 Implement deterministic region/full-snapshot capture, safe image
  encoding, workspace-confined atomic persistence, portable reference metadata,
  and provenance.
- [x] 2.6 Normalize unavailable source, stale semantic state, unavailable layout,
  invalid visual output, unsafe destination, and persistence failures into
  stable receipts.

## 3. Native agent tool surface

- [x] 3.1 Add direct `sciforge_look` and `sciforge_capture` definitions to the
  common native Agent Runtime tool surface.
- [x] 3.2 Route Codex and Claude Code calls through the same Agent Visual
  Runtime without duplicating source registries, proof stores, or visual-model
  clients.
- [x] 3.3 Preserve only the four Broker meta-tools plus the two native visual
  tools; reject additional owned native or source-specific tools.
- [x] 3.4 Keep pixel bytes, renderer tokens, provider sessions, Model Router
  credentials, layout revisions, and raw crop coordinates out of normal model
  inputs and outputs.
- [x] 3.5 Add hot-runtime and event-normalization tests proving both runtimes
  emit equivalent typed attempts and receipts.

## 4. Generic source contributions

- [x] 4.1 Add process-safe `VisualSource` contribution contracts to the public
  Domain SDK without exposing Host-private types.
- [x] 4.2 Carry installed-domain source contributions through their standard
  manifest and generated process-specific composition path.
- [x] 4.3 Register Host-built current-surface and Workspace Preview sources
  through the same source registry; admit workspace image paths through the
  same scoped Agent Visual Runtime.
- [x] 4.4 Prove with a fixture contribution that adding or removing a visual
  source requires no Host feature-map, domain-ID switch, or central provider
  edit.
- [x] 4.5 Add boundary tests forbidding domain imports of `src/main`,
  `src/renderer`, `src/shared`, `@shared`, and `@renderer`, and forbidding Core
  imports of concrete installed-domain implementations.

## 5. Surface, artifact, and document migration

- [x] 5.1 Move current Electron surface/target capture behind the Core surface
  `VisualSource`, preserving task binding, redaction, semantic/layout revision
  separation, and on-demand refresh.
- [x] 5.2 Move workspace image loading behind the scoped Agent Visual Runtime,
  preserving workspace confinement, symlink protection, media validation, size
  limits, and digest evidence.
- [x] 5.3 Move PDF page rendering and region cropping behind the canonical
  document/preview-owned `VisualSource` contribution, with no PDF branch in
  Agent Visual Runtime.
- [x] 5.4 Add focused acceptance coverage that locates a method figure, captures
  only the selected region, and rejects a whole-page substitute.
- [x] 5.5 Add non-PDF coverage for at least a visible UI target and a workspace
  image to prove the public contracts are source-agnostic.

## 6. Typed completion and consumer references

- [x] 6.1 Implement runtime storage and resolution for inspection and capture
  proofs; callers cannot submit self-authored proof JSON.
- [x] 6.2 Remove the unused agent-visible Markdown image validator; reserve
  reference-validation receipts for a real typed consumer rather than keeping a
  parallel visual-completion tool.
- [x] 6.3 Extend task completion obligations with typed look, capture,
  region-capture, final-look, and explicit reference-validation requirements.
- [x] 6.4 Verify proof caller scope, order, artifact identity, parent links, and
  final-inspection identity before accepting visual completion.
- [x] 6.5 Add cross-runtime tests rejecting unrelated `sciforge_invoke`
  attestations, file-existence claims, full-page substitutes, mismatched
  artifact references, pre-crop inspection, and self-reported completion.
- [x] 6.6 Fail visibly when required Model Router inspection is unavailable;
  ordinary full-snapshot capture remains distinct from region extraction.
- [x] 6.7 Add one Host-owned candidate-response publication barrier shared by
  Codex and Claude.
- [x] 6.8 Discard candidate assistant output on failed, cancelled, or rejected
  completion and prevent thread reads or replay from reviving it.
- [x] 6.9 Add cross-runtime tests proving unverified success text is hidden and
  a valid native receipt chain publishes the final answer exactly once in event
  order.

## 7. Governance and canonical-path cutover

- [x] 7.1 Update capability governance so exactly
  `sciforge_discover/observe/invoke/events/look/capture` are allowed on the owned
  native surface and flattened product/domain tools remain forbidden.
- [x] 7.2 Update shared execution governance to prefer native visual tools for
  owned supported sources and return structured recovery for prohibited shell
  or OS screenshot fallbacks.
- [x] 7.3 Replace tool-name and text-regex visual completion checks with typed
  native proof receipts.
- [x] 7.4 Remove registered `surface.inspect` and `artifact.inspect` operations
  after native callers migrate.
- [x] 7.5 Remove `gui_pdf_render_image` and the visual-semantic completion use of
  `gui_markdown_validate_images`; keep specialized generation review only where
  it still owns independent release semantics.
- [x] 7.6 Delete retired direct IPC/preload routes, prompt guidance, tool suffix
  allowlists, compatibility exports, forwarding aliases, fallback branches,
  tests, and dead dependencies.
- [x] 7.7 Add an architecture scan that fails if any retired public identifier
  or duplicate visual execution route remains in production source.
- [x] 7.8 Enforce pending native visual proofs in Codex and Claude pre-tool
  hooks using the Host-owned governance snapshot and shared execution governor.

## 8. Composition and generated artifacts

- [x] 8.1 Register Agent Visual Runtime as Host Core and prove it is absent from
  `packages/domains/*`, `sciforge.domain.json`, and the generated installed
  package projections.
- [x] 8.2 Preserve generated composition freshness for existing installed domain
  packages and verify source contributions remain owner-aware and
  process-separated.
- [x] 8.3 Regenerate capability documentation and enforce the exact six-tool
  native surface in capability governance, with no retired production paths.
- [x] 8.4 Extend architecture tests so fixture domain installation changes its
  visual sources but never owns, adds, removes, or duplicates the two native
  visual tools.

## 9. Source and packaged verification

- [x] 9.1 Run focused Core runtime, source registry, Model Router adapter,
  persistence, completion guard, execution governance, domain SDK, document
  provider, and consumer-reference tests.
- [x] 9.2 Run generated domain composition checks, capability governance,
  package-boundary tests, Domain SDK tests/typecheck, installed-domain
  tests/typecheck, root typecheck, and changed-file lint.
- [x] 9.3 Run the complete regression suite and production build.
- [x] 9.4 Extend source Electron smoke coverage to discover both native tools,
  capture a real fixture target, persist a valid cropped PNG, and validate its
  proof chain without external credentials.
- [x] 9.5 Build an unpacked distributable and run the same packaged smoke flow,
  including target-platform image/native binding validation and fail-visible
  Model Router behavior.
- [x] 9.6 Audit the production build for retired visual MCP entrypoints,
  duplicate runtime implementations, shipped TypeScript fallbacks, or missing
  native dependencies.
- [x] 9.7 Review the final diff for old entrypoints, private cross-boundary
  imports, domain hard-coding, duplicate providers, stale generated files,
  dead files, and transitional documentation.
