# Content Space architecture

Content Space is SciForge's provider-neutral bounded context for provider-hosted
directories, ordinary files, fixed artifacts, and Provider-declared native
document operations. A provider library is a **Content Container** (or shared
Content Container), never "a Content Space". OpenContent is one integration of
the public `ContentSpaceProvider` SPI; it is not a Host dependency.

Current evidence is deliberately conservative. Exact packaged canonical results are maintained only
in the [OpenContent capability matrix](./opencontent-skill-capability-matrix.md); the verified subset
remains `poc_only`, and OpenContent has zero `production_ready` operations. A typed implementation or
successful acceptance updates evidence only for the exact operation and scope exercised; it never
promotes readiness or changes a sibling operation's evidence.

## Vocabulary and ownership

| Term | Meaning and owner |
| --- | --- |
| **Content Space** | The bounded context and public domain contract. It owns capability semantics, authorization through Broker resources, readiness/admission evaluation, and portable Content Space references. |
| **Content Container** | One provider-owned root or directory. A shared root is a shared Content Container; OpenContent calls its current shared-root construct a Team. |
| **ContentSpaceProvider** | The Content Space-owned Provider SPI. It is the only Provider contract used by the Content Space service. |
| **Provider integration** | A domain package that adapts one Provider Kind to `ContentSpaceProvider` and contributes it through normal manifest/generated composition. |
| **Provider Instance** | One trusted external deployment/tenant. Its reference is non-secret and distinct from a user's local Connection. |
| **Provider Directory Principal Reference** | A non-secret `{ providerInstanceRef, kind, principalId }` identity backed by an authoritative Provider observation. It names a Provider-owned user/organization principal but carries no Connection, credential, Host Principal, or authorization. |
| **Shared Content Container Member** | A Provider directory `user` reference associated with one exact shared root. It is separate from Cloud Project membership and carries no Project authority. |
| **Connection** | A Connector-owned, node-local binding between the current Principal and one Provider Instance, including protected credentials. It is never portable or caller-selected. |
| **Connector** | The provider-specific main-process boundary that owns endpoint/tenant policy, enrollment, credentials, session validation, transport, and Provider schema validation. It owns no Content Space business semantics. |
| **Provider Deployment Configuration** | A package-owned fixed binding from one Provider Instance to its HTTPS origin. It controls Connector runtime availability, not discovery, readiness, admission, Connection selection, or supplier inventory; its release policy is declared by the owning package. |
| **Supplier-backed Connector Transport** | Connector-owned wire protocol, reviewed allowlist, asset verification, and process isolation. Provider-owned receipt-to-Content-Space semantics consume it through the token-free main contract. It is not a separate release unit, supplier payload, or second capability path. |
| **Private Overlay** | Optional receipt-backed supplier assets under `internal/opencontent/**` in source mode and one fixed resources directory in an internal packaged build. It is runtime data, not a domain package or authorization switch. |
| **Broker Resource** | A process-local, caller/Principal/audience-bound executable resource issued after selection or portable-reference reauthorization. Raw Provider IDs and portable references are not Broker authority. |
| **ContentFileReference** | A portable identity for a live ordinary Provider file. It makes no immutable-version promise. |
| **ArtifactReference** | A portable identity for a Provider-proven immutable, retained, version-specifically retrievable result. A file ID, latest-version number, or digest alone is insufficient. |

The Host depends only on generic SDK contracts, contribution catalogs, and the
Capability Broker. Provider-specific packages never require a Host feature map,
vendor switch, alternate IPC channel, MCP server, or fallback Provider.

## Canonical composition and call chain

Installed domain manifests and generated composition contribute the Content
Space domain, trusted Provider Instance declarations, Provider factories,
and optional enrollment UI. Removing an
integration package removes its contributions without changing Host code.

Every operation follows one path:

```text
Renderer or Agent capability request
  -> Capability Broker
       injects current Principal, audience, Workspace and Broker resource
  -> package-owned Content Space capability handler
  -> ContentSpaceService
       resolves authority and evaluates readiness + invocation admission
  -> trusted Provider Instance Directory
  -> ContentSpaceProviderCatalog
  -> exact pinned ContentSpaceProvider
  -> OpenContent Content Space Provider integration
  -> token-free OpenContent Connector facade
  -> Connector-owned current Connection and reauthorization
  -> typed OpenContent client
       OR Connector-owned supplier transport -> verified private overlay
  -> external Provider
```

