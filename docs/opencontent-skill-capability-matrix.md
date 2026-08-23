# OpenContent Skill Capability Matrix

Audit date: 2026-08-23

This inventory maps every reviewed supplier command to a
provider-neutral SciForge contract. It is evidence, not runtime configuration and not permission
to invoke the supplier CLI or its raw HTTP passthrough.

The OpenContent Connector (including supplier transport), Content Space Provider (including semantic
adapters), and SDK documentation are public source. The original supplier attachment, its extracted files, and its private
distribution metadata are not published; see the
[attachment distribution boundary](./opencontent-attachment-distribution.md).

Inventory status is deliberately singular and conservative. It records contract and adapter
evidence, not `Content Space Capability Readiness` and not packaged live evidence; in particular,
`implemented` never means `production_ready` or `live_verified`:

- `contract_verified`: a closed typed SciForge request/result/error contract exists; no runtime or live claim.
- `implemented`: the canonical SciForge runtime path exists; the inventory label itself makes no live claim.
- `blocked_by_contract`: a typed operation or adapter path may exist, but the Provider lacks the exact safe contract required for dispatch.
- `deferred`: the consumer integration is intentionally outside this delivery even though related lower-level contracts exist.
- `intentionally_excluded`: the command is not admitted to the public capability surface.

Packaged live evidence is tracked separately in the exact-operation ledger below. `live_verified`
means only that the recorded operation and scope passed the current packaged canonical path; it is
not a readiness state, does not apply to a composite inventory row, and does not spread to a sibling
operation, authority, audience, or Provider binding.

The contracts are provider-neutral. Supplier IDs, URLs, numeric member types, permission bitmasks,
CLI argument strings, and arbitrary request payloads are adapter-private translations.

## Current dispatch readiness

The public contracts enumerate exactly **20 native-document operations** and **50 extended
operations**. OpenContent currently has **zero** `production_ready` operations. The exact-operation
ledger below records the limited packaged canonical live evidence; every `live_verified` operation
still declares `poc_only` / `verification_profile_required`. Runtime availability is intentionally
different from inventory status. Provider-declared readiness (`poc_only`, `blocked_by_contract`, or
`production_ready`) records evidence; current invocation admission independently reports whether
the exact caller, Principal, authority, audience, platform and verification facts may execute now.
An admitted verification invocation remains `poc_only`.

| Installation | `poc_only` / `verification_profile_required` | Blocked or omitted |
|---|---|---|
| Public checkout, without the private attachment | The six ordinary file operations (`list-containers`, `list-entries`, `observe-entry`, `create-folder`, `upload-new`, `download`); all ten Team Administration operations; session-backed `getCurrentPrincipal` | The native-document feature is not registered. The other 49 extended operations are `blocked_by_contract` / `provider_contract_missing`. Portal targets and immutable-version observation remain blocked. Project provisioning is absent from the Content Space and Provider contracts. |
| Valid private attachment installed | The same public PoC candidates; nine safely contract-shaped native-document operations; 40 of 50 extended operations | Eleven native-document operations are `blocked_by_contract`: ten hash-bound mutations including `edit`, plus `import` without a verifiable source/content postcondition. Ten extended operations are blocked: `resolveInternalLink`, `listMetadataChoices`, `updateFileVersion`, `searchUsers`, `searchDepartments`, `searchPositions`, `searchGroups`, `resolveCollaborationInvitation`, `listKnowledgeCollections`, and `searchKnowledgeCollections`. Portal targets and immutable-version observation remain blocked. Project provisioning remains absent. |

PDF export remains a format of `native-document:export`, and directory
enumeration remains the ordinary `listEntries` operation.

The ten blocked hash-bound native-document mutations are `update`, `insert`, `edit`, `undo`,
`redo`, `comment-create`, `comment-reply`, `comment-solve`, `comment-reopen`, and
`comment-delete`. A probe or plan receipt is useful local evidence but is not a Provider-atomic
compare-and-mutate precondition.

Native-document `import` is the eleventh blocked operation for a different
reason: pinned attachment `1.0.1` exposes no source-identity or content
postcondition. `docflow-import` remains in the 86-command supplier inventory,
but not in SciForge's admitted or executable command unions.

Provider Instance discovery can enumerate an installed candidate independently of operation
readiness. It is not an OpenContent business-operation pass and does not promote any row.

### Trusted verification admission

`poc_only` remains unavailable in the default product composition. A separately reviewed generic
Content Space verification profile may admit an invocation only when all of these trusted facts
match exactly:

- exact Provider Instance;
- exact current Host Principal snapshot (authority, subject, assurance, device, and identity
  version); Host assurance is not an external OpenContent account class;
- exact authority (Provider Instance or authorized personal/shared root);
- exact operation ID and audience;
- bounded upload/download maxima and an unexpired validity window no longer than 24 hours; and
- for Provider-scoped operations, mutations, administration, or non-zero transfers, the exact
  expected Provider Binding Attestation.

The v2 Provider Binding Attestation is token-free, non-portable evidence for the exact Provider
Instance and complete Principal plus an opaque external subject and opaque Connection revision.
Content Space obtains it only from the pinned Provider and matches it against the static profile.
It then carries the exact expectation in-process; immediately before business dispatch, the
Provider passes it through the canonical Connector boundary. The Connector reauthenticates the
actual current session, observes the current external subject, recomputes both opaque values, and
requires an exact match. Unbind, rebind, credential replacement, stable external-subject identity
change, or revision drift therefore fails before the Provider business operation; mutable account
and display labels are not identity keys. Raw external account identifiers do not enter capability
input or portable authority.

Without an attestation, only zero-transfer `list-containers` bootstrap and zero-transfer reads on
an exact Broker-authoritative content root are profile-safe. The matched upload/download maxima
are enforced during the actual invocation; they are not compared as descriptive metadata and they
do not widen the global Content Space bounds.

The profile is supplied by trusted service composition, narrows only that invocation, and leaves
the Provider declaration as `poc_only`. Caller payloads, renderer state, Agent requests, prompts,
Tasks, filenames, MIME types, ordinary environment/configuration, attachment presence, or a
successful sibling operation cannot install, select, or widen it. A verification profile can never
admit `blocked_by_contract`.

When one operation depends on another gated operation, such as observation before a bounded file
action, every prerequisite needs its own exact matching profile; one match never widens another.

## Canonical Content Space acceptance surface

The acceptance surface is a SciForge Content Space workflow, not a one-to-one supplier CLI inventory. These
Host/Broker capabilities are therefore recorded explicitly before the command matrix below.

| Acceptance surface | Canonical SciForge capabilities | Status | Notes |
|---|---|---|---|
| Installed Provider discovery | `content-space.list-provider-instances` | implemented | Returns trusted Provider Instance references only; it does not infer a Provider from a label or prompt. |
| Personal/shared root selection | `content-space.list-agent-root-candidates` / `content-space.authorize-agent-root` | implemented | Candidate labels are non-authorizing; authorization re-enumerates live state and issues one exact Broker root resource. |
| Personal-library file loop | `content-space.agent-list-entries` / `content-space.agent-create-folder` / `content-space.agent-upload-new` / `content-space.agent-download` | implemented | Uses the Provider-resolved personal root, bounded pages, no magic numeric folder ID, and no implicit overwrite. |
| Shared Content Container / OpenContent Team file loop | `content-space.agent-list-entries` / `content-space.agent-create-folder` / `content-space.agent-upload-new` / `content-space.agent-download` | implemented | Uses the Team's real Content Container root reference; Team identity and root folder identity remain distinct. |
| Destructive content operations | `content-space.agent-native-document-destructive` / `content-space.agent-extended-destructive` | implemented | Every invocation requires fresh Human confirmation and carries no autonomous-write grant. An ordinary child, feature-selection, or Provider-administration resource alone cannot authorize `deleteEntries`, `cancelPublication`, `cancelShare`, `removeFavorite`, or another destructive operation. |
| Shared-root / Team administration | `content-space.authorize-provider-administration` plus `content-space.agent-admin-*` | implemented | All ten operations are PoC-only. The Host issues scoped Broker resources and gates each exact operation; an ordinary root is not standing administration approval, so update, pin, unpin, add-member, and remove-member each require fresh confirmation. Agent shared-root creation accepts no owner; the Broker current Principal supplies it and the Provider checks it against the authenticated external session. Every required Team or Team-user enumeration must prove complete, stable pagination before a remote write. Membership values contain only `member`; no role/ownership delegate exists. All outputs are exactly request-bound, and the five root/member mutations declare `concurrency.revision: "none"`. Team deletion is absent. |
| Project Content Directory provisioning | — | absent | Content Space and the OpenContent Provider expose no capability, operation, intent/report schema, or Provider port. A future Project-owning integration requires a separately reviewed authoritative binding and identity contract. Ordinary Agents cannot author owner or membership intent. |
| Cloud Task handoff | — | deferred | No Task-specific Content Space port exists. Cloud Collaboration must first own the Project Content Space Binding, typed Task file intents, and exact Task-turn resource injection and retirement. |
| Immutable artifact proof | `content-space.observe-immutable-version` | blocked_by_contract | OpenContent does not prove immutable retention plus version-specific retrieval. A file identity, version number, or digest cannot by itself authorize an `ArtifactReference`. |

