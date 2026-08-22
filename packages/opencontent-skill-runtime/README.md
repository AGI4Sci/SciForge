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
executable path. Source resolution uses only the fixed overlay below the
Host-injected repository root and never searches `node_modules`; packaged
resolution uses only the fixed Electron resources path and never falls back to
source. The public runtime is bundled into the Electron main artifact through
package-owned/generated composition metadata rather than a Host vendor switch.
Before supplying a source location to this runtime, the Connector validates the
exact overlay receipt version and complete inventory through the shared public
`@sciforge/internal-runtime-integrity` implementation. The runtime then applies
its fixed required-entrypoint and containment checks; it does not duplicate the
receipt verifier.

Native-document create verification is an exact contract for the
receipt-pinned `1.0.1` snapshot, not a promise about a future supplier release.
That snapshot derives the delivery name by removing file-name-forbidden
characters, trimming, preserving an existing case-insensitive `.mdoc` suffix,
or appending `.mdoc`. A create can succeed only when that exact name is bound to
the requested title and one bound readback contains the requested canonical
JSON content after removing only its top-level supplier `documentHash`. The
Provider package separately verifies that the created file is listed under the
requested parent. The pinned import result exposes no source-identity or
content proof, so native import is blocked before source transfer or subprocess
dispatch and is absent from the executable DocFlow command union.

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

Per-operation readiness, invocation admission, capability authorization, effect
classification, resource targeting, and write orchestration belong exclusively
to the provider-neutral Content Space Broker/core. This package defines no
parallel policy, proposal, or apply layer; it accepts only an already-admitted
typed Provider request and returns typed, bounded delivery. Readiness remains
descriptive (`poc_only`, `blocked_by_contract`, or `production_ready`) even when
one exact verification invocation is admitted. The trusted static profile,
Broker authority, enforced transfer maxima, and any required v2 Provider Binding
Attestation are evaluated outside this runtime; `blocked_by_contract` is never
admissible.

For supplier-backed dispatch, the Provider passes the exact expected token-free
binding attestation through the Connector-owned runtime context. The Connector
reauthenticates the actual current session and recomputes the opaque external
subject and Connection revision immediately before the private subprocess is
started. This runtime cannot mint, select, widen, persist, or waive that
attestation. Once admission and exact resource checks pass, a resource-scoped
write needs no second confirmation.

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
native-document mutations, including `edit`, lack an atomic `baseHash`
compare-and-mutate;
`observeImmutableVersion` lacks immutable retention and version-specific
retrieval proof. A version number or digest cannot turn a live reference into
an `ArtifactReference`.

This runtime also defines no generic Agent Project-provisioning capability,
Cloud Task handoff, or Task port. The provider-neutral Project provisioning SPI
may remain dormant outside this package while its Provider operation is
`blocked_by_contract`. Cloud Collaboration must supply the Project Content
Space Binding, typed Task file intents, and exact Task-turn resource injection
and retirement before those workflows exist.
