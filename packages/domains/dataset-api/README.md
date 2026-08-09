# SciForge Dataset API Domain

Trusted domain package for API-backed dataset databases. It keeps a
workspace-scoped registry at `.sciforge/datasets/api-sources.json` and exposes
all access and preparation operations through SciForge's governed capability
broker. Custom endpoint and object-store connections are UI-only, confirmation-gated setup;
agents can use only preconfigured source IDs. Other callers share the same provider contract;
there is no Dataset-specific IPC or direct MCP transport.

It also provides a deterministic, conversation-driven preparation layer. The
model discusses requirements and supplies strict JSON arguments; Dataset API
performs the actual processing without arbitrary shell, SQL, or Python. Every
write produces a new checksummed artifact and provenance manifest, never
overwriting the source.

The worker also exposes a curated biology-provider catalog. Catalog entries
describe metadata access, raw-data access, authentication, and whether the
provider needs generic HTTP, a provider-specific adapter, or an SDK/object
store adapter. A catalog entry does not claim that its adapter is implemented.

Capabilities:

- `dataset-api.catalog`: browse public biology providers and adapter requirements.
- `dataset-api.register-provider`: register an executable preset for NCBI, Ensembl, UniProt,
  UCSC, PubChem, ClinicalTrials.gov, KEGG, Reactome, QuickGO, STRING, or AlphaFold DB.
- `dataset-api.list`: inspect workspace databases. `dataset-api.register` is a UI-only,
  confirmation-gated connection setup operation.
- `dataset-api.metadata` and `dataset-api.raw-data`: retrieve metadata and
  stream validated raw data with bounded retries, checksums, provenance, and a
  bounded text/FASTA/JSON preview for the conversation card.
- `dataset-api.register-object-store` and `dataset-api.list-object-stores`:
  register workspace-scoped S3-compatible private stores using environment
  variable references for SigV4 credentials, and inspect credential readiness
  without exposing credential values.
- `dataset-api.list-objects`, `dataset-api.object-metadata`, and
  `dataset-api.object-raw-data`: browse a bounded object page, inspect object
  headers, and stream complete or ranged objects into checksummed artifacts.
- `dataset-api.prepare-plan`, `dataset-api.confirm-plan`, `dataset-api.execute-plan`, and
  `dataset-api.resume-plan`: draft, broker-confirm, checkpoint, execute, and recover immutable
  preparation workflows. Every machine-readable `plan-*.json` is accompanied
  by a deterministic `plan-*.md` data-construction pipeline with sources,
  model roles, schema, quality gates, execution flow, outputs, and reproduction
  instructions.
- `dataset-api.profile`, `filter`, `select-columns`, `transform`,
  `deduplicate`, `id-map`, `id-map-provider`, and `join`: deterministic,
  code-free tabular and sequence preparation.
- `dataset-api.structure-profile`, `structure-validate`, and `graph-organize`:
  structure- and network-aware preparation.
- `dataset-api.materialize`: write bounded records accepted by a generated
  Create Loop as a checksummed JSON/JSONL/CSV/TSV artifact, retaining model,
  quality-criteria, loop, and parent-artifact provenance.
- `dataset-api.validate` and `dataset-api.publish`: quality-gate and publish a
  reproducible dataset release. Publication accepts a validation report only when its parent
  manifest covers the exact published primary artifact path and SHA-256.

Processing artifacts use a stable fingerprint of the operation, parent
checksums, and parameters. Re-running the same confirmed plan reuses the same
verified artifact, while different content is never silently overwritten.
Raw downloads follow the same invariant: an identical re-fetch is reused and
a changed response is written to a checksum-suffixed version instead of
replacing the original. Raw request receipts are propagated through child
manifests into the final publication provenance.
New published releases also include `data-construction-pipeline.md` in the
manifest and checksum set. Historical immutable releases are not rewritten;
their generated pipeline remains available as an adjacent release file.

Automatic execution state is stored under `.sciforge/datasets/runs`. A failed
execution returns a normal structured receipt with `resumable=true`, so the
conversation UI can render completed/failed steps, row-count changes,
intermediate artifacts, and a Retry / Resume action. Calling
`dataset_execute_plan` again does not skip the failure; continuation goes
through `dataset-api.resume-plan`, which accepts only the immutable `planId` and
deterministic `runId`.

Reviewable request templates are available in [`examples/ensembl-access-plan.json`](examples/ensembl-access-plan.json)
and [`examples/multi-source-synthesis-plan.json`](examples/multi-source-synthesis-plan.json).

NCBI Gene FASTA requests are provider-aware: SciForge resolves the Gene record's genomic accession, coordinates, and strand through ESummary, then fetches the actual sequence from Nuccore. A Gene text report is never accepted as FASTA. Dataset API failures should be retried through Dataset API itself or reported; agents must not bypass failures with shell or curl.

Authentication secrets are never written to the registry. A source may refer
to an environment variable containing a bearer token or custom header value.
Generic registered-source requests are GET-only, bounded by timeout and
response-size limits, reject cross-origin redirects, and require HTTPS except
for loopback development APIs. The UniProt ID-mapping adapter is the only
allow-listed POST workflow and cannot target an arbitrary URL.
Raw downloads support byte ranges and produce SHA-256 checksums without parsing
or transforming the source bytes.

S3-compatible registrations are stored separately in
`.sciforge/datasets/object-stores.json`. The registry contains endpoint,
bucket, allowed prefix, region, path-style selection, and credential environment
variable names only. Access and secret values are resolved at invocation time.
HTTPS is required by default; an internal HTTP endpoint must be registered with
the explicit `allowInsecureHttp=true` acknowledgement. Object keys are always
scoped below the registered prefix, listings are bounded to 1,000 keys per
page, and downloads default to a 256 MiB limit with optional byte ranges.

## Real-service smoke testing

Run `npm run smoke:dataset-api:real` to exercise metadata and raw-data access
against the seven executable public presets not covered by the cross-source
acceptance fixture: NCBI, UCSC, PubChem, ClinicalTrials.gov, KEGG, QuickGO, and
AlphaFold DB. The smoke runner uses an isolated temporary workspace, validates
the downloaded format through Dataset API, reports only bounded receipts, and
removes its artifacts afterward.

Private S3-compatible access can be checked with
`node --import tsx scripts/dataset-api-real-smoke.mjs --private`. Configure it
with `DATASET_SMOKE_S3_ENDPOINT`, `DATASET_SMOKE_S3_BUCKET`, optional
`DATASET_SMOKE_S3_PREFIX`, `DATASET_SMOKE_S3_REGION`, and
`DATASET_SMOKE_S3_SOURCE_ID`, plus the process-only
`DATASET_SMOKE_S3_ACCESS_KEY` and `DATASET_SMOKE_S3_SECRET_KEY`. The private
smoke performs a bounded listing, HEAD metadata request, and 4 KiB ranged
download without persisting credentials or printing their values.