Agent file inputs and destinations use strict Workspace-relative paths. Host transfer handles are
never part of the Agent contract; Content Space opens the bounded source/destination and gives the
Provider only a managed byte stream.

## Ordinary content, discovery, and organization

| Supplier command | Provider-neutral SciForge operation | Status | Notes |
|---|---|---|---|
| `file-search` | `content-space.search-entries` | implemented | Structured scope, metadata and tag predicates; no query-language passthrough. |
| `file-rag-scope` | `content-space.build-file-scope` | implemented | Bounded file-reference selection, maximum 100. |
| `file-info` | `content-space.observe-entry` / `content-space.get-entry-info` | implemented | The ordinary observation and separately typed richer information contracts remain distinct. |
| `file-internal-link` | `content-space.resolve-internal-link` | blocked_by_contract | Inventory only and absent from the admitted adapter union; no Provider target is issued. |
| `file-edit` | `content-space.update-entry-properties` | implemented | Typed code, remark and security-level patch. |
| `sec-level-list` | `content-space.list-security-levels` | implemented | Provider security levels become opaque typed references. |
| `file-list` | — | intentionally_excluded | Inventory only and absent from the admitted adapter union. Canonical ordinary directory enumeration remains `ContentSpaceProvider.listEntries` through the typed Connector facade. |
| `folder-info` | `content-space.observe-entry` / `content-space.get-entry-info` | implemented | Uses a Content Container reference, not numeric folder identity. |
| `create-folder` | `content-space.create-folder` | implemented | Existing V1 write path; current audit does not promote it to live_verified. |
| `folder-edit` | `content-space.update-entry-properties` | implemented | Folder code and remark use the same typed property contract. |
| `upload` (new file) | `content-space.upload-new` | implemented | Agent supplies a Workspace-relative source; Host opens the bounded managed stream. |
| `upload` (`fileModel=UPDATE`) | `content-space.update-file-version` | blocked_by_contract | The pinned CLI accepts update bytes but `file-info` exposes only `fileLastVerNumStr`, and `upload` has no atomic expected-version precondition. A preflight followed by upload would be TOCTOU, so no same-file update is advertised until the Provider freezes a real CAS/version contract. `replace-latest` also remains excluded because it overwrites the current version. |
| `upload` (`masterFileId`) | `content-space.add-attachment` | implemented | Attachment is distinct; Agent supplies a Workspace-relative source and Provider receives only the managed stream. |
| `upload` (`collab=true`) | — | intentionally_excluded | Collaboration capability is browsing/invitation only; no alternate collaboration writer. |
| `download` (supplier CLI) | — | intentionally_excluded | Inventory only and absent from the admitted adapter union. Ordinary `content-space.download` remains implemented through the typed Connector facade; Agent supplies a new Workspace-relative destination and Host owns the no-overwrite destination stream. |
| `attach-list` | `content-space.list-attachments` | implemented | Typed master/attachment file references. |
| `attach-remove` | `content-space.remove-attachment` | implemented | Destructive, exact attachment target. |
| `relation-create` | `content-space.create-relation` | implemented | Closed relation kinds; no arbitrary relation object. |
| `relation-list` | `content-space.list-relations` | implemented | Bounded relation page. |
| `relation-remove` | `content-space.remove-relation` | implemented | Request carries the exact relation reference plus source and target endpoints required by the CLI. |
| `rename` | `content-space.rename-entry` | implemented | Exact typed entry plus canonical name. |
| `copy` | `content-space.copy-entries` | implemented | Bounded batch with per-entry typed outcome and a short-lived exact-resource selection. |
| `move` | `content-space.move-entries` | implemented | Bounded batch and exact destination container; every source is independently delegated. |
| `delete` | `content-space.delete-entries` | implemented | Destructive exact-entry selection; library roots and team deletion are excluded. |
| `create-shortcut` | `content-space.create-shortcut` | implemented | Typed independently delegated source and destination references. |
| `recent-files` | `content-space.list-recent-entries` | implemented | Bounded provider/scope page. |

## Metadata and tags

