# Worker C Audit Summary

Scope: data/code discovery, dataset inventory, missing-data report, evidence matrix draft, and claim verdict draft for the 2020 and 2025 Cell Research seed papers. No `PROJECT.md` edits were made.

## Outputs

- `workspace/reproduction-worker-c/artifacts/dataset-inventory-draft.json`
- `workspace/reproduction-worker-c/artifacts/missing-data-report-draft.json`
- `workspace/reproduction-worker-c/artifacts/evidence-matrix-draft.json`
- `workspace/reproduction-worker-c/artifacts/claim-verdict-draft.json`
- `workspace/reproduction-worker-c/text/2020-prdm9.txt`
- `workspace/reproduction-worker-c/text/2025-setd1b.txt`
- `workspace/reproduction-worker-c/supplements/2020/table-s1.xlsx`
- `workspace/reproduction-worker-c/supplements/2020/table-s3.xlsx`
- `workspace/reproduction-worker-c/supplements/2020/table-s6.xlsx`
- `workspace/reproduction-worker-c/supplements/2025/table-s1.xlsx`
- `workspace/reproduction-worker-c/supplements/2025/table-s5.xlsx`
- `workspace/reproduction-worker-c/supplements/2025/table-s8.xlsx`

## Verified Locators

2020 PRDM9/H3K4me3/DSB fate paper:

- DOI/article: https://www.nature.com/articles/s41422-020-0281-1
- Main data: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE132446
- Reused SPO11-oligo hotspot data: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE84689
- Reused Prdm9 knockout DMC1/DSB proxy data: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE35498
- Reused PRDM9 affinity-seq data: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE61613
- Local text locators: `workspace/reproduction-worker-c/text/2020-prdm9.txt#lines=551-557` for data/code availability; `#lines=509-547` for ChIP-seq methods; `#lines=447-502` for NOMe/NDR methods.

2025 SETD1B broad H3K4me3 paper:

- DOI/article: https://www.nature.com/articles/s41422-025-01080-0
- Main data: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE242515
- Reused 2020 data: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE132446
- Comparator accessions from paper: GSE73952, GSM772836, GSM772948
- Public code clue: https://github.com/Ruitulyu/KAS-Analyzer
- Local text locators: `workspace/reproduction-worker-c/text/2025-setd1b.txt#lines=1473-1492` for data/code availability; `#lines=1462-1478` for broad-domain definition; `#lines=1380-1472` for analysis methods.

## Current Verdict

Package-level verdict: `insufficient-evidence`.

Reason: real public data and selected supplements are discoverable, but no raw/processed GEO materialization, no statistical rerun, and no figure reproduction were executed in this worker pass. Missing/request-only code is an operational/data-access limitation, not a scientific contradiction.

## Unconfirmed Items

- Detailed sample metadata for comparator accessions GSE73952, GSM772836, and GSM772948 was not materialized.
- Full supplement coverage was not completed; only high-priority tables S1/S3/S6 for 2020 and S1/S5/S8 for 2025 were downloaded.
- The GitHub repository license and exact match to the 2025 production pipeline were not evaluated.
- GEO raw/processed files were not downloaded; page-level availability should be followed by checksum/metadata capture in the next execution stage.
