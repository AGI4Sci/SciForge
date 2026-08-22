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
| **Provider Directory Principal Reference** | A non-secret `{ providerInstanceRef, kind, principalId }` identity returned by typed Provider directory search. It names a Provider-owned user/organization principal but carries no Connection, credential, Host Principal, or authorization. |
| **Shared Content Container Member** | A Provider directory `user` reference associated with one exact shared root. It is separate from Cloud Project membership and from the Project provisioning port's verified `contentUserId` mapping. |
| **Connection** | A Connector-owned, node-local binding between the current Principal and one Provider Instance, including protected credentials. It is never portable or caller-selected. |
| **Connector** | The provider-specific main-process boundary that owns endpoint/tenant policy, enrollment, credentials, session validation, transport, and Provider schema validation. It owns no Content Space business semantics. |
| **Public Runtime** | SciForge-authored public contracts, adapters, process isolation, and bounded transport used for supplier-backed operations. It is code, not the supplier payload and not a second capability path. |
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
optional enrollment UI, and optional static verification profiles. Removing an
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
       OR public OpenContent Runtime -> verified private overlay
  -> external Provider
```

Ordinary file and Team-administration requests use the Connector's typed public
client. Supplier-backed native-document and extended operations additionally
pass through the public Runtime and, when installed, the private overlay. These
are branches behind the same Provider/Connector boundary, not parallel Agent or
authorization paths.

Shared-container membership also has one closed path. Extended contract v2
makes every directory-search page literal-kind-specific, so typed `searchUsers`
returns only Provider directory user references while department, position, and
group searches reject user/mixed-kind output. `addMember`, `listMembers`, and
`removeMember` consume or return that same shape on the existing Administration
port. Content Space verifies that the authorized root, current Provider, input
member, and Provider output all name the same Provider Instance. The integration
may decode the opaque `principalId` into its private vendor identity only behind
the Provider boundary, and its Connector uses only the current Principal-bound
Connection. No Host cross-user mapping, raw account DTO, token, endpoint, or
connection selector enters the capability payload.

```text
typed searchUsers result
  -> Provider directory user reference
  -> root-scoped addMember
  -> ContentSpaceService same-Provider authority checks
  -> pinned Provider Administration feature
  -> token-free Connector Team Administration facade
  -> write followed by Provider observation
  -> listMembers returns the same canonical reference
  -> root-scoped removeMember
