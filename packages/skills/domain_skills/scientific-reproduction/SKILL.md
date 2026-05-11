---
name: scientific-reproduction
description: Generic bioinformatics reproduction playbook for data discovery, execution planning, degradation, and auditable negative or partial results without paper-specific shortcuts.
skillDomains: [literature, omics, knowledge]
outputArtifactTypes: [scientific-reproduction-profile, dataset-inventory, raw-data-readiness-dossier, analysis-plan, figure-reproduction-report, evidence-matrix, claim-verdict, negative-result-report]
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
- `raw-data-readiness-dossier`: refs-first gate for raw-data reanalysis, including accession/license checks, download/storage/CPU/memory/time budgets, environment/genome/checksum refs, degradation strategy, and explicit approval state.
- `analysis-plan`: analysis units, expected inputs, parameters, statistics, plots, and validation checks.
- `figure-reproduction-report`: per-figure attempt status, inputs, code refs, stdout/stderr refs, metrics, and caveats.
- `evidence-matrix`: claim-to-evidence links, supporting and contradicting evidence, missing evidence, and confidence.
- `claim-verdict`: one of `reproduced`, `partially-reproduced`, `not-reproduced`, `contradicted`, `insufficient-evidence`, or `not-tested`.
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
- Large raw sequencing files are never downloaded in benchmark mode. Use accession metadata, processed tables, tiny fixtures, or emit missing data. Full raw-data execution requires a `raw-data-readiness-dossier` with `rawExecutionGate.allowed=true`, verified license/access, explicit approval, sufficient resource budgets, environment/genome/checksum refs, and passing readiness checks.

## Raw FASTQ/BAM Reanalysis Escalation

N6 escalation is metadata-only by default. When a task asks for FASTQ/BAM/CRAM/SRA-level reanalysis, first emit a `raw-data-readiness-dossier` with `rawExecutionGate.allowed=false` and an `n6Escalation` block that records:

- requested raw file classes and the reanalysis intent, such as QC, alignment, coverage, counts, peak calling, or figure reproduction.
- minimal runnable plan refs, including analysis-plan, environment lock, tool versions, genome/annotation/cache refs, checksum plan, and budget/approval refs.
- downsampled, region-sliced, or tiny fixture refs that can validate schema and command wiring without claiming scientific success.
- `stopBeforeExecutionUnlessReady: true`.

Do not claim `reproduced` from N6 preflight artifacts alone. Until code, stdout/stderr, statistics, and output figure/table refs exist, downstream verdicts must remain `insufficient-evidence` or `not-tested`. Full raw execution still requires the existing ready dossier gate plus explicit user approval and sufficient resource budgets.

## Degradation Policy

Follow this order and record the chosen branch in the profile:

1. Use verified raw data when available, within budget, and scientifically necessary.
2. Use processed matrices, peak tables, or supplementary tables when raw data is unavailable or over budget.
3. Use a tiny fixture that preserves schema and edge cases when environment or genome caches are incomplete.
4. Use metadata-only inventory when files are available but too large for the active budget.
5. Record missing sources in `dataset-inventory.missingDatasets` and mark downstream claims as `insufficient-evidence`, `not-tested`, or partial when discovery fails, access is restricted, or providers time out.

Never replace missing experimental data with paper prose. A missing source is a valid result, not a reason to fabricate evidence.

## Mock Benchmark Providers

Benchmark and smoke runs use the fixture cases in `tests/fixtures/scientific-reproduction/mock-dataset-discovery-cases.json`.

- `dataset-discovery-missing`: no accession or supplement resolves; expected output is a `dataset-inventory` with `missingDatasets`.
- `dataset-discovery-available`: accession metadata and tiny processed fixtures are available; expected output is a bounded `dataset-inventory` plus an `analysis-plan`.
- `dataset-discovery-timeout`: provider exceeds the discovery timeout; expected output records timeout diagnostics in `dataset-inventory` and degrades to metadata-only or missing data.
- `raw-reanalysis-escalation-preflight`: FASTQ/BAM/CRAM intent is detected, but network/download/compute remain disabled; expected output is a blocked `raw-data-readiness-dossier` with N6 escalation metadata plus `insufficient-evidence` verdict semantics.

These cases must not make live network calls or download large data. They model provider behavior and expected contracts only.

## Verification Expectations

- Every dataset inventory row must include source, identifier, assay or file class, availability, size estimate or `unknown`, and evidence ref.
- Every missing-data entry must include reason, attempted source, retry/degradation action, and claim impact.
- Every analysis unit must declare input artifact refs, tool class, parameters, budget consumption, and expected output artifact type.
- Every verdict must cite evidence or missing-evidence refs and must not upgrade `timeout`, `missing`, or `over-budget` into success.
