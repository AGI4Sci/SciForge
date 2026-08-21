# OpenContent Connector

Owns existing-account enrollment, Principal-bound connection state, secure Token use, pinned OpenContent schemas, and main-process transport. It exposes no Content Space or Shared Documents business semantics.

The connector ships the reviewed `edoc2-test1-verification` profile as a
compile-time package asset. That profile permanently binds Provider Instance
`opencontent-edoc2-demo` to `https://test1.edoc2.com`; callers can select the
Instance but cannot inject or override its endpoint at runtime. This is a
development endpoint profile, not Content Space operation admission. It does
not make any operation `production_ready`, install a trusted Content Space
verification policy, or allow a caller to enable `poc_only` operations.

The Connector and SciForge-authored `@sciforge/opencontent-skill-runtime` are
public source. Optional supplier assets remain outside the public workspace and
lockfile. Source mode resolves them only below the absolute Host-injected
repository root at
`internal/opencontent/packages/opencontent-skill-assets/assets/opencontent-base-1.0.1`;
before returning that location, the Connector uses the public generic integrity
module to verify the exact `opencontent-attachment-assets` receipt identity,
`internal/opencontent` root, version `1.0.1`, complete inventory, and file digests;
packaged mode resolves them only from
`resources/opencontent/opencontent-base-1.0.1`. Neither mode searches private
`node_modules`, walks ancestors, or falls back to the other mode. Missing or
invalid, changed, extra, unreceipted, or wrong-version assets fail closed before
supplier dispatch.

The removed `opencontent-default` Instance is retired rather than aliased or
migrated. Its Token is never used for `opencontent-edoc2-demo`; the connector
retains cleanup metadata until the owning current Principal can delete the old
credential from secure storage.

## Provider binding attestation

The Connector is the authority for the current node-local OpenContent
Connection. It can issue a token-free v2 binding attestation containing the
exact Provider Instance and complete Principal plus two opaque SHA-256 values:
one identifies the authenticated external subject and one identifies the local
Connection revision. Raw external account identifiers, credentials, and the
Connection ID do not cross the facade as admission input or portable authority.
The public Team-administration contract likewise exposes only bounded DTOs,
schemas, constants, and a token-free bound interface. Credential-bearing
requests, sessions, transport construction, and binding stay package-private to
the Connector main process and are not exported from the public `./main` entry.

An attestation observed during Content Space admission is not sufficient by
itself. The pinned Provider passes that exact expected attestation back through
the same Connector facade for every business operation. Immediately before
remote dispatch, the Connector revalidates the Host Principal, authenticates
the actual current session, observes the current external account, recomputes
the opaque values, and requires an exact match. Unbind, rebind, credential
replacement, account change, or Connection-revision drift fails before the
Provider operation or private Runtime subprocess.

See the [attachment distribution boundary](../../../docs/opencontent-attachment-distribution.md)
for installation, integrity, packaging, and public-release rules, and the
[Content Space architecture guide](../../../docs/content-space-architecture.md)
for the complete call chain.