```

Project Content Directory provisioning intentionally does not reuse this
ordinary-member identity. Its dormant Project-owned contract accepts Cloud
`contentUserId` values only with separately verified Cloud-to-Provider identity
mappings; Provider directory search cannot manufacture Project authority or
Project membership.

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

An admitted verification call remains `poc_only`; admission never rewrites it
as `production_ready`. `blocked_by_contract` can never be admitted. The default
composition installs no verification profile, so PoC operations fail closed.

A trusted verification profile is a static package contribution. It binds one
exact Provider Instance, full Host Principal snapshot and assurance, authority,
operation, audience, bounded validity window, and upload/download maxima. The
matched byte maxima are execution limits, not descriptive metadata. Caller
input, renderer state, prompts, Tasks, environment variables, ordinary config,
attachment presence, or a sibling success cannot install or widen a profile.

Zero-transfer `list-containers` bootstrap and exact-root reads may be profiled
without an external binding. Provider-scoped operations, mutations,
administration, and non-zero transfers also require a current Provider Binding
Attestation.

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
Provider for the current attestation and matches it against the static profile.
It then carries that exact expected attestation only in the in-process Provider
operation context. Immediately before each remote business dispatch (including
a private Runtime subprocess), the Provider passes the expectation through the
canonical Connector boundary. The Connector revalidates the Principal,
reauthenticates the actual current session, observes the current external
account, recomputes the opaque values, and requires an exact match. Unbind,
rebind, credential replacement, account change, or binding-revision drift fails
before business dispatch; a prior admission is never reused as account
authority.

## Operation matrix

| Surface | Private overlay | Declared OpenContent readiness | Additional admission boundary |
| --- | --- | --- | --- |
| Provider discovery and enrollment | Not required | Not a Provider business operation | Human-only enrollment; discovery grants no content authority |
| Container bootstrap and exact-root reads | Not required | `poc_only` | Exact static profile; bootstrap/root authority; zero transfer may omit binding attestation |
| Create folder | Not required | `poc_only` | Exact Broker root resource plus current binding attestation |
| Upload new / download | Not required | `poc_only` | Exact Broker resource, current binding attestation, Workspace authority, and enforced profile byte limit |
| Shared-root / Team administration | Not required | Ten operations are `poc_only` | Exact root/provider-administration Broker authority plus current binding attestation; Agent create input contains only the label, while member mutations accept only a same-instance Provider directory user reference returned by typed search/list paths |
| Safe native-document operations | Required | Nine operations are `poc_only` | Exact feature/resource authority, profile, binding when required, and bounded transfers |
| Hash-bound native-document mutations, including `edit` | Required | `blocked_by_contract` | Requires Provider-atomic `baseHash` compare-and-mutate; no profile can bypass it |
| Native-document import | Required | `blocked_by_contract` | Requires a frozen source-identity/content postcondition; the pinned command remains inventory-only and is blocked before source transfer or subprocess dispatch |
| Extended operations | Required except the two public Team-governance delegates | 53 are `poc_only` with overlay; `updateFileVersion` is blocked | Exact typed operation/resource/profile; writes and transfers require binding attestation |
| Same-file version update | Required | `blocked_by_contract` | Requires one frozen exact-version CAS contract and unambiguous `UPDATE` versus `UPGRADE` semantics |
| Immutable artifact observation | Not required | `blocked_by_contract` | Requires immutable retention and exact version-specific retrieval before issuing `ArtifactReference` |
| Project Content Directory provisioning | Not required | Provider operation blocked; provider-neutral port dormant | A future Project-owning context must supply authoritative binding and verified identities; no generic Agent entrypoint |

For Agent shared-root creation, the request contains only the shared-root label.
The Broker owns invocation identity/idempotency and its current Principal
supplies the owner; the
OpenContent Provider verifies that this owner maps to the authenticated current
external session. An Agent cannot name itself, another user, a Coordinator, or
an arbitrary Provider account as owner.

After a root is authorized, member administration is distinct from creation:
an Agent may supply one typed Provider directory user reference and an expected
root revision to the existing add/remove capabilities. It cannot supply a Host
`contentUserId`, select a Connection, or invite a principal from another
Provider Instance. `listMembers` returns the same typed references so removal
does not depend on a Host identity reverse map.

## Behavior without the private overlay

SciForge, Content Space, Provider discovery/enrollment, the public Connector,
ordinary file candidates, and Team administration remain composed and usable
according to their own admission state. Native-document support is not
registered; the other 52 supplier-backed extended operations fail closed as
`provider_contract_missing` before supplier dispatch. Startup, build, and
packaging do not search private `node_modules` or walk ancestor directories.

With a valid overlay, static receipt/inventory/digest verification enables only
the additional Runtime candidates. It does not install a verification profile,
promote readiness, create a Connection, or bypass Broker authority.

## Evidence and remaining gates

The [OpenContent capability matrix](./opencontent-skill-capability-matrix.md) is the sole public
ledger for exact packaged outcomes. In addition to the cumulative personal-root ordinary-operation
subset, it records one attachment-backed current-principal read, one post-fix Team creation that
reached packaged Agent terminal success, and one exact-once member add whose canonical post-write
listing observed one owner, one internal member, and exactly one match for the added Provider user
reference. Every live-verified operation remains `poc_only`; evidence does not spread to a sibling
operation, root, authority, audience, Principal, or binding, and `production_ready` remains zero.

The ledger separately records packaged installed-attachment callability over 37 files, CLI version
`1.0.0`, 86 supplier commands, and the 61-command admitted union. That smoke is static callability
evidence, not a Provider live result. Additional file upload/download and native-document attempts
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
