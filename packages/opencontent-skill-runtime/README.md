# OpenContent skill runtime contracts

Public, MIT-licensed, main-process-only source contracts and adapters for
reviewed OpenContent Content Space behavior.

This package is deliberately not a SciForge domain package: it has no
`sciforge.domain.json`, no root export, and no automatic activation. Its package
manifest exports exact TypeScript source subpaths from `src/`; `src` and this
README are the package contents. The application consumes those subpaths
through its canonical main-process composition and bundling path rather than a
second runtime artifact.

The exported subpaths provide the contract, fixed bundled-asset resolver, one
CLI runner/process seam, reviewed DocFlow/native-document adapters, and the
extended-operation adapter. The runtime admits only module
`sciforge.opencontent-connector` for the transport role and module
`sciforge.opencontent-content-space-provider` for the adapter role. The exact
role/module union rejects cross-role use and every other module.

The supplier attachment is intentionally absent from this public package and
repository surface. The optional private
`@sciforge-internal/opencontent-skill-assets` package owns the reviewed source
asset root; application packaging copies that asset root to
`resources/opencontent/opencontent-base-1.0.1`. The Connector selects source or
packaged resolution through `./main/bundled-assets`; callers cannot provide an
executable path.

`./main/cli-runner` is the canonical supplier transport boundary. It binds the
fixed asset, current Principal assertion, cancellation/deadline,
bounded-output limits, and ephemeral Provider Connection material.
`./main/node-cli-process-port` is the single subprocess implementation: it uses
`shell: false`, materializes a private per-invocation runtime, bounds and parses
one JSON response, streams managed transfers, and recursively cleans the
temporary directory. The disposable copy receives one exact-match auth-refresh
guard that disables the supplier bundle's internal replay; bundle drift fails
before dispatch, so a write is attempted at most once. Missing private assets
fail closed before subprocess dispatch.

The package must not:

- resolve executables from caller-controlled paths or execute snapshot files
  outside the package-owned bundled-asset allowlist;
- register an MCP server, Agent tool, renderer contribution, or IPC channel;
- accept credentials, endpoints, arbitrary local paths, raw Provider IDs, or
  executable command strings in Agent-facing request input, or persist/log
  ephemeral Provider Connection material;
- bypass the Capability Broker, Host Principal, Provider Connection, resource
  grants, file-transfer ports, or durable audit policy.

Per-operation readiness, capability authorization, effect classification,
resource targeting, and write orchestration belong exclusively to the
provider-neutral Content Space Broker/core. This package defines no parallel
policy, proposal, or apply layer; it accepts only an already-admitted typed
Provider request and returns typed, bounded delivery. A resource grant is
necessary but never sufficient: only exact `production_ready`/`available`
readiness can currently admit dispatch. Once both checks pass, a
resource-scoped write needs no second confirmation.

Resource targets and grants are validated by the Content core feature before
adapter dispatch. The Connector runner does not accept or synthesize Broker
lease/grant identifiers.

The source adapters cover basic personal/team content, Team
administration/provisioning, native documents, and extended search,
organization, metadata, share/publish, and permission operations. Coverage is
an implementation inventory, not production readiness, live verification, or
Agent eligibility.

Current OpenContent contract blockers remain outside this runtime's authority
to waive: `updateFileVersion` lacks an exact atomic version CAS; hash-bound
native-document mutations lack an atomic `baseHash` compare-and-mutate;
`observeImmutableVersion` lacks immutable retention and version-specific
retrieval proof. A version number or digest cannot turn a live reference into
an `ArtifactReference`.

This runtime also defines no Cloud Task handoff or Task port. Cloud
Collaboration must supply the Project Content Space Binding, typed Task file
intents, and exact Task-turn resource injection and retirement before that
workflow exists.
