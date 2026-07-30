# Design: Add Remote Workspace Host

## Context

The Remote SSH domain already owns laboratory VPN isolation, final-target OpenSSH aliases,
workspace allowlists, opaque target resources, command execution, and SFTP. It deliberately does
not expose aliases or a raw SSH transport to renderer/Agent callers. Separately, AgentRuntime,
controlled processes, Git, workspace files, and Workspace Preview are mature local services, but
their contracts use local path strings and their implementations run in the Electron main process.

A useful remote experience requires placement consistency. File tree, terminal, Git, LSP/search,
Agent tools, and scientific preview must all see the same remote workspace. Running only a Codex
process through SSH leaves local backend services pointed at the wrong filesystem.

Cluster network topology is not uniform. A workspace machine may be unable to reach the internet.
The desktop or a second authorized CPU target may act as egress. This routing is workspace/session
policy, not a Codex-specific environment-variable exception.

## Goals

- Keep the renderer local while all workspace-scoped backend operations use one selected host.
- Reuse the existing Remote SSH VPN, target, authorization, and host-key path.
- Keep `codex`/`claude` runtime identity independent from local/remote placement.
- Recover one logical server session across SSH/VPN interruptions with sequenced replay.
- Support local or authorized-target network egress without giving the workspace server SSH
  credentials or a public listening port.
- Execute scientific preview providers beside remote data and transfer bounded results.
- Preserve one canonical capability/provider path for local and remote workspaces.
- Detect cluster restrictions and expose truthful persistence/capability status.

## Non-Goals

- Mounting the remote filesystem with SSHFS, NFS, or SMB.
- Synchronizing a writable copy of the remote workspace to the desktop.
- Running the workspace server on Slurm compute allocations by default.
- Automating VPN credentials, MFA, SSH host-key acceptance, or cluster elevation.
- Advertising remote Claude support before its adapter and session persistence are verified.
- Providing arbitrary general-purpose network tunnelling to renderer or Agent callers.

## Decisions

### 1. Workspace placement is one generic routing boundary

Core uses a `WorkspaceLocator` containing an opaque host-session identity and a host-interpreted
absolute path. It does not introduce `remote-codex`, SSH aliases in workspace URIs, or core switches
for a target ID. One `WorkspacePlacementRouter` preserves the existing canonical desktop services
when no locator is present and selects a package-contributed `WorkspaceHostClient` only for an
opaque remote locator. A failed remote operation never falls back to the desktop filesystem.

Thread and preview state persist the opaque locator, not a desktop path pretending to name a remote
directory. Human-facing UI may show the sanitized target label and remote path.

### 2. Remote SSH owns bootstrap, not workspace semantics

`@sciforge/domain-remote-ssh` contributes a generic `main.workspace-host-provider`. It resolves an
already-authorized opaque target resource, ensures the VPN environment, uses the canonical
ProxyCommand, uploads a versioned server artifact, verifies its digest, and attaches one byte
stream. It does not reimplement file, terminal, Git, runtime, or preview business contracts.

The generic Workbench, Agent, and workspace-session contracts never receive the SSH alias, SOCKS
endpoint, private deployment directory, or raw stream. The package-owned Remote SSH administration
panel may edit the user's ordinary OpenSSH alias, but activation leaves that package boundary and
issues only an opaque workspace-host resource through the Capability Broker.

### 3. One framed protocol multiplexes requests and events

The desktop and server exchange newline-delimited JSON envelopes for control and bounded JSON
payloads, with explicit base64/binary-range envelopes for file and preview bytes. Every envelope
has a protocol version, connection/session ID, request or event identity, and size limit.

The handshake returns:

- protocol and server versions;
- server instance/session IDs;
- OS, architecture, lifecycle mode, and workspace root;
- supported operation/capability versions;
- installed workspace-server domain contribution versions;
- current event sequence and replay window;
- egress state without endpoint secrets.

Unknown operations and incompatible versions fail before workspace activation.

### 4. Persistence is discovered, not guessed

The bootstrap probes whether a detached per-user process can survive the SSH attach process and
whether a private runtime directory/Unix socket is available.

- `persistent-daemon`: a user-level daemon owns sessions and event journals; SSH runs an attach
  relay. Disconnect does not terminate the server.
- `connection-session`: the same protocol/server runs for the SSH connection lifetime when policy
  forbids a daemon. The UI reports this limitation. Durable Slurm jobs remain independent.

These are capability modes of one server protocol, not separate execution paths. The client does
not silently claim persistence in connection-session mode.

### 5. Reconnect uses session identity and event sequence