| Supplier command | Provider-neutral SciForge operation | Status | Notes |
|---|---|---|---|
| `meta-info` | `content-space.read-entry-metadata` | implemented | Closed typed metadata record values. |
| `meta-types` | `content-space.list-metadata-types` | implemented | Opaque type references and labels. |
| `meta-attrs` | `content-space.list-metadata-fields` | implemented | Provider controls map to closed field kinds. |
| `meta-modeldata` | `content-space.list-metadata-choices` | blocked_by_contract | Inventory only and absent from the admitted adapter union; dynamic choice receipts are not contract-pinned. |
| `meta-edit` | `content-space.edit-entry-metadata` | implemented | Discriminated values; no column-name or arbitrary-value passthrough. |
| `file-tag-list` | `content-space.list-tags` | implemented | Bounded typed tag page. |
| `file-tag-set` | `content-space.set-tags` | implemented | Assignment accepts bounded tag names because the Provider CLI assigns names, not tag IDs. |
| `file-tag-delete` | `content-space.remove-tags` | implemented | Removal uses exact Provider tag identities. |

## Share, publish, favorites, and albums

| Supplier command | Provider-neutral SciForge operation | Status | Notes |
|---|---|---|---|
| `publish` | `content-space.create-publication` | implemented | Existing provider entries only; local bytes use canonical upload first. |
| `my-publish-list` | `content-space.list-publications` | implemented | Bounded page reports explicit partial observations when the CLI omits detail fields. |
| `cancel-publish` | `content-space.cancel-publication` | implemented | Exact publication references. |
| `create-share` | `content-space.create-share` | implemented | Typed recipients, permissions and expiry; numeric tuples remain adapter-private. |
| `my-share-list` | `content-space.list-shares` | implemented | Bounded page reports explicit partial observations when the CLI omits detail fields. |
| `cancel-share` | `content-space.cancel-share` | implemented | Exact share references. |
| `albums` | `content-space.list-albums` | implemented | Opaque album references. |
| `album-files` | `content-space.list-album-entries` | implemented | Bounded album-entry page. |
| `favorite-add` | `content-space.add-favorite` | implemented | Typed album and entry references. |
| `favorite-remove` | `content-space.remove-favorite` | implemented | Explicit favorite-record or entry selection. |

## Organization and permissions

| Authority source or supplier command | Provider-neutral SciForge operation | Status | Notes |
|---|---|---|---|
| Connector-revalidated current session | `content-space.get-current-principal` | implemented | Uses only the strict canonical external identity already established by the Principal-bound Connector session. The package-private semantic route dispatches no supplier command and accepts no raw user DTO. |
| `user-info` | — | unmapped | No Content Space operation maps this supplier command; first-defined identity or name aliases cannot issue a directory reference. |
| `search-position` | `content-space.search-positions` | blocked_by_contract | Pinned supplier evidence does not define an exact item schema or prove literal kind. |
| `search-department` | `content-space.search-departments` | blocked_by_contract | Pinned supplier evidence does not define an exact item schema or prove literal kind. |
| `search-user` | `content-space.search-users` | blocked_by_contract | Pinned supplier evidence does not define an exact item schema, kind proof, or safe pagination contract. |
| `search-user-group` | `content-space.search-groups` | blocked_by_contract | Pinned supplier evidence does not define an exact item schema or prove literal kind. |
| `perm-cates` | `content-space.list-permission-categories` | implemented | Closed target kinds and category references. |
| `perm-list` | `content-space.list-permissions` | implemented | Direct/inherited/self/administrator source is explicit. |
| `perm-set` | `content-space.change-permissions` | implemented | Closed add/change/remove union; numeric member types remain adapter-private. |

## Team administration

| Supplier command | Provider-neutral SciForge operation | Status | Notes |
|---|---|---|---|
| `team-create` | `content-space-administration.createSpace` | implemented | Creates a shared Content Container through the canonical administration port. Agent input cannot choose the owner; Broker authority injects the current Principal. Complete stable Team enumeration must prove the label is absent before creation. |
| `team-list` | `content-space-administration.listSpaces` | implemented | Does not expose supplier team IDs. |
| `team-edit` | `content-space-administration.updateSpace` | implemented | Updates the exact root label. The public request and receipt carry no Administration revision. |
| `team-stick` | `content-space-administration.pinSpace` | implemented | Provider-neutral pinned state. |
| `team-unstick` | `content-space-administration.unpinSpace` | implemented | Provider-neutral pinned state. |
| `team-users` | `content-space-administration.listMembers` | implemented | Typed bounded member page returns each same-instance Provider directory user only as `{ member }`, reusable by remove, with no role or revision. |
| `team-member-add` | `content-space-administration.addMember` | implemented | Accepts one typed Provider directory user reference with no `expectedRevision`; complete stable member enumeration is required before mutation, with no Host cross-user mapping or caller-selected Connection. |
| `team-member-remove` | `content-space-administration.removeMember` | implemented | Accepts the listed Provider directory user reference with no `expectedRevision`; complete stable member enumeration is required before mutation. |
| `team.delete` | — | intentionally_excluded | **not-supported**: no command, contract, fallback, or destructive team lifecycle path. |

