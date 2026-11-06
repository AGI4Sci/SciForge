# Client source synchronization — 2026-11-06

This update advances the public client implementation while retaining the established public source boundary. It is a source update, not a signed installer or plugin-market release. The versioned Wiki and the separate documentation website are deliberately unchanged in this update.

## Included changes

- Standalone Scientific Figures `0.4.0-mvp.11`, with immutable data/code/run/image histories, actual isolated Python execution, analysis artifacts, paginated history, interrupted-commit recovery and explicit human candidate acceptance. The canonical tool is `scientific-figures.operation`; generic `nativeExecution` supplies host-bound execution and approval services.
- Independent Anchored Comments `0.2.1` and Change Inspector `0.1.2`, with authenticated workspace/session authority. Change Inspector preserves UTF-8 byte budgets and revision-bound cursors, using the public SDK research-audit schemas.
- Unified built-in Biology Workbench, including preview selection serialization, and current workbench docking and chat/runtime fixes.
- Retirement of the separate Biology Room, Life Science Preview and Visual Review plugin packages, and obsolete Scientific Compute/Dataset API implementations. Their original license texts remain under `docs/licenses/retired/`.
- Current public SDK contracts and shared collaboration client changes. Create Loop and Multi Agent receive patch versions because their distributed contents changed relative to the previous public snapshot.

## Preserved boundary

Cloud server implementation, database migrations, the server-side Zulip adapter, infrastructure, deployment configuration, Remote SSH, internal operational material and private runtime payloads are excluded. Shared collaboration contracts, client identity/collaboration functionality, existing public worker examples and official ACP safety fixtures remain public.

This update descends only from the existing public Git history. Existing public-specific privacy transformations, AF3 explicit configuration and injection protections, reviewed replacement assets and license notices are retained. No private history, deployment credentials, new model weights, installers or native binary artifacts are added. Public keys and contract-pin metadata are not signing secrets.

Six surviving plugin LICENSE files remain unchanged; Anchored Comments carries the existing SciForge-contributor MIT text. The built-in Biology Workbench carries MIT attribution matching its migrated predecessors. Scientific Figures retains its MIT package declaration and the Apache-2.0 worker provenance recorded in its NOTICE. Dependency, platform-native and Python-environment licenses retain their own obligations. The root source license does not grant production or redistribution rights for dependencies with separate terms, including tldraw.

## Validation

Validated on macOS arm64 with Node `26.8.1`:

- Full application Vitest: **6,230 passed, 11 skipped, 0 failed** (540 files). `NODE_OPTIONS=--no-experimental-webstorage` allows the browser test environment to own localStorage on this Node version.
- Scientific Figures: **92 passed, 0 skipped**, using an existing isolated Python interpreter with Matplotlib; no environment download/rebuild is claimed.
- Change Inspector: **77 passed**; public contracts: **25 passed**; public Domain SDK: **170 passed**.
- Public node/web type checks, full ESLint, canonical `npm run build` including native-addon/support build, 17-package composition freshness, 247-action capability governance, package-version audit, and public contract/source-delivery checks passed.
- Clean manifest-only `npm ci --ignore-scripts` passed. This checks lock consistency without claiming an independent clean native lifecycle installation. The build/test checkout uses existing external package installations with public-workspace links.
- Independent read-only review checked restricted paths, new files, license retention, public-only fixtures, AF3 protections and scan findings. Pattern matches were test data or a sample LAN-address placeholder; a pattern scan is not a proof against arbitrary encoded secrets.

No new GUI, real-model, all-platform, notarization, installer publication or plugin-market acceptance is claimed. The unchanged Wiki may describe an older source baseline; its update is a separate task.
