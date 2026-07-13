# SciForge Image Generation Worker

First-party MCP worker for controlled image generation and VisualDocument-based image review.

`visual_generate` is the single visual-production entry point. It checks whether
the retained context answers every required question before selecting `code`,
`model`, or `hybrid`. When context is incomplete it returns targeted questions
for `research_search`; callers merge the evidence and call the same tool again.
Reaching a cost, round, token, elapsed-time, or no-progress limit locks a
draft-only plan instead of bypassing review. Every terminal route ends in
`visual_artifact_review`.

The first version mirrors the scientific plotting worker pattern:

- plan without file writes
- render controlled image artifacts
- review image outputs
- convert VisualDocument review packets into edit intents
- write artifact manifests under `.sciforge/artifacts` for VisualDocument staging

If a Model Router image endpoint is configured, render/edit requests use the router's OpenAI-compatible `/v1/images/generations` contract. Otherwise the worker produces a deterministic local placeholder PNG so the MCP, manifest, and visual-review flow remain testable.

## Routing boundary

The worker does not receive direct provider credentials. Managed launches pass only `SCIFORGE_MODEL_ROUTER_BASE_URL`, `SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY`, and the public router model alias; the Model Router owns the private image provider config, health, auth, and retry/error lifecycle.

New image or multimodal capabilities must not bypass the router layer. The image worker should stay focused on MCP tools, artifact manifests, and VisualDocument handoff unless product ownership is explicitly changed.

`stageForVisualReview` is a handoff marker, not a direct VisualDocument mutation.
When a render request includes `visualDocumentId` / `threadId`, the worker records
those fields in the image manifest and artifact manifest so the VisualDocument
worker can stage the artifact through the single review workflow.

The unified revision path is: export a VisualDocument review packet, call
`visual_generate` with `action="revision"`, execute
`image_generation_edit_from_visual_review_packet` to create one non-destructive
candidate from the packet's annotations and normalized masks, run
`visual_artifact_review`, bind its artifact path,
SHA-256 hash, and timestamp to the candidate revision, then wait for explicit
human acceptance before replacing the source.

`image_generation_prepare` and `image_generation_render` are creation tools.
They must not replace packet-based editing for an annotated existing raster,
including when the locked route is `hybrid`.

## Diagram planning behavior

After `visual_generate` has selected a `model` or `hybrid` route, `image_generation_prepare`
normalizes the requested drawing into one of three render intents:

- `general_image`: ordinary image planning.
- `flowchart`: a lightweight flowchart brief with step order, labels, and arrows.
- `framework_diagram`: a structured paper/framework diagram spec plus a design plan.

For framework-style model architecture, method overview, workflow, or mechanism diagrams, `image_generation_render` writes sidecar files next to the PNG:

- `.diagram-spec.json`: the normalized framework diagram structure.
- `.framework-design-plan.json`: confirmation-oriented design intent and region plan.
- `.diagram-layers.json`: structured `DiagramLayerManifest v1` for reusable visual elements.

The render manifest and artifact manifest record these sidecar paths as `diagramSpecPath`, `frameworkDesignPlanPath`, and `diagramLayerManifestPath`. VisualDocument review can preserve these structured elements alongside the raster candidate without coupling the workflow to a particular editor.
