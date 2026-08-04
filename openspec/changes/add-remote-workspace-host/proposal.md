# Change: Add Remote Workspace Host

## Why

SciForge can currently probe Remote SSH targets, execute bounded non-interactive commands, and
transfer individual files. The Agent runtime, terminal, Git, file services, and Workspace Preview
still assume that a workspace path belongs to the desktop machine. Selecting a remote executor
therefore does not produce a VS Code-style remote workspace: the Agent and remote command may run
against a cluster while the Workbench continues to read local files and launch local processes.

Research clusters also have asymmetric networking. GPU/login machines may have no outbound access,
while the user's desktop or another connected CPU machine can reach model providers and scientific
network services. Remote execution cannot assume that the workspace machine itself is an internet
egress.

This change introduces one versioned Remote Workspace Host protocol. The existing Remote SSH domain
remains the canonical transport and VPN boundary, deploys or attaches to a Linux x64 workspace
server, and exposes an opaque workspace-host session. The local renderer stays local while
workspace-scoped backend operations execute where the files live. A selected local or remote
network-egress provider supplies a loopback proxy to the remote runtime without exposing SSH
credentials or adding another domain transport.

## What Changes

- Add a process-neutral Workspace Host protocol with version/capability handshake, request IDs,
  sequenced events, resumable sessions, bounded payloads, stable failures, and explicit placement.
- Add a Linux x64 headless Workspace Host server for remote files, watches, text search, Git,
  terminal PTYs/processes, Codex runtime transport, and Workspace Preview provider execution.
- Extend the Remote SSH domain with one package-owned workspace-host provider that deploys,
  verifies, starts/attaches, observes, reconnects, and disposes server sessions through the existing
  VPN/OpenSSH path and opaque target resources.
- Keep runtime identity independent from placement: `codex` remains `codex`; a workspace-host
  session selects where its adapter and tools run.
- Add network-egress routes whose endpoint is either the user's local SciForge process or another
  authorized Remote SSH target. The workspace server sees only a leased loopback proxy endpoint.
- Route file tree, read/write/watch, search, Git, terminal, Agent runtime, and supported scientific
  preview operations through one placement router: existing canonical desktop services remain the
  local path, while an opaque locator selects the remote Workspace Host. Per-feature SSH branches
  and remote-to-local fallbacks are prohibited.
- Run Life Science Preview backend providers on the remote workspace host while retaining their
  existing renderer contributions in the local Workbench.
- Retire the mock Remote Executor target/settings/UI path after its remaining callers use the
  Remote SSH workspace-host resource and the canonical capability path.
- Add source/package verification, protocol compatibility tests, reconnect/event-replay tests,
  workspace-boundary tests, egress isolation tests, remote-preview parity tests, and architecture
  checks for duplicate transports and host-private imports.

## Capabilities

### New Capabilities

- `remote-workspace-host`: Defines placement-neutral workspace locators, server bootstrap,
  handshake, durable sessions, replayable events, and remote file/process/runtime operations.
- `workspace-network-egress`: Defines explicit local or authorized-target egress selection,
  loopback-only proxy leases, routing, revocation, and fail-closed behavior.
- `remote-scientific-preview`: Executes package-owned Workspace Preview providers beside remote
  data and transports bounded observations, ranges, and artifacts to the local renderer.

### Modified Capabilities

- `agent-runtime`: Resolves runtime execution through the current Workspace Host while preserving
  the existing runtime-neutral contract and event model.
- `capability-broker`: Issues and governs opaque workspace-host and egress resources; renderer and
  Agent callers do not receive SSH aliases or raw tunnel parameters.
- `domain-module-catalog`: Allows a domain package to declare an optional workspace-server
  contribution from the same versioned package cohort.
- `workspace-preview`: Reads files and invokes providers through the current Workspace Host rather
  than assuming local Node filesystem access.
- `remote-ssh`: Becomes the only SSH bootstrap/transport provider for Remote Workspace sessions;
  its existing probe, VPN, target authorization, and host-key behavior remain authoritative.

## Impact

- Affected code: domain SDK contracts, generated domain composition, Remote SSH main service and
  panel, Workspace Preview host/providers, Agent runtime placement, terminal/process services,
  workspace file/search/Git services, settings, packaging scripts, and focused tests.
- The first supported server platform is Linux x64. Unsupported OS/architecture combinations fail
  before deployment with a stable compatibility error.
- The first remote Agent runtime is Codex. The protocol is runtime-neutral, but Claude is not
  advertised remotely until its backend passes the same contract and reconnect tests.
- Existing local workspaces preserve their current canonical desktop services; only workspaces
  carrying an opaque remote locator cross the Workspace Host protocol.
- VPN credentials and MFA remain in the existing VM/container environment; SSH keys and aliases
  remain on the desktop. The remote server receives neither.
- Remote files are authoritative. Local caches are bounded, revisioned render/read caches and are
  never a second writable workspace replica.
- On disconnect, scheduler jobs and persistent server sessions remain authoritative. Operations
  that require an unavailable approval or egress lease wait or fail closed rather than silently
  changing route.