Ordinary file and Team-administration requests use the Connector's typed public
client. Supplier-backed native-document and extended operations additionally
pass through Connector-owned transport and Provider-owned semantic adapters and,
when installed, the private overlay. These
are branches behind the same Provider/Connector boundary, not parallel Agent or
authorization paths.

The OpenContent Connector reads one strict public package-owned deployment
configuration exactly once during activation. Source builds use
`packages/domains/opencontent-connector/config/opencontent-connector.json`;
packaged builds use `resources/domain-deployments/opencontent-connector.json`.
The manifest declares `publicRelease: allowed`. No mode falls
back to the other, and environment, argv, caller, renderer, or package settings
cannot supply or override its fixed HTTPS origin. Missing or invalid configuration leaves the Provider
Instance, capability factory, and service descriptor composed, but every
Provider-backed call fails `provider_unavailable` before settings, credentials,
network, or supplier-process work. Node-local unbind remains available without
the sidecar, deletes the fixed-slot local credential, and performs no Provider business call.
The integration-owned unavailable enrollment view exposes that local cleanup
only after explicit Human confirmation and makes clear that remote files are
unchanged.
This availability gate is independent of runtime Content Space authorization
and the optional supplier overlay. The
isolated `resources/domain-deployments/**` namespace means a sidecar-only build
does not manufacture the separate `resources/opencontent/**` supplier overlay.

Shared-container membership also has one closed path. `addMember`,
`listMembers`, and `removeMember` consume or return one authoritative Provider
directory `user` reference on the existing Administration port. Content Space
verifies that the authorized root, current Provider, input member, and Provider
output all name the same Provider Instance. OpenContent's four supplier-backed
directory searches remain blocked until exact item schemas and kind evidence are
pinned; they cannot manufacture a reference by aliases or requested-kind
assignment. The integration may decode an independently established opaque
`principalId` into its private vendor identity only behind the Provider boundary,
and its Connector uses only the current Principal-bound Connection. No Host
cross-user mapping, raw account DTO, token, endpoint, or connection selector
enters the capability payload.

OpenContent treats Team and Team-user enumeration as a fail-closed precondition,
not best-effort discovery. Any Administration operation that depends on those
observations must prove a complete, stable, duplicate-free result or return
`provider_contract_violation` before a remote write. A metadata-free full page
whose completion is unknowable, or an empty page with a continuation signal,
fails closed.

Administration v3 membership page items are exactly `{ member }`, and mutation
receipts reuse that reference with exact root/result fields; there is no public
member-role or ownership-transfer operation. `updateSpace`,
`pinSpace`, `unpinSpace`, `addMember`, and `removeMember` accept no
`expectedRevision`, return no Administration revision, and declare
`concurrency.revision: "none"`. OpenContent's typed Team supplier surface has no
atomic expected-state field, so observation and reconciliation are not CAS.
The ordinary root Broker resource fixes the target but is not standing
administration approval: those five Agent mutations each require fresh Human
confirmation before Provider dispatch.
The same rule applies to every native-document or extended operation declared
`destructive`: an ordinary child, feature-selection, or Provider-administration
resource fixes authority but never substitutes for fresh confirmation. The
Broker rejects a missing per-invocation approval before Provider binding or
dispatch; only non-destructive `external-write` operations retain delegated
`resource-authorized` execution.
Content Space binds every one of the ten Administration outputs to the exact
request and Broker authority, including page progress and unique identities.
Read mismatches are `provider_unavailable`; write/destructive mismatches are
`outcome_unknown`; neither is automatically retried.

```text
authoritative Provider directory user reference
  -> Provider directory user reference
  -> root-scoped addMember
  -> ContentSpaceService same-Provider authority checks
  -> pinned Provider Administration feature
  -> token-free Connector Team Administration facade
  -> write followed by Provider observation
  -> listMembers returns the same canonical reference
  -> root-scoped removeMember
```

Project Content Directory provisioning is not implemented by Content Space or
the OpenContent Provider. There is no provisioning operation, intent/report
schema, or Provider port to reuse. Any future Project-owned integration requires
a separately reviewed authoritative binding and identity contract; Provider
directory search cannot manufacture Project authority or membership.

A portable reference has a separate materialization path:

