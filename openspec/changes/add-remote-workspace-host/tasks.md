# Tasks: Add Remote Workspace Host

## 1. Contracts and composition

- [x] 1.1 Define versioned Workspace Locator, Workspace Host request/event, session, capability,
  failure, lifecycle-mode, and network-egress contracts with strict bounds.
- [x] 1.2 Add an owner-aware `main.workspace-host-provider` contribution and optional
  `workspace-server` domain entrypoint to public SDK/generated composition.
- [x] 1.3 Add compatibility, duplicate contribution, process-boundary, and generated-freshness
  tests.

## 2. Headless Linux workspace server

- [x] 2.1 Create the Linux x64 server package, handshake, framed JSONL transport, bounded journal,
  request dispatcher, graceful shutdown, and health/status operations.
- [x] 2.2 Implement workspace-contained directory/stat/read/range/write and watch operations with
  optimistic revisions and replayable events.
- [x] 2.3 Implement bounded text search and version-control operations through canonical public
  contracts.
- [x] 2.4 Implement controlled terminal/process sessions with read cursors, truthful degraded
  resize support, cancellation,
  lease cleanup, and no shell-string spawning in the transport layer.
- [x] 2.5 Add persistent-daemon capability probing plus connection-session mode without changing the
  public protocol.

## 3. Remote SSH bootstrap and connection

- [x] 3.1 Extend the package-owned OpenSSH process runner with a controlled streaming process
  contract and deterministic disposal.
- [x] 3.2 Add server artifact manifest/digest verification, atomic per-version deployment, platform
  detection, start/attach, reconnect, heartbeat, replay, and typed failures.
- [x] 3.3 Contribute the Remote SSH workspace-host provider through the manifest and issue opaque
  workspace-session resources behind existing target authorization.
- [x] 3.4 Add VPN reconnect, host-key failure, target revision, deployment mismatch, cancellation,
  and no-daemon regression tests.

## 4. Network egress

- [x] 4.1 Add settings/contracts for `none`, `local`, and authorized `remote-target` egress without
  storing credentials or raw tunnel options.
- [x] 4.2 Implement loopback-only scoped relay leases, local Model Router reverse routing, target
  routing, heartbeat, revocation, expiry, and redaction.
- [x] 4.3 Inject only the leased proxy/model endpoint into remote runtime/worker environments and
  fail closed when the selected route is unavailable.
- [x] 4.4 Test offline GPU plus local egress, offline GPU plus CPU-target egress, route loss,
  cross-workspace denial, and secret redaction.

## 5. Workspace and Agent integration

- [x] 5.1 Add one placement router that retains canonical local services and routes
  file tree/read/write/watch/search through a remote Workspace Host only when a locator is present.
- [x] 5.2 Route Git and Terminal through the current Workspace Host with identical local behavior
  and remote resource ownership.
- [x] 5.3 Make AgentRuntime placement resolve from the thread workspace host while preserving
  `codex` identity, approvals, governance, and replayable events.
- [x] 5.4 Run Codex app-server, managed state, tools, and workspace-relative references on the
  remote server; do not advertise remote Claude.
- [x] 5.5 Add UI connection state, sanitized remote target/path identity, reconnect status, lifecycle
  mode, and explicit egress selection.

## 6. Remote scientific preview

- [x] 6.1 Add `workspace-server` contributions to Life Science Preview and package its provider
  engines in the matching remote artifact.
- [x] 6.2 Route Workspace Preview observe/action/edit/export/artifact/range operations through the
  selected Workspace Host and prohibit local fallback for remote assets.
- [x] 6.3 Preserve local renderer contributions and validate molecular, sequence, omics,
  bioimaging, and spectra parity with bounded remote reads.
- [x] 6.4 Add large-file, range, tile/thumbnail, version conflict, disconnect/replay, and package
  version mismatch tests.

## 7. Canonical cutover and verification

- [x] 7.1 Remove the Remote Executor mock production registration, settings, target selector, and
  duplicate MCP path after callers use Remote Workspace resources.
- [x] 7.2 Update architecture/user documentation and generated capability/domain references for
  VPN, server lifecycle, network egress, remote paths, and scientific preview.
- [x] 7.3 Verify package boundaries, source and packaged composition, Linux x64 artifact manifest,
  focused package tests, full regression tests, typechecks, capability governance, and changed-file
  linting.
- [x] 7.4 Audit for raw SSH aliases outside the package-owned administration surface and in generic
  Workbench/Agent contracts, host-private domain imports, local-path assumptions, duplicate runtime
  transports, stale Remote Executor references, dead files, and compatibility branches.
