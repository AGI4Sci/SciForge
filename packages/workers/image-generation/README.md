# SciForge Image Generation Worker

First-party MCP worker for controlled image generation and VisualDocument-based image review.

`visual_generate` is the single visual-production entry point. It checks whether
the retained context answers every required question before selecting `code`,
`model`, or `hybrid`. When context is incomplete it returns targeted questions
for `research_search`; callers merge the evidence and call the same tool again.
Reaching a cost, round, token, elapsed-time, or no-progress limit locks a
draft-only plan instead of bypassing review. Every terminal route ends in
`image_generation_review_candidate`. Ready plans and execution stages return a complete
`nextCall`, so runtimes execute the locked handoff rather than reconstructing
cross-tool arguments.

Exact or hybrid diagrams may declare one normalized `VisualScene` in
`requirements.scene`. Layers explicitly assign ownership to `code` or `model`;
the planner derives the route from those owners. Vector geometry is mapped to
the scientific renderer, model-owned regions become the image brief, and a
hybrid route must execute truth render, model render, deterministic composite,
then review in that order. Raw vector-scene data outside this handoff is rejected.

The first version mirrors the scientific plotting worker pattern:

- plan without file writes
- render controlled image artifacts
- run manifest-bound candidate and release QA for generated image outputs
- convert VisualDocument review packets into edit intents
- write artifact manifests under `.sciforge/artifacts` for VisualDocument staging

If a Model Router image endpoint is configured, render/edit requests use the router's OpenAI-compatible `/v1/images/generations` contract. A deterministic placeholder exists only behind the explicit test/development flag; production rendering fails closed when Model Router image generation is unavailable.

## Routing boundary

The worker does not receive direct provider credentials. Managed launches pass only `SCIFORGE_MODEL_ROUTER_BASE_URL`, `SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY`, and the public router model alias; the Model Router owns the private image provider config, health, auth, and retry/error lifecycle.

New image or multimodal capabilities must not bypass the router layer. The image worker should stay focused on MCP tools, artifact manifests, and VisualDocument handoff unless product ownership is explicitly changed.

`image_generation_review_candidate` is scoped to manifest-bound outputs from the
locked generation workflow. It returns `publication_ready` or `draft_ready` only
when candidate QA passes. Repairable failures return `repair_required` with one
same-route repair action and a two-attempt ceiling; missing evidence returns
`needs_context`. These statuses govern image candidate/release handling only;
they are not native runtime visual-completion receipts.

`stageForVisualReview` is a handoff marker, not a direct VisualDocument mutation.
When a render request includes `visualDocumentId` / `threadId`, the worker records
those fields in the image manifest and artifact manifest so the VisualDocument
worker can stage the artifact through the single review workflow.

The unified revision path is: export a VisualDocument review packet, call
`visual_generate` with `action="revision"`, execute
`image_generation_edit_from_visual_review_packet` to create one non-destructive
candidate from the packet's annotations and normalized masks, run
`image_generation_review_candidate`, bind its artifact path,
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
