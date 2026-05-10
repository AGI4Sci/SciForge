---
name: scientific-reproduction
description: Generic bioinformatics reproduction playbook for data discovery, execution planning, degradation, and auditable negative or partial results without paper-specific shortcuts.
skillDomains: [literature, omics, knowledge]
outputArtifactTypes: [scientific-reproduction-profile, dataset-inventory, analysis-plan, figure-reproduction-report, evidence-matrix, claim-verdict, negative-result-report]
tags: [scientific-reproduction, bioinformatics, dataset-discovery, omics, benchmark, negative-results]
requiredCapabilities: [skill.scientific-reproduction.profile]
---

# Scientific Reproduction

## Description

Use this skill when a paper reproduction task needs a generic bioinformatics plan rather than commands tailored to one paper. It is designed for genomics, epigenomics, transcriptomics, sequencing, and table-first reproduction attempts where the agent must discover data, choose reusable tool classes, honor bounded budgets, and produce structured partial or negative results when evidence is missing.

## Required Inputs

- `paperRef`: workspace ref or citation metadata for the target paper.
- `claimRefs`: claim graph, figure map, or bounded claim summaries with locators.
- `discoveryHints`: accession strings, repository names, supplement locators, assay names, species, genome build, and expected file classes extracted from the paper.
- `budget`: maximum network probes, download bytes, CPU, memory, wall time, and retry count.
- `environmentProfile`: available local tools, Python/R packages, genome caches, annotation caches, and network policy.

## Reusable Outputs

- `scientific-reproduction-profile`: selected budget, tool classes, fallback policy, and fixture/provider selection.
- `dataset-inventory`: sources checked, accession candidates, assay/sample metadata, file classes, size estimates, license/access state, and availability.
- `analysis-plan`: analysis units, expected inputs, parameters, statistics, plots, and validation checks.
- `figure-reproduction-report`: per-figure attempt status, inputs, code refs, stdout/stderr refs, metrics, and caveats.
- `evidence-matrix`: claim-to-evidence links, supporting and contradicting evidence, missing evidence, and confidence.
- `claim-verdict`: one of `reproduced`, `partially-reproduced`, `not-reproduced`, `contradicted`, or `unverified`.
- `negative-result-report`: structured explanation when a scientific claim is unsupported or contradicted.

`missing-data-report` may appear as a derived draft or export note for humans, but it is not a formal runtime artifact type. Encode unavailable sources in `dataset-inventory.missingDatasets`, carry downstream uncertainty in `claim-verdict.missingEvidence`, and reserve `negative-result-report` for actual not-reproduced or contradicted scientific checks.

## Tool Classes

Select tool classes by data type and budget, then delegate execution to action providers or workspace tasks:

- Sequence reads: FASTQ validation, trimming/QC, alignment, deduplication, coverage, and downsampled fixture checks.
- Alignment tracks: BAM/CRAM indexing, coverage, read counting, fragment distribution, strand handling, and region slicing.
- Intervals and peaks: BED/narrowPeak/broadPeak normalization, peak calling, peak width classification, overlap, permutation, and distance-to-feature analysis.
- Signal tracks: bigWig summary, signal matrix, metaplot, heatmap-ready matrix, normalization checks, and replicate aggregation.
- Annotation: GTF/GFF/BED gene models, promoter/enhancer windows, genome build compatibility, orthology or symbol mapping when justified.
- Tables: CSV/TSV/parquet loading, schema inference, joins, missingness, effect size, statistical tests, and multiple-testing correction.
- Figures: plot recreation from structured tables, parameter sweep reports, and sensitivity comparisons.

## Budget Policy

- Default maximum discovery probes: 8 source checks across GEO, SRA, ENA, ArrayExpress, figshare, journal supplements, GitHub, and paper links.
- Default maximum download budget: 50 MB for smoke or benchmark runs; full reproduction requires explicit profile expansion.
- Default compute budget: 2 CPU, 4 GB RAM, 20 minutes wall time for local benchmark plans.
- Default retry budget: one retry per provider class; timeout retries must switch to a smaller query or a cached fixture.
- Large raw sequencing files are never downloaded in benchmark mode. Use accession metadata, processed tables, tiny fixtures, or emit missing data.

## Degradation Policy

Follow this order and record the chosen branch in the profile:

1. Use verified raw data when available, within budget, and scientifically necessary.
2. Use processed matrices, peak tables, or supplementary tables when raw data is unavailable or over budget.
3. Use a tiny fixture that preserves schema and edge cases when environment or genome caches are incomplete.
4. Use metadata-only inventory when files are available but too large for the active budget.
5. Record missing sources in `dataset-inventory.missingDatasets` and mark downstream claims as `unverified` or partial when discovery fails, access is restricted, or providers time out.

Never replace missing experimental data with paper prose. A missing source is a valid result, not a reason to fabricate evidence.

## Mock Benchmark Providers

Benchmark and smoke runs use the fixture cases in `tests/fixtures/scientific-reproduction/mock-dataset-discovery-cases.json`.

- `dataset-discovery-missing`: no accession or supplement resolves; expected output is a `dataset-inventory` with `missingDatasets`.
- `dataset-discovery-available`: accession metadata and tiny processed fixtures are available; expected output is a bounded `dataset-inventory` plus an `analysis-plan`.
- `dataset-discovery-timeout`: provider exceeds the discovery timeout; expected output records timeout diagnostics in `dataset-inventory` and degrades to metadata-only or missing data.

These cases must not make live network calls or download large data. They model provider behavior and expected contracts only.

## Verification Expectations

- Every dataset inventory row must include source, identifier, assay or file class, availability, size estimate or `unknown`, and evidence ref.
- Every missing-data entry must include reason, attempted source, retry/degradation action, and claim impact.
- Every analysis unit must declare input artifact refs, tool class, parameters, budget consumption, and expected output artifact type.
- Every verdict must cite evidence or missing-evidence refs and must not upgrade `timeout`, `missing`, or `over-budget` into success.