Server events are monotonically sequenced and written to a bounded journal before publication. The
client acknowledges a sequence. Reattach supplies the prior session ID and last acknowledged
sequence; the server replays available events or returns a typed replay-gap requiring an
authoritative state refresh.

Approvals and user input remain fail closed. A disconnected turn may continue only while it does
not require a new local decision or expired network lease.

### 6. Network egress is an explicit leased provider

A workspace connection selects:

- `none`;
- `local`: the desktop hosts the outbound relay;
- `remote-target`: another authorized Remote SSH target hosts the outbound relay.

Remote SSH establishes the required forwards. The workspace server receives only a random
loopback endpoint and short-lived bearer lease. It does not receive target aliases or credentials.
Routes expose allowlisted HTTP CONNECT/HTTPS/model-router behavior, not arbitrary inbound access.

Revocation, target revision changes, VPN loss, or lease expiry closes the route and updates the
workspace session. Runtime/model calls receive a stable unavailable error or wait according to
their operation policy; they do not fall back to another route.

For local Model Router access, the desktop exposes a scoped reverse-forward endpoint bound to
loopback. For a CPU egress target, the Remote SSH provider creates an authenticated relay on that
target and a private GPU-to-relay path through the authorized topology.

### 7. The server owns workspace-scoped services

The Linux x64 server owns:

- bounded directory listing/stat/read/range/write with workspace containment and optimistic
  revisions;
- filesystem watch events and replay;
- text search;
- Git status/diff through the existing version-control contract;
- controlled terminal/process sessions;
- the Codex runtime process, managed home, thread/event stores, and remote MCP/worker processes;
- workspace-server domain contributions, including Life Science Preview providers.

The desktop owns layout, editor/preview rendering, approvals, connection UI, local secrets, and
bounded caches.

### 8. Scientific preview is split by existing package boundary

Life Science Preview keeps its renderer entrypoint local. Its provider implementation and worker
engines become an optional workspace-server contribution in the same package/version. The server
reads remote ranges and returns the existing canonical observation/wire shapes. Large binary files
are not copied wholesale; provider and artifact limits remain enforced beside the data.

Generic Workspace Preview host code dispatches through the current Workspace Host. It does not
switch on a domain ID or run a local provider as fallback for a remote asset.

### 9. Server package composition is generated

The domain manifest supports an optional `workspace-server` process entrypoint. Generated
composition projects only that process's contributions into the server bundle. Adding/removing a
remote-capable domain therefore requires no server feature map.

Desktop and server handshake compares the package/module version for every active remote
contribution. Incompatible cohorts fail visibly or trigger deployment of the exact desktop cohort;
they do not load a mismatched backend.

### 10. Model and secret handling is explicit

The server artifact contains no user secrets. Model access is supplied through a selected egress
lease and a scoped runtime token or remote login state. The bootstrap does not copy the desktop
environment, SSH keys, upstream provider secrets, or entire Codex home.

### 11. Cut over legacy remote execution atomically

The production Remote Executor mock/settings/selector path is not extended. Once the Workspace Host
vertical slice covers its real callers, those registrations and settings are removed. Slurm
submission becomes a workspace-server capability using the same remote session and target, not a
parallel MCP SSH implementation.

## Risks and Mitigations

- **Cluster forbids daemons.** Detect and report connection-session mode; keep jobs scheduler-owned.
- **VPN/MFA expires.** Preserve remote session state and reconnect after the existing environment is
  ready; never automate credentials.
- **Egress route leaks access.** Bind loopback only, use short leases and allowlists, redact
  endpoints, and close on target revision change.
- **Large scientific data overwhelms the link.** Execute providers remotely and return bounded
  observations, byte ranges, thumbnails, and tiles.
- **Local and remote contracts drift.** Generate protocol/domain composition and require handshake
  version parity.
- **Remote writes race external edits.** Require content revisions and fail with typed conflicts.
- **Login-node policy disallows heavy work.** Keep parsing bounds and submit compute-heavy work to
  scheduler-backed operations.

## Migration

1. Introduce the generic contracts, placement router, protocol fixtures, and server package.
2. Add the Remote SSH workspace-host provider and deployment/attach lifecycle.
3. Route workspace file/search/Git/terminal services through the generic host.
4. Place Codex on the selected host and verify event replay/approval behavior.
5. Add workspace-server domain composition and Life Science Preview providers.
6. Move the UI to opaque Remote SSH resources and remove Remote Executor settings/MCP/UI.
7. Validate source and packaged desktop paths plus a Linux x64 server artifact.

No compatibility alias or dual production transport remains after cutover.