The typed OpenContent Team supplier surface exposes no atomic expected-state field. The five
root/member mutations therefore declare `concurrency.revision: "none"`; observation and post-write
reconciliation prove receipts, not CAS. Content Space binds every one of the ten Administration
outputs to the exact request and authority, rejects empty pages that carry `nextCursor`, and requires
unique progressing page identities. Binding drift on a read is `provider_unavailable`; drift after a
write or destructive operation is `outcome_unknown`, with no automatic retry.

## Collaboration and knowledge collections

| Supplier command | Provider-neutral SciForge operation | Status | Notes |
|---|---|---|---|
| `collab-list` | `content-space.list-collaboration-entries` | implemented | Browsing only; deleted records remain typed state. |
| `collab-search` | `content-space.search-collaboration-entries` | implemented | Bounded name search. |
| `collab-link` | `content-space.resolve-collaboration-invitation` | blocked_by_contract | Inventory only and absent from the admitted adapter union; no Provider invitation target is issued. |
| `kbox-list` (list) | `content-space.list-knowledge-collections` | blocked_by_contract | Inventory only and absent from the admitted adapter union; collection receipts are not contract-pinned. |
| `kbox-list` (keyword search) | `content-space.search-knowledge-collections` | blocked_by_contract | Inventory only and absent from the admitted adapter union; search receipts are not contract-pinned. |

## Native collaborative documents

These commands belong to the separate `native_document` contract, not ordinary Content Space file
mutation. The provider-owned adapter is implemented through the Content Space feature bridge; this
does not claim a separate DocumentProvider or any live-tenant verification.

| Supplier command | Provider-neutral SciForge operation | Status | Notes |
|---|---|---|---|
| `docflow-import` | `native-document:import` | blocked_by_contract | Inventory only. The pinned result cannot prove source identity or imported content, so SciForge blocks before source transfer or subprocess dispatch. |
| `docflow-export` | `native-document:export` | implemented | Closed `docx/pdf/markdown` format; Agent supplies a Workspace-relative destination and Host owns the stream. |
| `docflow-create` | `native-document:create` | implemented | Typed native-document content. |
| `docflow-update` | `native-document:update` | blocked_by_contract | The request is hash-bound, but the supplier does not atomically compare `baseHash` as part of the mutation. A read preflight would be TOCTOU. |
| `docflow-insert` | `native-document:insert` | blocked_by_contract | The request is hash-bound, but the supplier does not atomically compare `baseHash` as part of the mutation. A read preflight would be TOCTOU. |
| `docflow-edit` | `native-document:edit` | blocked_by_contract | Probe/plan evidence is checked locally, but the Provider does not atomically compare `baseHash` with the mutation. The remaining check/write race keeps dispatch blocked. |
| `docflow-undo` | `native-document:undo` | blocked_by_contract | The supplier does not atomically compare `baseHash` as part of the mutation; a prior read cannot satisfy the contract. |
| `docflow-redo` | `native-document:redo` | blocked_by_contract | The supplier does not atomically compare `baseHash` as part of the mutation; a prior read cannot satisfy the contract. |
| `docflow-image-upload` | `native-document:image-upload` | implemented | Bounded image media types; Agent supplies a Workspace-relative source and Provider receives managed bytes. |
| `docflow-image-download` | `native-document:image-download` | implemented | Exact image position; Agent supplies a Workspace-relative destination and Host owns the stream. |
| `docflow-read` | `native-document:read` | implemented | Typed native-document snapshot. |
| `docflow-probe` | `native-document:probe` | implemented | Read-only typed selector/capability probe. |
| `docflow-plan` | `native-document:plan` | implemented | Typed single-command dry-run plan. |
| `docflow-comment-create` | `native-document:comment-create` | blocked_by_contract | The supplier does not atomically compare `baseHash` as part of the mutation; selector and body bounds do not close the race. |
| `docflow-comment-list` | `native-document:comment-list` | implemented | Closed status filter. |
| `docflow-comment-get` | `native-document:comment-get` | implemented | Exact comment reference. |
| `docflow-comment-reply` | `native-document:comment-reply` | blocked_by_contract | The supplier does not atomically compare `baseHash` as part of the mutation. |
| `docflow-comment-solve` | `native-document:comment-solve` | blocked_by_contract | The supplier does not atomically compare `baseHash` as part of the mutation. |
| `docflow-comment-reopen` | `native-document:comment-reopen` | blocked_by_contract | The supplier does not atomically compare `baseHash` as part of the mutation. |
| `docflow-comment-delete` | `native-document:comment-delete` | blocked_by_contract | Destructive exact targeting is necessary but insufficient without an atomic `baseHash` comparison. |
| `docflow-last-delivery` | — | intentionally_excluded | Supplier-local conversation cache, not a provider capability. |
| `docflow-failure-list` | — | intentionally_excluded | Supplier-local diagnostic store. |
| `docflow-failure-get` | — | intentionally_excluded | Supplier-local diagnostic store. |
| `docflow-failure-prune` | — | intentionally_excluded | Supplier-local destructive maintenance. |
| `docflow-failure-recovery` | — | intentionally_excluded | Supplier-local recovery guide generation. |