```text
portable envelope -> exact kind codec -> trusted Provider Instance resolution
  -> current-Principal Provider reauthorization -> new Broker Resource
```

The portable value carries identity only. It never carries a Connection,
credential, permission, audience, Broker handle, endpoint, or path-as-authority.

## Readiness is evidence; admission is per invocation

Provider-declared readiness and current invocation admission answer different
questions and are reported separately.

| Layer | Question | Values |
| --- | --- | --- |
| **Readiness** | What evidence and Provider contract exist for this exact operation? | `poc_only`, `blocked_by_contract`, `production_ready` |
| **Invocation admission** | May this exact caller, Principal, authority, audience, platform and transfer execute now? | `admitted` or `blocked`, with a bounded reason |

An admitted runtime-authorized call remains `poc_only`; admission never rewrites
it as `production_ready`, and `blocked_by_contract` can never be admitted. A
`poc_only` invocation requires a trusted Broker audience, the exact current
Principal and authority, the pinned Provider Instance and its current Provider
Binding Attestation. Host transfer maxima remain the execution bounds. Caller
input, renderer state, prompts, Tasks, environment variables, ordinary config,
skill-package presence or a sibling success cannot select the binding, widen
authority or promote readiness.

## Provider Binding Attestation v2

The attestation is provider-neutral, token-free evidence for one exact local
binding. It binds the Provider Instance and full current Principal to two opaque
SHA-256 values:

- `externalSubject`: a stable opaque reference to the authenticated external
  subject for that Provider Instance;
- `bindingRevision`: an opaque revision that changes when the local Connection
  is replaced or rebound.

It is neither a credential nor portable authority, and raw identifiers used to
establish the binding do not enter capability input or portable references.

To close the admission-to-dispatch race, Content Space first asks the pinned
Provider for the current attestation and requires the exact Provider Instance
and complete current Principal. It then carries that exact expected attestation only in the in-process Provider
operation context. Immediately before each remote business dispatch (including
a Connector-owned supplier subprocess), the Provider passes the expectation through the
canonical Connector boundary. The Connector revalidates the Principal,
reauthenticates the actual current session, observes the current external
account, recomputes the opaque values, and requires an exact match. Unbind,
rebind, credential replacement, stable external-subject identity change, or
binding-revision drift fails before business dispatch; mutable account and
display labels are not identity keys, and a prior admission is never reused as
account authority.

## Operation matrix

| Surface | Optional Provider supplier overlay | Declared OpenContent readiness | Additional admission boundary |
| --- | --- | --- | --- |
| Provider discovery and enrollment | Not required | Not a Provider business operation | Human-only enrollment; discovery grants no content authority |
| Container bootstrap and exact-root reads | Not required | `poc_only` | Trusted Broker audience, exact bootstrap/root authority, current Principal and live binding attestation |
| Create folder | Not required | `poc_only` | Exact Broker root resource plus current binding attestation |
| Upload new / download | Not required | `poc_only` | Exact Broker resource, current binding attestation, Workspace authority, and Host-enforced byte limit |
| Shared-root / Team administration | Not required | Ten operations are `poc_only` | Exact root/provider-administration Broker authority plus current binding attestation; Agent create input contains only the label, while member mutations accept only an authoritative same-instance Provider directory user reference |
| Safe native-document operations | Required | Nine operations are `poc_only` | Exact feature/resource authority, current binding, and Host-bounded transfers |
| Hash-bound native-document mutations, including `edit` | Required | `blocked_by_contract` | Requires Provider-atomic `baseHash` compare-and-mutate; runtime authorization cannot bypass it |
| Native-document import | Required | `blocked_by_contract` | Requires a frozen source-identity/content postcondition; the pinned command remains inventory-only and is blocked before source transfer or subprocess dispatch |
| Extended operations | Required except session-backed `getCurrentPrincipal` | With overlay, 40 of 50 are `poc_only`; in catalog order, `resolveInternalLink`, `listMetadataChoices`, `updateFileVersion`, `searchUsers`, `searchDepartments`, `searchPositions`, `searchGroups`, `resolveCollaborationInvitation`, `listKnowledgeCollections`, and `searchKnowledgeCollections` are blocked | Exact typed operation/resource, trusted audience and current binding; writes and transfers remain Host-bounded |
| Same-file version update | Required | `blocked_by_contract` | Requires one frozen exact-version CAS contract and unambiguous `UPDATE` versus `UPGRADE` semantics |
| Immutable artifact observation | Not required | `blocked_by_contract` | Requires immutable retention and exact version-specific retrieval before issuing `ArtifactReference` |
| Project Content Directory provisioning | Not applicable | Absent | Requires a future separately reviewed Project-owning contract; no Content Space operation, Provider port, or generic Agent entrypoint exists |

