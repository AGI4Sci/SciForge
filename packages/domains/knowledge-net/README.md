# Knowledge Net

An optional trusted domain package that keeps literature-reading results as sealed records and answers "do we already know this concept?" from them. It exists so that a reader, a human or an agent, can look a term up while reading and see either the explanation accumulated from earlier papers, or an explicit gap.

This covers local knowledge records, library import and export, and an optional credential-gated Zotero connector.

## Capabilities

Eleven capabilities are workspace-scoped; `zotero.read` and `zotero.write` are global. All thirteen use the Capability Broker.

| Capability | Effect | What it does |
| --- | --- | --- |
| `knowledge-net.note.commit` | `workspace-write` | Seals one paper record as an immutable Artifact Version of kind `knowledge-net.record`. Idempotent per `operationId`. |
| `knowledge-net.resource.commit` | `workspace-write` | Creates or updates a sealed data resource using an explicit version baseline and durable operation idempotency. |
| `knowledge-net.resource.search` | `read` | Filters recorded resources and returns evidence, separate verification observations, duplicate candidates and coverage. |
| `knowledge-net.lookup` | `read` | Looks up one term in the concept index. Returns `hit`, `gap_unexcavated` or `gap_unknown`. |
| `knowledge-net.annotate` | `read` | Marks the spans of a text that match a known concept (`known`) or a reading target that has not been excavated yet (`unexcavated`). |
| `knowledge-net.library.import` | `workspace-write` | Reads one BibTeX or CSL-JSON file from the workspace and seals its entries as a `knowledge-net.library` version. Idempotent per `operationId`. |
| `knowledge-net.library.status` | `read` | Lists library papers as `read` (a sealed record with the same paper id exists) or `unread`, with counts. |
| `knowledge-net.library.pdfs` | `read` | Lists workspace PDF file names and pairs each with the library entry its file name fits, with the evidence and a score. No PDF is opened. |
| `knowledge-net.graph.export` | `read` | Projects the sealed records into a deterministic concept graph and serializes it as GraphML or JSON-LD. |
| `knowledge-net.document.export` | `read` | Folds every sealed record for one paper into a single Markdown or JSON knowledge document. |
| `knowledge-net.zotero.read` | `read` | Reads one page of the caller's own Zotero library over the Web API v3 and returns it as library entries. Off by default: fails closed without a stored credential. |
| `knowledge-net.zotero.import` | `workspace-write` | Reads one page of the caller's Zotero library and seals its bibliographic entries as a `knowledge-net.library` version. Off by default without a credential. |
| `knowledge-net.zotero.write` | `external-write` | Creates new Zotero items from prepared library entries. Confirmation-gated; bibliographic fields only; off by default without a credential. |

`lookup` outcomes:

- `hit`: the term, or an alias, or an inline sub-concept. Aliases are mined deterministically from what the record states: a Latin parenthetical in the definition's first line, and, for a term written as `偏心度偏置（eccentricity bias）`, both the Latin parenthetical (`eccentricity bias`) and the term without it (`偏心度偏置`). The result carries the explanation, the paper, and the exact `versionId` and `contentDigest` it came from.
- `gap_unexcavated`: the term was recorded as a reading target but has no explanation yet. This is a gap worth reading, not an error.
- `gap_unknown`: the term appears nowhere. Up to five near matches are returned as candidates, closest first: prefixes in either direction, then separator-folded prefixes and substrings (query ≥3 characters), then token subsets (multi-word query whose words appear in the term or an alias in stored order, with the stored term at most three times as long). Candidates never change the status.

## Data resources

Resources are independent `knowledge-net.resource` artifacts. A resource can link to several papers, and each paper can link to several resources. Components with different access conditions use separate records with an optional `parentResourceId`; access never inherits from a parent.

`resource.commit` takes `{ operationId, expectedVersionId: null, resource }` for creation. The receipt supplies the system-generated `resourceId`, `versionId` and `contentDigest`. Updates supply both `resourceId` and `expectedVersionId`, plus a complete resource snapshot. Artifact Versions performs atomic compare-and-swap. Existing evidence and checks remain unchanged prefixes; append new observations, using `supersedesCheckId` to correct an earlier check. Retry the same operation with its original payload, including its original baseline: durable replay precedes stale-version rejection, including after restart. A different payload under the same operation is rejected.