## Explicitly prohibited surfaces

| Supplier surface | Provider-neutral SciForge operation | Status | Notes |
|---|---|---|---|
| `oc <METHOD> <url> ...` raw API passthrough | — | intentionally_excluded | No raw/generic provider request capability is admitted. |
| Undocumented CLI subcommands or bundled scripts | — | intentionally_excluded | Not part of the reviewed command inventory. |

## Current packaged canonical evidence

This is the sole public live-evidence ledger. It intentionally stores no environment-specific
Provider, Principal, account, root, resource, profile, or binding identifiers. Each row is scoped to
the exact operation and abstract authority class shown; it does not verify a composite workflow or
any sibling operation.

| Exact operation | Sanitized packaged outcome | Evidence | Declared readiness |
|---|---|---|---|
| `list-containers` | Personal-root bootstrap completed through the canonical packaged path with a zero-transfer result. | `live_verified` | `poc_only` / `verification_profile_required` |
| `observe-entry` | Observation completed against the exact authorized personal-root scope with zero transfer. | `live_verified` | `poc_only` / `verification_profile_required` |
| `list-entries` | A bounded listing completed against the exact authorized personal-root scope. | `live_verified` | `poc_only` / `verification_profile_required` |
| `upload-new` | The physical packaged UI completed a bounded 157-byte new-file upload; required pre-dispatch re-attestation matched and a refresh observed the new entry. | `live_verified` | `poc_only` / `verification_profile_required` |
| `download` | A bounded download completed from the exact authorized personal-root scope through the canonical packaged path. | `live_verified` | `poc_only` / `verification_profile_required` |

The re-attestation result above is path and safety evidence for `upload-new`; it is not a separate
OpenContent business operation. OpenContent still has **zero** `production_ready` operations.

### Supplier inventory and canonical packaged callability

The Connector-owned static contract freezes attachment CLI version `1.0.0`, exactly 86 supplier
inventory commands, and a reviewed 50-command admitted adapter union. The supplier `download`,
`file-list`, `kbox-list`, `file-internal-link`, `meta-modeldata`, and `collab-link` commands are
inventory-only and cannot reach the process transport. Ordinary `listEntries` and download remain
on the typed Connector path, and native export—including PDF—remains
`native-document:export`. The four unpinned directory searches retain Provider operation mappings
only to expose deterministic `blocked_by_contract`; their supplier commands are absent from the
Connector admitted union, so calls fail before supplier transport. `user-info` has no current
Provider mapping. A packaged application proves callability only through the
canonical Electron/Broker → Content Space → Provider → Connector smoke, never through a second
direct-CLI acceptance path. This is not `live_verified` evidence for any Provider operation and
does not admit a supplier command outside that union.

### Extended-operation packaged outcome

| Exact operation | Sanitized packaged outcome | Evidence classification | Declared readiness |
|---|---|---|---|
| `content-space.get-current-principal` | An earlier B-side invocation through the retired `user-info` mapping returned a typed current external principal for that exact authorized session. The current implementation instead uses the Connector-revalidated session identity and dispatches no supplier command. | Historical live evidence for the retired supplier route; not a live claim for the current semantic route | `poc_only` / `verification_profile_required` |

