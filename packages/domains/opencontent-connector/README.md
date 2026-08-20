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

See the [attachment distribution boundary](../../../docs/opencontent-attachment-distribution.md)
for installation, integrity, packaging, and public-release rules.
