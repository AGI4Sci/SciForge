# Tasks

- [x] 1. Define the WeChat publication schemas, limits, warning taxonomy and stable Workspace Preview action contract.
- [x] 2. Advertise and invoke the action through the existing Markdown Workspace Preview provider and generic action transport, without a target-specific IPC or preload facade.
- [x] 3. Implement deterministic fixed-theme Markdown HTML rendering with inline styles, safe links, structural elements and readable code.
- [x] 4. Add self-contained MathJax SVG conversion for inline/display formulas with invalid-TeX fallback and bounded warnings.
- [x] 5. Add workspace-safe local image embedding, remote-image warnings, deduplication and payload limits.
- [x] 6. Add the atomic desktop clipboard operation that writes `text/html` and `text/plain` only after successful preflight.
- [x] 7. Add the “复制到公众号” action with running, disabled, success, warning and error states in Markdown Workspace Preview.
- [x] 8. Add focused renderer, provider-action, formula, image, security and clipboard tests.
- [x] 9. Remove the unused legacy rich-copy IPC/preload path so the WeChat action remains the only Markdown clipboard publication path.
- [x] 10. Run package-boundary, generated-composition, capability-governance, Node/Web typecheck, focused regression, changed-file lint, full Electron build and source smoke checks.
- [ ] 11. Complete manual paste acceptance in the current WeChat Official Account editor and inspect its desktop/mobile preview.
