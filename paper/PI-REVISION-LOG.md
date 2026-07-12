# SciForge paper PI revision log

## Round 1 — 2026-07-12

- Status: intermediate version; rejected at PI semantic review.
- Scope: initial rewrite of the Introduction and Contributions around native scientific objects, evidence governance, and scientific decision governance.
- Known gaps: Abstract/Conclusion remained on the old third pillar; modality boundaries, use-case status labels, 197/199 commit counts, L0--L5 layer count, and P0--P7 phase count were not yet reconciled.
- The generated `sciforge-report.pdf` is preserved to make this intermediate version reproducible and reviewable.

## Round 2 — 2026-07-12

- Status: intermediate version; rejected at PI semantic and layout review.
- Improvements: Abstract and Conclusion now use goal-scoped scientific decision governance; the 197/199 commit conflict, L0--L5 layer count, P0--P7 phase count, and informal expert-verification claim were reconciled; an explicit Evaluation section was added.
- Known gaps: the modality-format list does not yet match the hardened router implementation; MCFST run selection and tolerance remain unexplained; several implemented/validated/illustrative claims remain too strong; scoped-memory language is still broader than the current typed contract; the LaTeX log reports four visible overfull boxes.
- The generated `sciforge-report.pdf` is preserved as the Round 2 review artifact.

## Round 3 — 2026-07-12

- Status: intermediate version; rejected at PI implementation-alignment review.
- Improvements: terminology around goal-scoped governance, approval surfaces, architectural layers, and the implemented/validated/illustrative use-case labels was made more consistent; the document compiles without errors or undefined references.
- Blocking gaps: the modality paragraph still overclaims `.sdf/.mol` translation and protected preview/content-addressing for unsupported formats; research memory still claims hypotheses and failed attempts as typed persistent state; the AI4AI placeholder remains; reviewer/rebuttal still claims production scale; MCFST uses five selected runs and a 0.05 success tolerance without a preregistered rule; the cell-atlas paragraph conflates external curation/computed layers with native ECCITE-seq measurements; and the LaTeX log still reports five overfull boxes around the use-case forest figure.
- The generated `sciforge-report.pdf` is preserved as the Round 3 review artifact before the implementation-aligned Round 4 revision.

## Round 4 — 2026-07-12

- Status: failed execution; not published as an independent manuscript version.
- The agent applied only six surface-level wording changes, incorrectly judged the Contributions section as implementation-aligned, and stopped before compilation. Its useful edits were retained as input to the next round, but the attempt did not meet the PI checklist.

## Round 5 — 2026-07-12

- Status: accepted for scientific-content, implementation-alignment, and layout review; author metadata remains for the PI to supply.
- Scientific uniqueness is now framed as an end-to-end chain: fail-closed native scientific-object handling, provenance-attached expert observations as evidence candidates, explicit Evidence-DAG completeness breakpoints, immutable thread snapshots, and goal-scoped Project-DAG release decisions.
- File-ingress claims now match the code: protein sequences (`.faa`, conservatively classified `.fasta/.fa`), protein structures (`.pdb/.cif/.mmcif`), and molecules (`.smi/.smiles`); C2S is scoped to a worker API contract, while unsupported protected formats fail closed without raw-text fallback.
- Use cases use the same three evidence labels throughout. Reviewer/Rebuttal and MCFST are bounded validated prototypes with explicit limitations; the artifact-free cell-atlas workflow is illustrative future work and its heatmap is identified as a hard-coded synthetic schematic.
- The MCFST section reports the full 20-prediction mean (0.4617 ± 0.1964), selected-five statistic as post-hoc, run-count conflict, and non-preregistered 0.05 threshold instead of claiming formal reproduction success.
- The forest diagram was replaced with a compact classification table. Full compilation reports zero errors, zero undefined references/citations, and zero overfull boxes. `gui_completion_check` passed all 21 blocking checks with `clean=true`; the 25-page PDF passed rendered visual inspection.
- The title is unchanged. `Author Names`, email, and affiliation remain template metadata because no verified author information was provided.
