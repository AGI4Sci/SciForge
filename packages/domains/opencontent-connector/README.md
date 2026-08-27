# OpenContent Connector

Owns existing-account enrollment, Principal-bound connection state, secure Token use, pinned OpenContent schemas, and main-process transport. It exposes no Content Space or Shared Documents business semantics.

## Enrollment and session boundary

macOS and Windows use the same canonical Connector path:

1. Content Space mounts the OpenContent package-owned enrollment view for the
   selected Provider Instance.
2. The view collects the Human's OpenContent account and password and sends
   them once through the strict, schema-validated `opencontent.connection.bind`
   capability. The capability is tagged `sensitive-input`, is callable only by
   the package-owned UI, and has no parallel IPC or native-addon entrypoint.
3. Connector main authenticates against the absolute HTTPS origin and fixed
   Provider Instance from the package deployment configuration. It discards
   the account and password immediately after that attempt.
4. Connector main persists only the returned Session Token through
   `DomainMainHost.packageSecrets.providerCredentials`. The Host encrypts that
   record through Electron `safeStorage`, backed by Keychain on macOS and DPAPI
   on Windows, and binds it to the exact node, Principal, Provider Instance,
   and Connection. Host API `1.9.0` atomically re-verifies the complete expected
   Principal and cancellation inside the storage lock before credential
   mutations. The Connector re-observes the external subject before it
   reports connected status or issues a binding attestation.
5. On restart, the Connector uses that encrypted Token only inside the Host's
   bounded credential callback and validates it against OpenContent. A valid
   Token restores the connection automatically; an invalid or expired Token
   moves the connection to reauthentication-required and the UI asks for the
   account and password again.

The account and password exist only in the active form/request. Owned mutable
references are cleared when authentication settles, is cancelled, or the view
changes; immutable JavaScript strings cannot be reliably memory-zeroized. They
are never saved in package settings or `localStorage`, and account, password, and Token values
never enter logs, traces, capability receipts, or portable references. The
Session Token never reaches the renderer. The sensitive capability's
idempotency journal retains only a digest of its input, not the input itself. If
Host secure storage is unavailable, enrollment fails closed; the Connector adds
no plaintext file or long-lived credential cache, legacy native enrollment
fallback, or second Connector.

The account and password inputs are sensitive visible-context regions and are
excluded from retained window captures. The Host exact-value redaction registry
holds a Session Token only while a bounded credential-use callback is active;
it scrubs any callback failure before releasing the lease and retains no Token
after status, replace, use, or remove completes.

The package manifest declares one public, package-owned deployment-configuration
contract: contract version `1`, source path
`packages/domains/opencontent-connector/config/opencontent-connector.json`,
packaged Resources path `domain-deployments/opencontent-connector.json`, a
`4096`-byte ceiling, and `publicRelease: allowed`. The configuration is strict
JSON containing only
`contractVersion`, the fixed `opencontent-edoc2-demo` Provider Instance, and an
absolute HTTPS `origin`. Activation requests no-follow semantics where the
platform exposes them and always binds the opened descriptor to the pre-open
regular-file identity. It checks that descriptor before and after a
`4097`-byte-bounded read, rejects identity, size, modification-time,
change-time, or birth-time drift, closes it, and freezes the parsed value.
Missing, oversized, malformed, non-canonical, non-HTTPS, or
symlinked configuration makes Provider-backed calls unavailable before package
settings, credentials, network, or supplier-process access; local credential
deletion through unbind remains available. The integration-owned unavailable view
exposes that same local cleanup only after explicit Human confirmation; it does
not contact the Provider or delete remote files. Provider discovery, capability
definitions, and the internal service descriptor remain registered.
There is no environment, argv, caller, renderer, package-setting,
alternate-path, or fallback endpoint channel.

Source and packaged builds use one generic domain-package deployment
composition that preserves every manifest declaration. Because this Provider
configuration is public package data, a normal Git clone and package tarball
contain it without an out-of-band install. Electron Builder captures that immutable composition
once; after packing it requires each active target to match the captured size
and SHA-256 receipt and each inactive target to be absent. Official public
releases reject every active deployment configuration marked `forbidden`. The
public configuration is inside the package's npm `files` allowlist and its
isolated packaged namespace does not create a supplier overlay.

The public deployment configuration is not an Agent skill and is never supplied
through a private team ZIP. For the normal source workflow, the only optional
out-of-band OpenContent input is the user-provided `opencontent-base.zip` Agent
skill, installed into a Workspace with the generic private-skill installer.
Provider discovery, enrollment, ordinary file operations and Team operations do
not read that ZIP.

The Connector owns the SciForge-authored supplier wire contract, asset
verification, isolated process transport, and runtime snapshot mechanism. Its
public `./main-contract` exposes only the token-free Provider facade and typed
supplier invocations; asset resolution, command running, process control, and
snapshots are package-private. Optional supplier assets remain outside the
public workspace and lockfile. Source mode resolves them only below the absolute Host-injected
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

The supplier overlay is optional Provider functionality, not the Agent skill
installation path. Ordinary personal/Team listing, observation, folder,
upload/download and Team-administration calls use the public `OpenContentClient`
and bound Team port without `useSupplierTransport`. Only native-document and
supplier-backed extended features receive that optional port. Consequently a
missing overlay removes those extra feature contributions but cannot hide the
Provider, block enrollment, or disable ordinary/Team operations. Installing the
raw ZIP under a Workspace's `.codex/skills` directory does not activate the
Connector supplier transport.

The pinned CLI characterization freezes 86 inventory commands and the exact
50-command admitted adapter union. Inventory is not an execution allowlist or
packaged-live claim. The supplier `download`, `file-list`, `kbox-list`,
`file-internal-link`, `meta-modeldata`, and `collab-link` commands remain
inventory-only and cannot reach the process transport; ordinary download and
directory listing use the typed Connector facade, while native PDF export uses
`native-document:export`. Separately, the token-free typed Team Administration facade
exposes no public member-role/ownership operation and no revision/CAS field; the
supplier Team surface provides no atomic expected-state input for SciForge to
promote into an Administration concurrency promise.

The single fixed connection slot is bound to its exact Provider Instance and
current Principal. The Connector never reuses a Token across either identity;
local unbind deletes only that exact Host-managed credential binding.

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
replacement, stable external `id`/`identityId` change, or Connection-revision
drift fails before the Provider operation or Connector-owned supplier
subprocess. Account and display-name metadata may refresh without changing
binding continuity.

## V4 file-transfer boundary

Hierarchy and entry observations are metadata facts only. A hierarchy proof is
collected in one exact current session, is token-free outside the Connector,
and grants no later read or write authority. A download performs the Provider's
real `DownloadCheck` as a separate authorization step and returns only an
opaque, one-use lease. Consuming that lease revalidates the Principal and
binding, opens a fresh current session, performs the byte transfer, and then
cannot be repeated. A denial during `DownloadCheck` fails before any destination
write.

`upload-new` first proves the destination name is absent, performs the real
Provider upload without an overwrite fallback, and accepts success only after
an exact write-after observation matches parent, file identity, name, and size.
An indeterminate transport or mismatched observation is `outcome_unknown` and
is never retried as a new mutation.

See the [attachment distribution boundary](../../../docs/opencontent-attachment-distribution.md)
for installation, integrity, packaging, and public-release rules, and the
[Content Space architecture guide](../../../docs/content-space-architecture.md)
for the complete call chain.