Resource content includes `schemaVersion: 1`, `name`, `aliases`, `identifiers` (`scheme`/`value`), `description`, nonempty `dataTypes`, `processingLevel`, `locations`, `access`, `paperLinks`, `evidence` and `checks`. Optional fields include release `version`, `parentResourceId`, `formats`, `sizeDescription` and `license`. URLs must use HTTP(S) and cannot embed credentials or common temporary signed access parameters. Keep stable public entry URLs, not signed download URLs.

Access modes are `open`, `registration`, `application`, `closed` and `unknown`. All declared modes except `unknown` require evidence; failure to find or retrieve data does not prove `closed`. Checks independently record `source_report`, `official_page`, `retrieval` or `integrity`, with `confirmed`, `failed` or `inconclusive` outcomes. Source reports identify their source. Confirmed integrity requires matching expected and actual SHA-256 digests. These rules validate the recorded claim's structure; actual retrieval and file verification happen outside this capability. Evidence `actorLabel` is self-reported, while `sealedAt` comes from storage.

`resource.search` supports text `query`, `resourceId`, `paperId`, `parentResourceId`, `dataTypes`, `accessModes`, `processingLevels`, `limit` and `cursor`. Different fields combine with AND; values within one field combine with OR. Text uses normalized contains matching; type tags match exactly after normalization. Resources sort by ID; cursors bind to filters and the derived snapshot. Restart a search after a cursor expires. Empty complete coverage means `no_recorded_match` in this workspace; partial absence means `coverage_unknown`. DOI and accession matches produce duplicate candidates, never automatic merges or uniqueness guarantees. Parent issues are diagnostic and do not suppress independent results.

`graph.export` 2.0.0 includes resource nodes and `uses`, `produces`, `mentions`, `part_of` edges. Referenced papers without notes and missing parents carry `referenceOnly: true`. Counts include resources and each relation. `document.export` 2.0.0 accepts exactly one `paperId` or `resourceId`; paper documents include related resource cards, and resource documents include the complete sealed snapshot with evidence and observations. Both remain on the canonical export path.

`node scripts/knowledge-net-resource-real-app-acceptance.mjs` exercises the normal packaged macOS application with clearly labeled synthetic records: create, search, append checks, stale conflict, replay, duplicate candidates, graph/document exports, restart and independent verification of both sealed versions' bytes. It retains evidence in an isolated profile. This technical acceptance does not claim scientific data availability.

## The library: which papers have I not read yet

`library.import` takes the bibliography export of a reference manager (Zotero exports both formats) and keeps only bibliographic metadata: id, title, authors, year, DOI.

- **Input**: a workspace-relative path to a `.bib` or CSL-JSON file (the format is detected from the first character, or given explicitly), and an `operationId`.
- **Confinement**: the path must be relative, and the real path of the target must stay inside the workspace. A parent-directory escape or a symlink that leaves the workspace is refused, as are directories and files over 8 MB. Nothing outside the workspace is read.
- **No PDFs, no network.** Only the text of the bibliography file is read. Importing never opens a PDF and never contacts Zotero, so there is nothing to authenticate and nothing that can leak.
- **Nothing is dropped silently.** An entry without a key or title, a duplicate key inside one file, an unterminated BibTeX entry or an entry beyond the 5000-entry limit is reported in `skipped` (the first 50, plus `skippedTotal`). A file with no usable entry fails and commits nothing.
- **What is stored**: the entries and the workspace-relative source path, never an absolute path.

`library.status` joins the sealed libraries with the sealed records on `paperId`. Use the BibTeX citation key (or CSL-JSON `id`) as `paperId` in `note.commit` so the two meet. When several imports contain the same paper id, the newest import's metadata is shown. `state` can be `all`, `read` or `unread`; results are capped by `limit` (default 100, at most 500) and `truncated` says whether more exist.

## PDFs already in the workspace

`library.pdfs` answers "which of the papers I have already downloaded?" without touching the PDFs.