### Native-document packaged outcomes

These outcomes are acceptance evidence, but none is a native-document live success and none is
`live_verified`:

| Exact operation | Sanitized packaged outcome | Evidence classification | Declared readiness |
|---|---|---|---|
| `native-document:create` | Returned `outcome_unknown`; one unique new `.mdoc` was observed and was attributable to the attempt, but the typed outcome remained uncertain. | not `live_verified` | `poc_only` / `verification_profile_required` |
| `native-document:read` | Returned `provider_contract_error`. | not `live_verified` | `poc_only` / `verification_profile_required` |
| `native-document:probe` | Returned `provider_contract_error`. | not `live_verified` | `poc_only` / `verification_profile_required` |
| `native-document:plan` | Not executed; no packaged live evidence was produced. | not `live_verified` | `poc_only` / `verification_profile_required` |
| `native-document:edit` | Failed closed before adapter invocation or supplier process launch, with zero remote mutation. | packaged pre-dispatch fail-closed evidence; not `live_verified` | `blocked_by_contract` |

### Team-administration packaged outcome

| Exact operation | Sanitized packaged outcome | Evidence classification | Declared readiness |
|---|---|---|---|
| `content-space-administration.createSpace` | An earlier packaged invocation reached a remote commit but failed during Agent result delivery; it was not retried, and later canonical read-only reconciliation confirmed exactly one resulting shared root. After the delivery defect was fixed, exactly one new packaged Agent invocation traversed Broker → Content Space → Provider → Connector and reached terminal success. | post-fix invocation `live_verified`; earlier invocation remains remote-commit/reconciliation evidence only | `poc_only` / `verification_profile_required` |
| `content-space-administration.addMember` | Exactly one packaged current-account Agent invocation caused the canonical path to issue exactly one `SaveTeamUserList` write, and the write succeeded. Post-write `listMembers` reconciliation observed two distinct members, with the B-side canonical Provider directory user reference present exactly once. No second member write was issued, and no public role value is inferred from the historical response. | `live_verified` with exact read-after-write postcondition | `poc_only` / `verification_profile_required` |

The live Team-member response used a previously unmodeled `teamUser` collection key. A value-free
response-shape fingerprint identified the key without retaining account, member, root, or binding
values. A failing regression was added first, then the Connector parser and composed path were fixed
under TDD to accept the bounded collection while continuing to fail closed when a metadata-free
full page cannot prove pagination completion. The successful read-after-write result above is from
the fixed canonical path; the repair did not cause a duplicate member write.

### Unfinished additional live attempts

A later attempt to add current-run evidence for file `upload-new`, file `download`, and native-
document operations did not complete because the external Agent consumed operation references and
cursors inconsistently. Provider business-dispatch count and remote-write count were both zero for
those additional attempts, so they add no live evidence and do not invalidate the earlier cumulative
ordinary-operation rows. No native-document operation has a live-success claim: current native
callability remains supported by static/composed evidence, while the earlier packaged remote
outcomes above remain explicitly non-`live_verified`.

### Readiness and remaining evidence

- `implemented` records a canonical typed path only; it does not imply `production_ready`, executable PoC policy, Agent eligibility, or live acceptance.
- Readiness remains descriptive evidence even when an exact invocation is admitted. Admission additionally requires current Broker authority and, for unsafe/provider-scoped operations, a v2 binding attestation rechecked by the Connector before business dispatch.
- Same-file update and all ten hash-bound native-document mutations, including `edit`, remain `blocked_by_contract` until the Provider exposes an atomic exact-version/hash compare-and-mutate contract.
- Immutable-version observation remains blocked, so OpenContent results remain live `ContentFileReference` values or native-document receipts rather than `ArtifactReference` values.
- Project provisioning is absent from Content Space and the OpenContent Provider: there is no capability, operation, intent/report schema, or Provider port. Cloud Task handoff remains deferred until Cloud Collaboration supplies a separately reviewed binding, typed file intents, and Task-turn resource lifecycle; Content Space exposes no Task port.
- Extended rows marked `implemented` have a canonical typed adapter and Content Space dispatch path only. A resource grant cannot promote their readiness.
- Team Administration exposes no member-role mutation or ownership-transfer delegate. Team deletion remains not-supported.
- Installed-attachment callability, one exact live read, or one exact Team administration success does not promote a sibling command, operation, root, authority, audience, Principal, or binding. OpenContent remains at zero `production_ready` operations.

## Evidence required for promotion

