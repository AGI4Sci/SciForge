# OpenContent Content Space Provider

Adapts the OpenContent Connector to Content Space without moving integration ownership into
Content Space.

- The main entry maps the Connector's token-free facade into the provider-neutral
  `ContentSpaceProvider` contract.
- The renderer entry contributes the Connector-owned enrollment fragment to the
  provider-neutral `content-space.provider-enrollment-view` slot.
- The Provider package owns every supplier-receipt-to-Content-Space semantic adapter. It selects by Provider Kind and forwards the exact Provider Instance Ref chosen by
  Content Space. It never receives a token, password, endpoint, or connection ID.
- The Connector's strict package-owned deployment sidecar is the only origin
  channel. This adapter never constructs a fallback or parallel client. When
  configuration is missing or invalid, discovery remains composed and its
  ordinary, Team, and supplier calls all receive `provider_unavailable` from
  the same Connector facade before settings, credentials, network, or process
  work.

The binding remains owned by the Connector and scoped to the current Local Account, this device,
and the selected Provider Instance. The external OpenContent account is not a SciForge identity.

## Current readiness

Composition of this adapter is not production admission or live verification.
The authoritative capability matrix records a limited exact packaged-live
ordinary-operation subset, historical evidence for a retired attachment-backed
current-principal route, and exact post-fix Team-create/member-add successes. Every verified operation
remains `poc_only`, no native-document operation has a live-success claim, and
`production_ready` remains zero. An `implemented` adapter path or successful
sibling operation does not imply Agent eligibility.

V4 keeps `observeEntry`, `uploadNewFile`, and download in that same
`poc_only` / `verification_profile_required` state. Metadata observation is
non-authorizing; download requires a real Provider `DownloadCheck` and an opaque
one-use lease before Content Space may open the destination; upload-new requires
an exact write-after observation and maps an indeterminate mutation outcome to
`outcome_unknown`. None of those contracts is packaged-live evidence, so none
is promoted to `production_ready`.

- The six ordinary file operations, all ten Team Administration operations,
  nine safely contract-shaped native-document operations, and 40 of the 50
  extended operations are `poc_only` / `verification_profile_required` when
  their required runtime is installed. The exact extended blocked set, in
  catalog order, is `resolveInternalLink`, `listMetadataChoices`,
  `updateFileVersion`, `searchUsers`, `searchDepartments`, `searchPositions`,
  `searchGroups`, `resolveCollaborationInvitation`,
  `listKnowledgeCollections`, and `searchKnowledgeCollections`. Without the
  overlay, only session-backed `getCurrentPrincipal` is PoC-only and the other
  49 extended operations are blocked. The default product composition cannot
  execute PoC-only operations.
- Provider-declared readiness and current invocation admission remain separate.
  A separately reviewed package-owned Content Space profile can admit only one
  exact PoC invocation matching the Provider Instance, complete Host Principal
  snapshot and assurance, authority, operation, audience, bounded transfer
  maxima, and validity window. Admission does not promote readiness.
- Provider-scoped operations, mutations, Administration, and non-zero transfers
  additionally require a v2 Provider Binding Attestation. This adapter obtains
  the token-free attestation from the Connector, maps it to the provider-neutral
  contract, and passes the exact expectation back through every Connector
  business call. The Connector reauthenticates and recomputes it immediately
  before dispatch, closing the admission-to-dispatch rebind window. Raw external
  account identifiers remain adapter-private.
- `updateFileVersion` is `blocked_by_contract`: the supplier exposes neither an
  exact expected version identity nor an atomic compare-and-update operation.
  A receipt-verified static characterization of pinned attachment `1.0.1` and
  the public offline SDK confirmed that the current request carries no atomic
  expected-state field, returns `FileVerId` only after the operation, uses
  `UPDATE` in the CLI (including an automatic same-name `610` retry), and still
  conflicts with the SDK overview's `UPGRADE` spelling. This negative snapshot
  evidence keeps mutation blocked; it is not a future supplier guarantee or a
  readiness promotion.
- `searchUsers`, `searchDepartments`, `searchPositions`, and `searchGroups` are
  `blocked_by_contract`: the pinned SDK and receipt define only collection
  envelopes, not exact item schemas or kind evidence. The Provider never
  guesses aliases or assigns a requested kind to an unproven item. Their
  Provider operation mappings remain only to report deterministic
  `blocked_by_contract`; the supplier commands are absent from the Connector
  admitted union, so calls fail before supplier transport.
