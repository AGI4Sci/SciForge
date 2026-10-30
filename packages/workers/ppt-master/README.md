# SciForge ppt-master MCP service

Standalone stdio MCP service that exposes ppt-master as a SciForge scientific presentation
output stage. The service does not vendor ppt-master; it expects the local skill directory at
`~/.codex/skills/ppt-master` or `PPT_MASTER_SKILL_DIR`.

The ppt-master scripts require Python 3.10+ syntax. SciForge's generated MCP config sets
`PPT_MASTER_PYTHON` to the bundled Codex Python when it is available, and the service
uses the same bundled Python fallback before trying system `python3`. A local system
Python 3.9 installation is therefore fine as long as the bundled runtime exists.

It intentionally exposes only staged operations: project setup, SciForge intake bundling,
source conversion, quality checks, post-processing, and export. SVG page generation and
Step 4 confirmation remain in the main agent flow.

## Presentation styling

`ppt_master_sciforge_intake` defaults `stylePreset` to `auto`, so SciForge can make
PPTs without forcing every deck into a research-paper visual style. The final audience,
tone, color, typography, and image approach still belong to ppt-master Step 4.

The service also includes an optional static UI kit at `ui-kit/sciforge_research/`.
Use `stylePreset: "sciforge_research"` only when the caller explicitly wants a
restrained academic preset with five ppt-master-compatible SVG layout templates:

- cover
- research question
- method pipeline
- figure + evidence callout
- results / validation summary

The intake can receive existing SciForge figure assets through
`figures: [{ path, title, caption, source, evidenceIds, altText, kind }]`.
Those files are copied into the ppt-master project under `images/sciforge_figures/`
and recorded in `sources/sciforge_manifest.json` as `presentation-figure-asset`.
Raw scientific modality files still stay in Model Router / sci-modality evidence flows.

Satori is treated as a future controlled component-rendering candidate only; this MVP
does not add Satori as a production dependency and does not bypass ppt-master's
Step 4 confirmation or sequential SVG generation rules.

The optional UI kit also includes a lightweight layout QA pass:

```bash
npm --workspace @sciforge/ppt-master run layout-check
```

This checks template and demo SVGs for safe-area drift, text-slot overflow, and footer
collisions before the normal ppt-master quality/finalize/export pipeline.

```bash
npm --workspace @sciforge/ppt-master run start
```
