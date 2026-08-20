# OpenContent Skill Capability Matrix

Audit date: 2026-08-20

This inventory maps every admitted supplier command to a
provider-neutral SciForge contract. It is evidence, not runtime configuration and not permission
to invoke the supplier CLI or its raw HTTP passthrough.

The OpenContent Connector, Content Space Provider, SDK documentation, and SciForge-authored skill
runtime are public source. The original supplier attachment, its extracted files, and its private
distribution metadata are not published; see the
[attachment distribution boundary](./opencontent-attachment-distribution.md).

Matrix status is deliberately singular and conservative. It records contract and adapter evidence,
not `Content Space Capability Readiness`; in particular, `implemented` never means
`production_ready` or `live_verified`:

- `contract_verified`: a closed typed SciForge request/result/error contract exists; no runtime or live claim.
- `implemented`: the canonical SciForge runtime path exists, but this audit does not claim a current live pass.
- `blocked_by_contract`: a typed operation or adapter path may exist, but the Provider lacks the exact safe contract required for dispatch.
- `deferred`: the consumer integration is intentionally outside this delivery even though related lower-level contracts exist.
- `live_verified`: the canonical packaged SciForge path passed current live acceptance. No row currently has this status.
- `intentionally_excluded`: the command is not admitted to the public capability surface.

The contracts are provider-neutral. Supplier IDs, URLs, numeric member types, permission bitmasks,
CLI argument strings, and arbitrary request payloads are adapter-private translations.

## Current dispatch readiness

The public contracts enumerate exactly **20 native-document operations** and **54 extended
operations**. Runtime availability is intentionally different from the inventory status above:

| Installation | `production_ready` / `available` | Blocked or omitted |
|---|---|---|
| Public checkout, without the private attachment | Provider discovery; the six ordinary file operations (`list-containers`, `list-entries`, `observe-entry`, `create-folder`, `upload-new`, `download`); all ten Team Administration operations; Project Content Directory provisioning; extended `updateTeamMemberRole` and `transferTeamOwnership` | The native-document feature is not registered. The other 52 extended operations are `blocked_by_contract` / `provider_contract_missing`. Portal targets and immutable-version observation remain blocked. |
| Valid private attachment installed | The same public capabilities; 11 native-document operations, including the canonical `probe` → `plan` → `edit` chain; 53 of 54 extended operations | Nine direct native-document mutations are `blocked_by_contract` because the supplier has no atomic hash compare-and-mutate contract. `updateFileVersion` is the sole blocked extended operation. Portal targets and immutable-version observation remain blocked. |

The nine blocked direct native-document mutations are `update`, `insert`, `undo`, `redo`,
`comment-create`, `comment-reply`, `comment-solve`, `comment-reopen`, and `comment-delete`.
The canonical `edit` operation is not a direct mutation: it consumes the exact probe/plan evidence
and is admitted only through that preconditioned chain. No operation is currently `live_verified`.

## Stage 1 acceptance surface

Stage 1 is a SciForge Content Space workflow, not a one-to-one supplier CLI inventory. These
Host/Broker capabilities are therefore recorded explicitly before the command matrix below.