- `resolveInternalLink`, `listMetadataChoices`,
  `resolveCollaborationInvitation`, `listKnowledgeCollections`, and
  `searchKnowledgeCollections` are also `blocked_by_contract`: their supplier
  commands remain inventory-only and are absent from the admitted adapter
  union. Ordinary `listEntries` remains on the typed Connector path, and PDF
  export remains a format of `native-document:export`.
- `getCurrentPrincipal` dispatches no supplier command and parses no user DTO.
  A narrow package-private semantic port reuses only the strict canonical
  external identity returned by the Connector-revalidated current Principal
  session, then issues one same-Provider directory `user` reference.
- All ten hash-bound native-document mutations, including `edit`, are
  `blocked_by_contract`: a read, probe, plan receipt, write-time re-read, or
  post-write digest cannot replace an atomic Provider-side `baseHash`
  comparison performed with the mutation.
- Native-document `import` is also `blocked_by_contract`: pinned attachment
  `1.0.1` exposes no source-identity or content postcondition, so the command
  remains supplier inventory but is absent from runtime admission and
  executable command unions.
- `observeImmutableVersion` is blocked. A file identity, version number, or
  digest does not prove immutable retention and version-specific retrieval, so
  this adapter cannot issue an `ArtifactReference`.
- Project Content Space provisioning is absent: this package contributes no
  Project operation or provisioning port, and Content Space exposes no generic
  Agent provisioning capability. A future Project-owning integration requires
  a separately reviewed owner contract instead of another Team write path.
  Provisioning is not Cloud Task handoff. Content Space exposes no Task port;
  Cloud Collaboration must also supply typed Task file intents and exact
  Task-turn resource injection and retirement.

Agent `createSpace` capability input does not contain an owner. The Content
Space Broker injects the current Principal as `contentOwnerUserId`, and this
adapter permits creation only when that identity maps to the authenticated
current OpenContent session. The created object is a shared Content Container
(an OpenContent Team), not the Content Space bounded context and not a Project
binding.

Ordinary Team membership does not use the current-owner binding as a cross-user
identity map, and no Project identity mapping is installed. It carries an
authoritative same-instance Provider directory `user`
reference through the existing Content Space Administration `addMember`,
`listMembers`, and `removeMember` path. The user reference must come from an
independently authoritative Provider observation; the four unpinned search
contracts cannot manufacture it. The current Principal reference comes only
from the Connector-revalidated session identity, while listed member references
come from the strict Team-user response. This adapter calls the token-private Connector
Team API with the current Principal-bound Connection and reconstructs the same
typed reference when it lists members. Tokens, endpoints, raw account DTOs, and
Connection selectors remain absent from Agent and Content Space contracts.

Administration member page items are exactly `{ member }`, and mutation
receipts reuse that same reference alongside exact root/result fields; they
expose no member role, role mutation, ownership transfer, or revision. The five
root/member mutations accept no `expectedRevision` and their Agent capabilities
declare `concurrency.revision: "none"`, because the typed OpenContent Team
supplier surface exposes no atomic expected-state field. Team observation and
post-write reconciliation prove bounded receipts, not CAS.

Every Administration operation that relies on Team or Team-user state first
requires a complete, stable, duplicate-free enumeration. Unprovable pagination,
including an empty page with a continuation signal, fails as
`provider_contract_violation` before a remote write. All ten outputs are exactly
bound to the request and authority: root/member/label/pinned/removal values and
bounded page progress cannot drift. Content Space classifies a mismatch on a
read as `provider_unavailable` and on a write/destructive operation as
`outcome_unknown`, without automatic retry.

The Connector-owned static inventory test freezes CLI version `1.0.0`, all 86
supplier commands, and the exact 50-command admitted adapter union. It does not run a
second packaged acceptance path and is not Provider live evidence. Packaged
callability is proven only by the canonical Electron/Broker → Content Space →
Provider → Connector smoke.

The authoritative operation inventory is
[the OpenContent capability matrix](../../../docs/opencontent-skill-capability-matrix.md),
and the complete module flow is in the
[Content Space architecture guide](../../../docs/content-space-architecture.md).