- **Names only.** A PDF is never opened, parsed, copied or uploaded; only directory entries and file sizes are read. The file name is matched against the library entries: a DOI suffix (`s41586-025-09796-0.pdf`) is the strongest signal, a covered title (`attention is all you need.pdf`) is next, and a year raises the score. Each result reports `matchedBy` (`doi`/`title`/`year`) and a `score`, so the caller can judge the claim instead of trusting a yes/no.
- **Ambiguity is reported, not resolved.** When several entries fit the file name within a small window, `matched` is null and `candidates` lists them. A file that fits nothing stays unmatched. A wrong pairing would attribute one paper's notes to another, so the package refuses to guess.
- **Bounded scan.** Hidden directories, dependency trees and build output are skipped, symbolic links are not followed, the walk descends at most three levels, and at most 500 PDFs and 20,000 directory entries are visited. `truncated` and `truncatedReasons` say when a bound stopped the scan, so an empty result is never silently an incomplete one.
- **State, not proof.** A pairing says a file with a fitting name exists. It does not prove the file is that paper, that anyone read it, or that it matches the sealed notes' content.

## The concept graph and the knowledge document

Two read-only views fold the sealed records into something exportable.

- `graph.export` projects records into a concept graph: one `paper` node per record, one `concept` node per distinct term, and directed edges `paper → concept` for each excavated concept (`explains`) and each unexcavated reading target (`targets`). A concept shared by two papers is one node with two edges. The graph is deterministic (nodes and edges are sorted) and is serialized as **GraphML** (opens in Cytoscape/gephi) or **JSON-LD** (schema.org `ScholarlyArticle` / `DefinedTerm`). No link is invented: everything comes from a sealed record.
- `document.export` folds every record for one paper into a single **Markdown** or **JSON** document: concepts deduplicated by term (first observed definition wins, matching derivation order), reading targets, and all 4-layer notes. This is the "knowledge document layer" for one paper, not a peer-review summary.

## The record

Zotero writes require an `operationId` and at most 50 ordered entries. Retries
reuse deterministic account/operation/index keys with `version: 0`; existing
objects are never updated. Lost-response retries can report conflicts, not a
recovered success. Keep the original operationId when reconciling.
Zotero reads and imports return `scanned` and `nextStart` separately from usable
entry counts. An entirely filtered import page returns null artifact/version/digest
and commits nothing, while still reporting the next offset.

A record describes one paper. It must contain at least one concept, reading target or note.

```jsonc
{
  "schemaVersion": 1,
  "paperId": "hasson-2002",
  "title": "optional",
  "concepts": [{
    "term": "偏心度偏置",
    "definition": "…（eccentricity bias）。",
    "provenance": { "quote": "optional" },
    "contrastWith": "optional",
    "analogy": "optional",
    "subConcept": { "term": "…", "definition": "…" }
  }],
  "conceptTargets": [{ "term": "RSA" }],
  "note": {                         // optional 4-layer structured note
    "definition": "…",
    "roleInPaper": "…",
    "argumentativeRelation": { "relation": "support", "detail": "optional" },
    "criticalExtension": "…"
  }
}
```

Schemas are strict. A fifth note layer, a relation outside `support | refute | qualify`, an empty layer, or a layer over 4096 characters is rejected. Concept depth is capped at one inline sub-concept.

## How the index works

The concept index is a derived read model. It never holds write authority and is not stored.

1. On every `lookup` and `annotate` call the package lists the Artifact Version lifecycle events of the workspace and keeps the newest `version-committed` version of each artifact.
2. It reads each candidate, skips every artifact whose kind is not `knowledge-net.record`, and checks the stored content digest against the bytes it read.
3. A version whose digest does not match, or whose JSON fails the record schema, is skipped and counted in the derivation provenance. It is never trusted and never indexed.
4. The index is built from the remaining records. Each result reports `derivedFrom` with scanned event/version counts, record counts, `coverage` and `coverageReasons`. Coverage is relative to the caller-visible event stream, not all private records in the workspace.

One derivation scans at most 2000 events and reads at most 500 versions. A bounded event prefix cannot establish current versions, so it returns no indexed records rather than resurrecting old notes. Read caps, unreadable records and invalid snapshots produce partial coverage; lookup misses become `coverage_unknown`, and papers with no observed record become `unknown` instead of `unread`. Each `note.commit` seals a new artifact. Among records with the same `paperId`, only the newest caller-visible record is current. An invalid newest record does not revive an older explanation: a known paper is withheld, and an unreadable or unidentifiable newer candidate prevents indexing older notes whose currentness cannot be established. Historical sealed versions remain in Artifact Versions.

Because the index is rebuilt from sealed records, disabling and re-enabling the package loses nothing, and the records stay in the Artifact Versions store whatever happens to this package.

## What this phase does not do

Each item below is a deliberate later phase, not an omission by accident.

