# Palmer Penguins long-chain research fixture

This directory contains a complete, offline copy of the curated
`palmerpenguins::penguins` CSV. It is a small real-world biology dataset for
long-chain Research Checkpoint and Artifact Version tests. Runtime tests must
not download or silently replace it.

## Provenance and integrity

- Upstream: [allisonhorst/palmerpenguins](https://github.com/allisonhorst/palmerpenguins)
- Frozen commit: `c19a904462482430170bfe2c718775ddb7dbb885`
- Upstream path: `inst/extdata/penguins.csv`
- Exact download:
  `https://raw.githubusercontent.com/allisonhorst/palmerpenguins/c19a904462482430170bfe2c718775ddb7dbb885/inst/extdata/penguins.csv`
- SHA-256: `f204db2c753b0937caac3cb35258562c14f073e4bbc76be24b4c51ce22767a93`
- Size: 15,241 bytes; 344 observations plus one header; 8 columns
- License: CC0-1.0
- Package citation: [doi:10.5281/zenodo.3960218](https://doi.org/10.5281/zenodo.3960218)
- Source study: [doi:10.1371/journal.pone.0090081](https://doi.org/10.1371/journal.pone.0090081)

The fixture includes missing measurements. A test must record the selected
missing-data policy as research intent; it must not mutate the source snapshot.

## Suggested 15-version vertical scenario

Use one stable Research Checkpoint Artifact ID for every iteration. Each turn
should commit an exact version and expose its exact version reference in the
chat record card and Research Dossier.

1. Declare the biological question, citations, source digest, and analysis plan.
2. Validate schema, row count, species, islands, sex labels, years, and units.
3. Audit missingness by column and by species.
4. Freeze the complete-case cleaning policy and publish a cleaned-table artifact.
5. Add species-level counts and morphometric summaries.
6. Add sex-stratified mass and flipper summaries within species.
7. Add island-by-species composition and document structural confounding.
8. Add year-stratified summaries and a temporal-sensitivity note.
9. Add a species-by-sex body-mass box or violin plot.
10. Add flipper-length versus body-mass scatter and correlations.
11. Add per-species linear slopes with uncertainty.
12. Add a species-by-sex adjusted model and diagnostics.
13. Add robust and leave-one-out sensitivity results.
14. Publish the final figure, derived tables, limitations, and evidence summary.
15. Restore version 7 as a new version, compare it with version 14, and verify
    that versions 1 through 14 remain byte-addressable and unchanged.

Minimum acceptance checks are: exactly 15 monotonically increasing versions on
one Artifact ID; distinct change reasons; exact input/output refs; old-version
activation never resolving through `latest`; version comparison surviving an
application restart; restore creating a new version rather than rewriting
history; and a deliberately wrong input digest failing closed.
