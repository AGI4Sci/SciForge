# SciForge Research PPT UI Kit

`sciforge_research` is a small ppt-master-compatible research presentation preset.
It is designed for SciForge output decks that consume already interpreted evidence,
existing DataFigure/plot assets, citations, and writing drafts.

This preset is opt-in. SciForge PPT generation should default to `stylePreset: auto`
so ppt-master Step 4 can choose the appropriate business, teaching, product, lab, or
research style for each deck.

Production rules:

- Use these files as layout and style guidance for ppt-master, not as a separate deck generator.
- Keep raw scientific modalities in Model Router / sci-modality flows.
- Place existing SciForge figure assets from `images/sciforge_figures/` with traceable captions.
- Keep body content inside the `1280x720` canvas safe area `x=64..1216`, `y=56..650`.
- Reserve `y=628..676` for provenance/source footer text only.
- Write long content as explicit multi-line SVG text blocks with a declared `data-max-width`.
- On figure pages, make the figure the dominant object and anchor evidence callouts to meaningful plot regions.
- Preserve ppt-master Step 4 Eight Confirmations and sequential per-page SVG authoring.
- Satori may be evaluated for controlled component rendering later, but this MVP path is static SVG.

Source-release provenance:

All five SVGs are newly authored plain-text layouts, expressly approved by the
project owner under Apache-2.0; no historical drawing is retained. Reproduce with
`python3 scripts/generate-source-assets.py` from the repository root. Existing
placeholder tokens and presentation roles remain, with a blank main-figure slot,
leader lines for caller-supplied figure annotations and source footer. This does
not grant rights over figures users insert. No font file is embedded.

Layouts:

- `01_cover.svg`: title and project context.
- `02_research_question.svg`: problem framing and evidence chips.
- `03_method_pipeline.svg`: method or agent workflow.
- `04_figure_evidence_callout.svg`: existing figure with evidence callouts.
- `05_results_validation.svg`: results, validation, and next steps.

Layout QA:

- `preset.json` exposes a `layoutContract` that tests can read.
- `npm run layout-check` checks the UI kit templates and the bundled demo deck for text overflow, body/footer collisions, and safe-area drift.
- The checker complements ppt-master's `svg_quality_checker.py`; it does not replace the required ppt-master technical QA before finalize/export.