- **No evidence hand-off.** Records are sealed as Artifact Versions but are not yet handed to the Evidence DAG.
- **No user-facing switch.** The package is bundled and always on. A bundled package currently cannot be disabled by a user; that needs the Host change described in `add-bundled-domain-enablement`.
- **Zotero, off by default.** `zotero.read` fetches one page of the caller's own library and returns bibliographic entries; `zotero.import` seals that page as a library version; `zotero.write` creates new items from prepared entries (confirmation-gated). All fail closed unless `zotero.user-id` and `zotero.api-key` are stored in the Host secure facility. Writing notes back to existing items, and Notion write-back, remain later phases.
- **No UI or LLM extraction.** Records are written by an agent or another caller through `note.commit`; nothing writes them automatically from a library entry.

## Source layout

- `src/contract.ts`: record, note and capability schemas (zod, strict).
- `src/core/concept-index.ts`: pure functions: index building, alias mining, `lookupConcept`, `annotateText`. No dependencies.
- `src/core/library-parse.ts`: pure BibTeX and CSL-JSON parsers.
- `src/core/pdf-match.ts`: pure file-name to library-entry matcher with evidence and scores.
- `src/core/graph.ts`: pure concept-graph projection and GraphML/JSON-LD serializers.
- `src/core/document.ts`: pure per-paper knowledge document renderer.
- `src/workspace-file.ts`: workspace-confined file read.
- `src/workspace-pdfs.ts`: bounded, symlink-safe PDF name listing.
- `src/derive.ts`: rebuilds the index, the sealed records and the sealed libraries from Artifact Versions through the read and event-list ports.
- `src/resource-contract.ts`: resource schemas, source references and append-only update rules.
- `src/core/resource-index.ts`: deterministic resource search, duplicate candidates, cursors and relation diagnostics.
- `src/core/resource-document.ts`: complete resource-card exports.
- `src/resource-capabilities.ts`: resource commit/search definitions using public Artifact Versions ports.
- `src/main.ts`: capability composition and literature orchestration.

## Verification

```bash
npm --workspace @sciforge/domain-knowledge-net test
npm --workspace @sciforge/domain-knowledge-net run typecheck
npx vitest run src/main/modules/knowledge-net-domain.integration.test.ts
npm run domain-packages:check
npm run capability:check
```

The integration tests drive `note.commit`, `lookup`, `annotate`, `library.import` and `library.status` through the production capability registry, the real Broker and the real Artifact Versions domain in a temporary workspace, including independent explanations from multiple sources. PDF matching and exports also have package-level tests.

`node scripts/knowledge-net-real-app-acceptance.mjs` runs the normal packaged macOS app against the real Zotero Web API using `ZOTERO_API_KEY`. It provisions encrypted credentials in an isolated profile, imports a page, seals an explicitly labeled acceptance note, checks queries and annotations, exports both graph and document formats, restarts the application and independently verifies sealed bytes against the receipt digest. It does not create Zotero items or claim full-text reading. The script prints the retained evidence path; credentials are never printed.

## Multiple sources and coverage

`lookup` returns every matching explanation in deterministic `matches` order, retaining exact version/digest, quotes and conditions in the original text. A single match returns `hit`; multiple matches return `multiple_sources` without choosing one `concept` or automatically declaring a scientific contradiction. `targets` separately retains other papers' unexcavated reading targets even when a definition exists. A hit can still have partial coverage. Annotation only marks lexical matches; it is not scientific validation or a cross-source synthesis.

File reads reject Windows drive-relative paths, UNC/device paths and alternate streams across platforms. They use a bounded file handle and recheck identity/path/size/timestamps before returning. Directory junctions and symlinks are resolved; an outside target is rejected. These checks detect ordinary concurrent changes, not a security sandbox against hostile local processes mutating ancestor directories. A sealed literature record signifies a stored note, not a human reading certification or scientific acceptance.

`note.commit` creates a new immutable artifact for each new operation id. Derivation selects the newest committed version per artifact, then the newest caller-visible record per `paperId`; older sealed records remain in Artifact Versions but are not combined into the current explanation. A correction therefore needs a complete replacement record under a new operation id, including the concepts and targets that should remain current. Retrying an existing operation id uses the owner's idempotent receipt and must retain its original payload. A principal revoked after commit may receive an error even though the immutable write already exists; this is not evidence of rollback, so reconciliation must keep the same operation id.
