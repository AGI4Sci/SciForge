# Remote Workspace Host Requirements

## Requirement: Placement-consistent remote workspace

SciForge SHALL represent a workspace by one opaque Workspace Host session and SHALL execute every
workspace-scoped file, process, version-control, runtime, and preview operation on that host.

### Scenario: Open a cluster directory

- **WHEN** a user opens an authorized directory on a Remote SSH target
- **THEN** the local Workbench SHALL render the directory, files, terminal, Agent, Git, and previews
  using the same remote Workspace Host session
- **AND** SHALL NOT interpret the remote absolute path as a desktop filesystem path.

### Scenario: Local workspace

- **WHEN** a user opens a local directory
- **THEN** the placement router SHALL use the existing canonical desktop services
- **AND** existing local behavior SHALL remain available without crossing the remote wire protocol.

## Requirement: Canonical Remote SSH bootstrap

The Remote SSH domain SHALL be the sole SSH/VPN provider for Workspace Host deployment and
attachment.

### Scenario: VPN-isolated cluster

- **WHEN** the target is reachable only through a configured laboratory VPN environment
- **THEN** server deployment and the live attachment SHALL use the existing environment,
  ProxyCommand, host-key policy, workspace allowlist, and opaque target resource
- **AND** SHALL NOT expose the target alias, SOCKS endpoint, or credentials to generic Workbench,
  Agent, workspace-session contracts, or the remote server
- **AND** the package-owned Remote SSH administration surface MAY edit the user's ordinary
  OpenSSH alias without exposing a raw stream or tunnel.

### Scenario: Duplicate transport

- **WHEN** architecture checks inspect Remote Workspace execution
- **THEN** no Remote Executor MCP, raw renderer SSH, runtime-specific SSH wrapper, or second
  production target registry SHALL provide the same behavior.

## Requirement: Versioned server deployment

SciForge SHALL deploy an integrity-verified server artifact that matches the desktop protocol,
platform, architecture, and active workspace-server domain package cohort.

### Scenario: First connection

- **WHEN** no matching server artifact exists on a supported Linux x64 target
- **THEN** SciForge SHALL upload to a private staging path, verify its manifest and digest, install
  atomically under a versioned user directory, and start or attach without root access.

### Scenario: Incompatible target

- **WHEN** the target platform, architecture, protocol, or package cohort is incompatible
- **THEN** activation SHALL fail with a stable compatibility error before any workspace operation
  runs.

## Requirement: Truthful lifecycle and recovery

SciForge SHALL discover whether the target supports a persistent user daemon and SHALL report the
actual lifecycle mode.

### Scenario: Persistent daemon allowed

- **WHEN** a private user daemon and socket survive the SSH attachment
- **THEN** disconnecting VPN or SSH SHALL leave the server session and journal available for
  reattachment.

### Scenario: Daemon prohibited

- **WHEN** target policy or runtime facilities prohibit a detached daemon
- **THEN** SciForge SHALL use the same protocol in connection-session mode
- **AND** SHALL label the session non-persistent
- **AND** SHALL NOT claim that foreground processes survive disconnect.

### Scenario: Reattach

- **WHEN** a client reconnects with a session ID and last acknowledged event sequence
- **THEN** the server SHALL replay available later events in order
- **AND** return a typed replay-gap when an authoritative refresh is required.

## Requirement: Bounded and revision-safe workspace files

The Workspace Host SHALL contain all file operations within the authorized root, bound payloads,
and use optimistic revisions for writes.

### Scenario: Save a remotely opened file

- **WHEN** the user saves content with the current revision
- **THEN** the remote server SHALL write atomically and publish a sequenced change event.

### Scenario: Concurrent external edit

- **WHEN** the expected revision no longer matches the remote file
- **THEN** the write SHALL fail with a typed conflict and SHALL NOT overwrite the external edit.

### Scenario: Traversal attempt

- **WHEN** a request escapes the workspace through parent segments, symlinks, or an absolute path
  belonging to another root
- **THEN** the server SHALL reject it before reading or writing data.

## Requirement: Remote terminal, search, Git, and Codex

SciForge SHALL execute terminal/process, text search, Git, and remote Codex operations beside the
remote workspace.

### Scenario: Remote terminal

- **WHEN** the user opens Terminal for a remote session
- **THEN** the controlled process SHALL run on the Workspace Host and the local renderer SHALL
  receive only bounded output, cursor, truthful resize-support status, and lifecycle events
- **AND** the initial cohort SHALL NOT claim full PTY parity.

### Scenario: Remote Agent

- **WHEN** a Codex thread belongs to a remote workspace
- **THEN** the Codex app-server, managed state, command/file tools, and workspace-relative
  references SHALL use the remote host
- **AND** its runtime ID SHALL remain `codex`.

### Scenario: Remote Claude unavailable

- **WHEN** the first server cohort has not verified Claude
- **THEN** remote capabilities SHALL report Claude unavailable instead of launching it locally or
  presenting a false remote mode.