| Acceptance surface | Canonical SciForge capabilities | Status | Notes |
|---|---|---|---|
| Installed Provider discovery | `content-space.list-provider-instances` | implemented | Returns trusted Provider Instance references only; it does not infer a Provider from a label or prompt. |
| Personal/shared root selection | `content-space.list-agent-root-candidates` / `content-space.authorize-agent-root` | implemented | Candidate labels are non-authorizing; authorization re-enumerates live state and issues one exact Broker root resource. |
| Personal-library file loop | `content-space.agent-list-entries` / `content-space.agent-create-folder` / `content-space.agent-upload-new` / `content-space.agent-download` | implemented | Uses the Provider-resolved personal root, bounded pages, no magic numeric folder ID, and no implicit overwrite. |
| Shared/Team-library file loop | `content-space.agent-list-entries` / `content-space.agent-create-folder` / `content-space.agent-upload-new` / `content-space.agent-download` | implemented | Uses the Team's real root container reference; Team identity and root folder identity remain distinct. |
| Team administration | `content-space.authorize-provider-administration` plus `content-space.agent-admin-*` | implemented | All ten OpenContent administration operations are `production_ready` / `available` through the public SDK/facade path. The Host issues one scoped grant and gates each exact operation before Provider binding; Team deletion is absent. |
| Project Content Directory provisioning | `content-space.agent-provision-project` / `ProjectContentSpaceProvisioningPort` | implemented | The operation is `production_ready` / `available` through the public SDK/facade path. Cloud supplies authoritative Project owner/member intent; the Provider creates or reconciles one Team root only after every verified identity binding resolves. Missing bindings return a typed `pending` report before any Team or membership write, never a guessed member. |
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
| `file-info` | `content-space.observe-entry` / `content-space.get-entry-info` | implemented | V1 observe exists; richer information contract is Stage 3. |
| `file-internal-link` | `content-space.resolve-internal-link` | implemented | Adapter returns a bounded HTTPS Provider target; Content Space core owns Host target issuance. |
| `file-edit` | `content-space.update-entry-properties` | implemented | Typed code, remark and security-level patch. |
| `sec-level-list` | `content-space.list-security-levels` | implemented | Provider security levels become opaque typed references. |
| `file-list` | `content-space.list-entries` | implemented | Existing bounded canonical directory listing. |
| `folder-info` | `content-space.observe-entry` / `content-space.get-entry-info` | implemented | Uses a Content Container reference, not numeric folder identity. |
| `create-folder` | `content-space.create-folder` | implemented | Existing V1 write path; current audit does not promote it to live_verified. |
| `folder-edit` | `content-space.update-entry-properties` | implemented | Folder code and remark use the same typed property contract. |
| `upload` (new file) | `content-space.upload-new` | implemented | Agent supplies a Workspace-relative source; Host opens the bounded managed stream. |
| `upload` (`fileModel=UPDATE`) | `content-space.update-file-version` | blocked_by_contract | The pinned CLI accepts update bytes but `file-info` exposes only `fileLastVerNumStr`, and `upload` has no atomic expected-version precondition. A preflight followed by upload would be TOCTOU, so no same-file update is advertised until the Provider freezes a real CAS/version contract. `replace-latest` also remains excluded because it overwrites the current version. |
| `upload` (`masterFileId`) | `content-space.add-attachment` | implemented | Attachment is distinct; Agent supplies a Workspace-relative source and Provider receives only the managed stream. |
| `upload` (`collab=true`) | — | intentionally_excluded | Stage 3 collaboration is browsing/invitation only; no alternate collaboration writer. |
| `download` (ordinary) | `content-space.download` | implemented | Agent supplies a new Workspace-relative destination; Host owns the no-overwrite destination stream. |
| `download` (`ispdfdownload=true`) | `content-space.export-file-as-pdf` | implemented | Agent supplies a new Workspace-relative destination; PDF bytes use the Host-owned stream and remain a Workspace write. |
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
| `meta-modeldata` | `content-space.list-metadata-choices` | implemented | Dynamic values become typed choice references. |
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

| Supplier command | Provider-neutral SciForge operation | Status | Notes |
|---|---|---|---|
| `user-info` | `content-space.get-current-principal` | implemented | Current bound external principal only. |
| `search-position` | `content-space.search-positions` | implemented | Typed directory-principal results. |
| `search-department` | `content-space.search-departments` | implemented | Typed directory-principal results. |
| `search-user` | `content-space.search-users` | implemented | Optional bounded department/position scope. |
| `search-user-group` | `content-space.search-groups` | implemented | Typed group references. |
| `perm-cates` | `content-space.list-permission-categories` | implemented | Closed target kinds and category references. |
| `perm-list` | `content-space.list-permissions` | implemented | Direct/inherited/self/administrator source is explicit. |
| `perm-set` | `content-space.change-permissions` | implemented | Closed add/change/remove union; numeric member types remain adapter-private. |

## Team administration