Promotion is one reviewed code-and-documentation change per exact operation. Evidence for one row
does not promote a sibling row, the same operation on another root or Connector binding, or an operation
reached through another path.

Every promotion record must include:

- the exact SciForge commit, packaged application identity, platform, Connector and Provider package versions, and
  private overlay identity/digest when used;
- the exact Provider Instance, complete Host Principal snapshot (including assurance),
  authority/root, operation ID, audience, verification-profile identity, enforced limits, validity
  window, and opaque Provider Binding Attestation when required; raw credentials and external
  account identifiers must remain outside the record;
- a run through the packaged Broker → Content Space → pinned Provider → Connector path, including
  pre-dispatch Connector re-attestation, with the canonical
  request digest, invocation/receipt identity, timestamp, bounded result, and postcondition;
- least-privilege authorization and relevant negative evidence, including wrong Principal/root,
  revocation, collisions, cancellation/deadline, ambiguous outcomes, and no blind retry after a
  write may have taken effect; and
- cleanup or retained-test-resource records that contain no credentials, raw endpoint secrets, or
  supplier payload.

Mock tests, source-only Electron runs, direct SDK/API/CLI probes, package installation, static
adapter coverage, and historical tenant observations are supporting evidence only. None is a
packaged canonical-path live pass.

### Atomic same-file CAS and `UPDATE` versus `UPGRADE`

`updateFileVersion` and every hash-bound mutation stay blocked until the Provider freezes and the
packaged path proves all of the following:

1. one authoritative immutable version/revision/hash value returned by an exact observation;
2. one mutation request that carries that exact value as an expected-state precondition;
3. one Provider-side atomic compare-and-mutate transaction, not pre-read followed by upload;
4. a deterministic stale-precondition conflict with proof that no bytes, document state, metadata,
   version, or partial side effect changed;
5. a successful response that identifies the newly committed version/state and can be observed
   without guessing; and
6. concurrent two-writer tests that demonstrate one commit and one zero-mutation conflict.

The pinned supplier documentation currently calls the same-file mode `UPGRADE` in one section and
`UPDATE` in another. Before implementation or promotion, the supplier must freeze the exact wire
enum, endpoint, request fields, expected-version field and comparison semantics, whether the call
creates a new version or replaces current state, response version identity, and stable conflict
error. SciForge must then pin that single contract and reject the other spelling; aliases and
read-before-write emulation are not accepted.

A no-network static characterization on 2026-08-21 confirmed the negative result for the current
pinned snapshot. SciForge first verified the optional `opencontent-attachment-assets` receipt at
version `1.0.1` and then read only its receipt-covered `references/transfer.md` and `cli/bin/oc.js`;
it also read the public offline SDK
snapshot (SHA-256 `d39492835c823f64d8a4283dcf3a279be64fa05bc5e277cdf53ea010cab92a76`). The documented and
implemented update inputs contain `fileId`, `fileModel`, and `strategy`, but no expected immutable
version, revision, `baseHash`, or `If-Match` precondition. `FileVerId`/`fileVerId` is response-only.
The attachment CLI sends `UPDATE`, and a same-name `610` response carrying `ExistedFileId` causes
it to retry automatically as `UPDATE`; the SDK overview still says `UPGRADE` while its detailed
request table says `UPDATE`.

This resolves the current snapshot only as **contract absent and spelling conflicted**. It is not a
supplier guarantee for another version, live CAS evidence, or production promotion. Because the
request has no atomic expected-state field, a concurrent two-writer same-file CAS experiment would
test only last-writer behavior and was not dispatched. Same-file mutation therefore remains blocked.

Native `edit` is subject to the same rule: a local plan receipt, one-time token, probe, `baseHash`
check, write-time re-read, or post-write digest does not prove atomic Provider comparison.

### Immutable `ArtifactReference` evidence

`observeImmutableVersion` and `ArtifactReference` issuance stay blocked until OpenContent proves:

- a stable Provider-issued immutable version identity distinct from the mutable latest file;
- a version-specific read/download operation that accepts that identity directly;
- byte-for-byte retrieval of the old version after one or more newer versions are committed;
- a documented retention/deletion policy under which that identity cannot silently resolve to
  different bytes, plus stable missing/retired behavior; and
- packaged-path digest verification of the exact retrieved version under the current Principal.

A file ID, latest-version number, response digest, or locally retained bytes is insufficient.
`ArtifactReference` values remain non-authorizing and must still resolve through the current Principal's
Provider connection and authorization.
