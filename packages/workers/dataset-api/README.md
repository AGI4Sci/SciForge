# SciForge Dataset API Worker

First-party MCP worker for API-backed dataset databases. It keeps a
workspace-scoped registry at `.sciforge/datasets/api-sources.json` and exposes
controlled tools to register databases, read metadata, and stream raw data into
the workspace dataset cache.

It also provides a deterministic, conversation-driven preparation layer. The
model discusses requirements and supplies strict JSON arguments; Dataset MCP
performs the actual processing without arbitrary shell, SQL, or Python. Every
write produces a new checksummed artifact and provenance manifest, never
overwriting the source.

The worker also exposes a curated biology-provider catalog. Catalog entries
describe metadata access, raw-data access, authentication, and whether the
provider needs generic HTTP, a provider-specific adapter, or an SDK/object
store adapter. A catalog entry does not claim that its adapter is implemented.

Tools:

- `dataset_api_catalog`: browse public biology providers and adapter requirements.
- `dataset_api_register_provider`: register an executable preset for NCBI, Ensembl, UniProt,
  UCSC, PubChem, ClinicalTrials.gov, KEGG, Reactome, QuickGO, STRING, or AlphaFold DB.
- `dataset_api_list`: list workspace-registered databases.
- `dataset_api_register`: register separate metadata and raw-data endpoints.
- `dataset_api_metadata`: retrieve metadata from a registered database with bounded transient-network retries and structured diagnostics.
- `dataset_api_raw_data`: stream format-validated raw bytes into a checksummed workspace artifact. FASTA, JSON, text, and binary validation are supported.
- `dataset_prepare_plan`: persist a draft or user-confirmed preparation plan.
- `dataset_profile`: profile JSON, JSONL, CSV, TSV, or FASTA and save a schema/quality report.
- `dataset_filter`: apply structured filter conditions under a confirmed plan.
- `dataset_select_columns`: select, rename, require, and default fields; optionally change output format.
- `dataset_transform`: apply allow-listed field normalization and scalar conversion operations without arbitrary code.
- `dataset_deduplicate`: remove duplicate records using explicit keys.
- `dataset_id_map`: map biomedical identifiers through an explicit mapping artifact with one-to-many, unmatched, and ambiguous-record handling.
- `dataset_id_map_provider`: use the fixed UniProt batch ID Mapping API, persist its mapping response and request provenance, then apply it through the deterministic mapping engine.
- `dataset_join`: perform deterministic inner/left/right/full joins and persist both sides' unmatched records as separate artifacts.
- `dataset_validate`: validate record counts, fields, types, ranges, uniqueness, missingness, and FASTA integrity.
- `dataset_publish`: create a release directory with data, manifest, schema, quality report, checksums, and full parent/plan provenance.

Processing artifacts use a stable fingerprint of the operation, parent
checksums, and parameters. Re-running the same confirmed plan reuses the same
verified artifact, while different content is never silently overwritten.
Raw downloads follow the same invariant: an identical re-fetch is reused and
a changed response is written to a checksum-suffixed version instead of
replacing the original. Raw request receipts are propagated through child
manifests into the final publication provenance.

NCBI Gene FASTA requests are provider-aware: SciForge resolves the Gene record's genomic accession, coordinates, and strand through ESummary, then fetches the actual sequence from Nuccore. A Gene text report is never accepted as FASTA. Dataset API failures should be retried through Dataset API itself or reported; agents must not bypass failures with shell or curl.

Authentication secrets are never written to the registry. A source may refer
to an environment variable containing a bearer token or custom header value.
Generic registered-source requests are GET-only, bounded by timeout and
response-size limits, reject cross-origin redirects, and require HTTPS except
for loopback development APIs. The UniProt ID-mapping adapter is the only
allow-listed POST workflow and cannot target an arbitrary URL.
Raw downloads support byte ranges and produce SHA-256 checksums without parsing
or transforming the source bytes.