| Supplier command | Provider-neutral SciForge operation | Status | Notes |
|---|---|---|---|
| `team-create` | `content-space-administration.createSpace` | implemented | Creates a shared content space through the canonical administration port. |
| `team-list` | `content-space-administration.listSpaces` | implemented | Does not expose supplier team IDs. |
| `team-edit` | `content-space-administration.updateSpace` | implemented | Label update is revision-bound; owner transfer has one separate canonical operation below. |
| `team-stick` | `content-space-administration.pinSpace` | implemented | Provider-neutral pinned state. |
| `team-unstick` | `content-space-administration.unpinSpace` | implemented | Provider-neutral pinned state. |
| `team-users` | `content-space-administration.listMembers` | implemented | Typed bounded member page. |
| `team-member-add` | `content-space-administration.addMember` | implemented | Exact content user identity. |
| `team-member-remove` | `content-space-administration.removeMember` | implemented | Exact content user identity and revision. |
| role change (Stage 3 extension) | `content-space.update-team-member-role` | implemented | Typed Team Administration delegate maps `manager`, `internal`, and `external` to OpenContent Team identities 2, 3, and 4; no read-only role is admitted. |
| owner transfer (Stage 3 extension) | `content-space.transfer-team-ownership` | implemented | Typed Team Administration delegate; no per-operation confirmation. |
| `team.delete` | — | intentionally_excluded | **not-supported**: no command, contract, fallback, or destructive team lifecycle path. |

## Collaboration and knowledge browsing

| Supplier command | Provider-neutral SciForge operation | Status | Notes |
|---|---|---|---|
| `collab-list` | `content-space.list-collaboration-entries` | implemented | Browsing only; deleted records remain typed state. |
| `collab-search` | `content-space.search-collaboration-entries` | implemented | Bounded name search. |
| `collab-link` | `content-space.resolve-collaboration-invitation` | implemented | Adapter returns a bounded HTTPS Provider target; Content Space core owns Host issuance. |
| `kbox-list` (list) | `content-space.list-knowledge-collections` | implemented | Typed collection and root references. |
| `kbox-list` (keyword search) | `content-space.search-knowledge-collections` | implemented | Bounded collection search. |
| `file-list` on a knowledge root | `content-space.browse-knowledge-collection` | implemented | Explicit collection/root authority; no numeric folder handoff. |

## Native collaborative documents

These commands belong to the separate `native_document` contract, not ordinary Content Space file
mutation. The provider-owned adapter is implemented through the Content Space feature bridge; this
does not claim a separate DocumentProvider or any live-tenant verification.

| Supplier command | Provider-neutral SciForge operation | Status | Notes |
|---|---|---|---|
| `docflow-import` | `native-document:import` | implemented | Agent supplies a Workspace-relative source; the Provider receives a managed stream and returns a typed document. |
| `docflow-export` | `native-document:export` | implemented | Closed `docx/pdf/markdown` format; Agent supplies a Workspace-relative destination and Host owns the stream. |
| `docflow-create` | `native-document:create` | implemented | Typed native-document content. |
| `docflow-update` | `native-document:update` | blocked_by_contract | The request is hash-bound, but the supplier does not atomically compare `baseHash` as part of the mutation. A read preflight would be TOCTOU. |
| `docflow-insert` | `native-document:insert` | blocked_by_contract | The request is hash-bound, but the supplier does not atomically compare `baseHash` as part of the mutation. A read preflight would be TOCTOU. |
| `docflow-edit` | `native-document:edit` | implemented | Available only as the canonical `probe` → `plan` → `edit` chain. The exact plan evidence and precondition gate distinguish it from the nine blocked direct hash-bound mutations. |
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

## Initial verification summary

- `live_verified`: **0**. Live status requires a fresh packaged-app acceptance run through the canonical Broker/domain path.
- `implemented` records a canonical typed path only; it does not imply `production_ready`, executable PoC policy, Agent eligibility, or live acceptance.
- Same-file update and the nine direct hash-bound native-document mutations remain `blocked_by_contract` until the Provider exposes an atomic exact-version/hash compare-and-mutate contract. Canonical `probe` → `plan` → `edit` remains available through its own exact plan precondition gate.
- Immutable-version observation remains blocked, so OpenContent results remain live Content File References or native-document receipts rather than `ArtifactReference` values.
- Project Content Directory provisioning does not create Task handoff. Cloud Task handoff remains deferred until Cloud Collaboration supplies the binding, typed file intents, and Task-turn resource lifecycle; Content Space exposes no Task port.
- Stage 3 rows marked `implemented` have a canonical typed adapter and Content Space dispatch path only. A resource grant cannot promote their readiness.
- Team member role change and owner transfer use the typed Team Administration delegate. Team deletion remains not-supported.