For Agent shared-root creation, the request contains only the shared-root label.
The Broker owns invocation identity/idempotency and its current Principal
supplies the owner; the
OpenContent Provider verifies that this owner maps to the authenticated current
external session. An Agent cannot name itself, another user, a Coordinator, or
an arbitrary Provider account as owner.

After a root is authorized, member administration is distinct from creation:
an Agent may supply one typed Provider directory user reference to the existing
add/remove capabilities. It cannot supply a Host `contentUserId`, revision,
member role, Connection selector, or principal from another Provider Instance.
`listMembers` returns only the same typed `member` references so removal does
not depend on a Host identity reverse map.

## Behavior without the private overlay

SciForge, Content Space, Provider discovery/enrollment, the public Connector,
ordinary file candidates, and Team administration remain composed. They are
usable according to their own admission state only when the Connector's public
package-owned deployment configuration is valid. Native-document support is not
registered. Session-backed `getCurrentPrincipal` remains the only extended PoC
candidate without supplier assets; the other 49 extended operations fail closed as
`provider_contract_missing` before supplier dispatch. Startup, build, and
packaging do not search private `node_modules` or walk ancestor directories.

With a valid overlay, static receipt/inventory/digest verification enables only
the additional supplier-backed candidates. The current overlay inventory has
43 files, but the Connector loads only five package-pinned runtime contract
files; the rest do not become Host or Broker capabilities. It does not promote
readiness, create a Connection, or bypass Broker authority. Installing the raw
`opencontent-base` ZIP into a Workspace is a separate Agent-skill use of the
supplier payload: it adds optional Agent instructions/CLI discovery, does not
activate this Provider supplier transport, and is not required for Provider
selection or ordinary/Team Provider use.

## Evidence and remaining gates

The [OpenContent capability matrix](./opencontent-skill-capability-matrix.md) is the sole public
ledger for exact packaged outcomes. In addition to the cumulative personal-root ordinary-operation
subset, it records historical evidence for a retired attachment-backed current-principal route, one post-fix Team creation that
reached packaged Agent terminal success, and one exact-once member add whose canonical post-write
listing observed two distinct members and exactly one match for the added Provider user reference,
without exposing a public role value. Every live-verified operation remains `poc_only`; evidence does not spread to a sibling
operation, root, authority, audience, Principal, or binding, and `production_ready` remains zero.

The Connector-owned static contract freezes CLI version `1.0.0`, 86 supplier commands, and the
50-command admitted adapter union. The supplier `download`, `file-list`, `kbox-list`,
`file-internal-link`, `meta-modeldata`, and `collab-link` commands are inventory-only and cannot
reach the process transport. Ordinary `listEntries` and download remain on the typed Connector
path, while PDF export remains a format of `native-document:export`. Static inventory characterization is not packaged or Provider-live
callability evidence; any packaged callability claim must traverse the canonical Electron/Broker →
Content Space → Provider → Connector path. Additional file upload/download and native-document attempts
did not reach Provider business dispatch because external Agent operation-reference/cursor
consumption was unstable; their Provider dispatch and remote-write counts were both zero. No
native-document operation therefore gains a live-success claim: native callability remains
static/composed evidence, and the earlier non-live packaged outcomes remain classified as such.
Native `edit` and every same-file/hash-bound mutation remain blocked until the Provider proves an
atomic expected-version/hash precondition. `ArtifactReference` issuance remains blocked until
immutable retention and version-specific retrieval are proven.

See the [Content Space glossary](./contexts/content-space/CONTEXT.md),
[Provider Integration glossary](./contexts/provider-integration/CONTEXT.md),
[ADR-0030](./adr/0030-activate-provider-native-documents-through-content-space.md),
[OpenContent capability matrix](./opencontent-skill-capability-matrix.md), and
[private attachment runbook](./opencontent-private-attachment-runbook.zh-CN.md).
