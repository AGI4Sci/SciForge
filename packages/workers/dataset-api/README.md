# SciForge Dataset API Worker

First-party MCP worker for API-backed dataset databases. It keeps a
workspace-scoped registry at `.sciforge/datasets/api-sources.json` and exposes
controlled tools to register databases, read metadata, and stream raw data into
the workspace dataset cache.

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

NCBI Gene FASTA requests are provider-aware: SciForge resolves the Gene record's genomic accession, coordinates, and strand through ESummary, then fetches the actual sequence from Nuccore. A Gene text report is never accepted as FASTA. Dataset API failures should be retried through Dataset API itself or reported; agents must not bypass failures with shell or curl.

Authentication secrets are never written to the registry. A source may refer
to an environment variable containing a bearer token or custom header value.
Requests are GET-only, bounded by timeout and response-size limits, reject
cross-origin redirects, and require HTTPS except for loopback development APIs.
Raw downloads support byte ranges and produce SHA-256 checksums without parsing
or transforming the source bytes.
