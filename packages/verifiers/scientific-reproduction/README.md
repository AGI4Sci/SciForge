# Scientific Reproduction Verifier

Generic verifier for scientific reproduction artifacts. It is intentionally paper-agnostic: checks are based on artifact contracts and evidence structure, not paper titles, genes, figures, accessions, or seed fixtures.

## Contract

- Provider id: `verifier.scientific-reproduction.generic`
- Capability id: `verifier.scientific-reproduction`
- Input: artifact-like records plus optional `artifactRefs`, `traceRefs`, `resultRefs`, and provider hints.
- Output: runtime-compatible verdicts `pass`, `fail`, `uncertain`, `needs-human`, or `unverified`.
- Scientific verdict vocabulary: `reproduced`, `partially-reproduced`, `not-reproduced`, `contradicted`.

## Checks

- Every claim has evidence refs, inline evidence, or an explicit missing-evidence reason.
- Every figure reproduction record has code, input data, parameters, stdout/stderr or log evidence, and statistical method/results.
- DOI/PMID/title/year/journal and accession records are represented as verified identifier records when required.
- Scientific verdicts use the reproduction vocabulary.
- Evidence is refs-first; bulky source text, tables, figures, logs, code, and datasets must be stored behind refs.
- Negative conclusions distinguish scientific non-reproduction/contradiction from operational failure and include motivation, data, code, statistics, and conclusion impact.

## Integration Note

This module defines minimal local structural types because the final Worker A artifact schema contracts may not exist yet. When those contracts land, replace the local artifact request interfaces with imported public package contracts while keeping the verifier behavior generic.
