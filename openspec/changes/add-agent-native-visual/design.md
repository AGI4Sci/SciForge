# Design: Agent-native visual perception and capture

## Context

SciForge already has most of the required mechanisms, but not one coherent
contract. The renderer publishes visible targets, the main process can capture
Electron surfaces, workspace image inspection can call Model Router, PDF tooling
can rasterize pages and crop normalized regions, and visual-production workers
can review generated assets. These mechanisms currently appear to the agent as
separate broker operations or managed MCP tools.

The earlier `unify-capability-broker` change intentionally restricted the owned
agent surface to four meta-tools. That is still the correct rule for product and
domain capabilities: flattening every registered action into a top-level tool
would create a stale and noisy catalog. Universal perception is different. A
text agent must be able to decide to look before it knows which product domain
owns the pixels, just as it can decide to read before understanding a file's
domain semantics.

This change therefore makes a narrow, explicit replacement to that decision:
the owned surface contains the four Broker meta-tools plus two Host Core visual
primitives. It does not reopen top-level tools for individual domains.

## Goals

- Give every owned agent runtime the same direct `sciforge_look` and
  `sciforge_capture` tools.
- Keep visual execution in Host Core rather than an installable domain package.
- Let any built-in or installed domain expose a visual source through one generic
  SDK and generated composition path.
- Hide capture coordinates, renderer tokens, provider sessions, Model Router
  credentials, and artifact transport details from the text model.
- Produce typed, digest-bound evidence for inspection, capture, persistence, and
  final verification.
- Make the PDF method-figure workflow one acceptance case of a source-agnostic
  design.
- Delete overlapping visual paths after atomic migration.

## Non-Goals

- Create an independently installable visual domain or worker package.
- Add one native agent tool per source, file type, UI surface, or visual task.
- Make domain packages import Host-private runtime code.
- Let visual inspection mutate a domain resource.
- Treat image generation and source extraction as interchangeable. Generation
  remains an explicit production operation and its result is inspected through
  the same native visual path.
- Guarantee semantic visual understanding when Model Router has no configured
  visual route. The runtime fails visibly with a structured, retryable or
  non-retryable receipt.

## Decisions

### 1. Two direct native tools are a deliberate Core exception

The stable owned agent surface becomes:

```text
sciforge_discover
sciforge_observe
sciforge_invoke
sciforge_events
sciforge_look
sciforge_capture
```

The first four remain the only generic transport for registered product and
domain operations. The latter two are implemented by the Agent Runtime's native
tool surface and are available without broker discovery.

Capability governance validates this exact set and rejects:

- additional `sciforge_*` native tools;
- source-specific tools such as `sciforge_pdf_capture`;
- reintroduced `gui_*` owned visual tools;
- a domain manifest that claims ownership of `sciforge_look` or
  `sciforge_capture`.

Both Codex and Claude Code use the same native-tool contracts and the same
Agent Visual Runtime. Runtime adapters translate transport events only; they do
not implement visual business logic.

### 2. Agent Visual Runtime is Host Core, not a domain package

The Agent Visual Runtime lives in application Core and owns:

- native tool argument/result validation;
- source selection and scope checks;
- immutable snapshot and opaque reference issuance;
- visual-model routing;
- cropping and persistence;
- proof storage and validation;
- retention and cleanup;
- normalized failures and audit events.

It is registered by the Host's core application composition. It is absent from
`packages/domains/*`, `sciforge.domain.json`, and the generated
`installed-domain-packages`, main-entry, and renderer-entry files.

The runtime may depend on public Domain SDK contracts and generic host services.
It must not import a concrete domain contract or select providers by domain ID,
plugin ID, MIME type, or a central feature switch.

### 3. VisualSource is the only source extension point

The Domain SDK defines one process-safe render contract:

```ts
type VisualSourceProvider = Readonly<{
  contract: {
    contractVersion: 1
    id: string
    resourceKinds: readonly string[]
  }
  render(
    request: VisualSourceRenderRequest,
    context: { signal?: AbortSignal }
  ): Promise<VisualFrame>
}>
```

The concrete contract uses opaque references and serializable payloads across
process boundaries. A provider may render an Electron element, PDF page, slide,
table range, scientific canvas, remote desktop, or existing image, but these
types do not appear in Host dispatch.

Installed domain packages contribute sources through their existing
process-specific entrypoints and standard manifest/generated composition. The
source registry is owner-aware, deterministic, duplicate-safe, staged, and
disposable. Adding or removing a source provider changes no Host feature map.

Host-built sources, such as the current SciForge surface, register through the
same source-registry contract but are part of Core composition, not fake
installed packages. Existing workspace files enter through the canonical
Workspace Preview capability and its resource-backed visual source.

### 4. Opaque refs bind semantic identity and visual layout

The runtime recognizes opaque resource references issued by the Capability
Broker and runtime-issued snapshot/artifact references. It never accepts a file
path as a visual source. Runtime-issued references are bound to:

- runtime and task caller;
- workspace scope;
- provider and source identity;
- semantic revision;
- optional layout epoch;
- an HMAC integrity signature.

Semantic and layout revisions remain separate. A scroll, resize, render, or
target movement does not invalidate semantic work. A visible-surface provider
refreshes layout immediately before acquisition. A hidden task must fail with
`visual_layout_unavailable`; it must never capture the new foreground task.

Snapshot and region references are immutable and scoped to a caller, workspace,
and turn. The model never manufactures or edits them. Normalized coordinates may exist inside
proofs and provider calls, but normal semantic extraction returns a `regionRef`
instead of asking the text model to calculate a crop.

### 5. sciforge_look performs perception, not persistence

The public input remains compact:

```ts
type LookInput = {
  sourceRef?: string
  targetRef?: string
  frame?: number
  task: string
  intent?: 'describe' | 'ocr' | 'locate' | 'quality-review'
  capture?: 'snapshot' | 'region'
  timeoutMs?: number
}
```

`timeoutMs` is the single bounded end-to-end inspection budget. It defaults to
180 seconds and accepts 30–600 seconds. A typed deadline failure reports the
budget that expired and an exact larger value for the one governed retry, so
the agent can adapt latency without changing the source, task, or capture plan.
Provider-stage failures returned before that deadline remain unchanged.

An existing workspace file must first be opened through the canonical Workspace
Preview operation. The returned `resourceRef` is the only file-to-visual handoff
accepted by `sciforge_look`.

The runtime:

1. resolves and authorizes exactly one source provider;
2. acquires an immutable snapshot at the latest valid layout;
3. hashes the pixels and records source provenance;
4. calls Model Router using its configured visual route;
5. validates the structured result;
6. binds returned regions to the snapshot digest;
7. stores an inspection proof and returns opaque refs plus compact evidence.

The output includes `snapshotRef`, typed observations, zero or more
`regionRef` values, uncertainties, and an `inspectionProofRef`. Raw base64
pixels and provider-local paths are not returned to the text model.

Model Router must return regions through a strict schema. Free-form prose that
mentions coordinates does not create a region. An observation cannot be
attested unless the source digest, request digest, response digest, provider,
model, and inspection time are present.

### 6. sciforge_capture materializes exactly what was selected

`sciforge_capture` accepts a `snapshotRef`, an optional `regionRef` returned by
`sciforge_look`, and an optional bounded purpose. It deliberately does not
accept an output path.

The runtime verifies the ref and source revision, performs deterministic crop
and encoding, writes atomically without following symlinks outside the
workspace, and returns:

- `artifactRef`;
- workspace-relative path and portable reference metadata;
- media type, dimensions, size, and SHA-256;
- source, snapshot, and region provenance;
- `captureProofRef`.

Capture never silently upgrades a requested region to the full page. If region
resolution fails, it returns a structured failure rather than a plausible
whole-page artifact.

### 7. Typed proofs replace textual completion guesses

Proof records are stored by the runtime and returned by opaque reference. Their
wire summaries are schema-validated and contain no executable authority.

```text
InspectionProof
  sourceRef + semanticRevision + snapshotSha256
  requestSha256 + evidenceSha256 + attestation

CaptureProof
  snapshotSha256 + selectedRegion + artifactSha256
  destination + provenance

ReferenceProof
  artifactSha256 + consumerRef + relation + consumerRevision

FinalInspectionProof
  artifactSha256 + inspectionProofRef + quality verdict
```

The consumer that persists an artifact reference owns reference validation.
The Agent Visual Runtime does not parse every document format, and no
agent-visible Markdown validator remains as a substitute visual-completion
path. A generic `artifact.reference-validation` receipt kind is reserved for a
real typed consumer execution intent; ordinary free text is not blocked on a
receipt no current consumer can issue.

A visual completion obligation specifies the required terminal state, for
example:

```text
looked
captured
referenced
final-inspected
```

Callers that already know the execution plan declare this chain through typed
`executionIntent` requirements. When an agent discovers an extraction
requirement later from a referenced template or resource, a successful
`sciforge_look` call can declare `capture = "snapshot" | "region"` and activate
the same receipt ledger from the native tool's typed arguments and attested
result. Region capture additionally requires `intent = "locate"`. This does not
reclassify prompt text. The dynamic plan requires the exact inspection receipt,
a linked capture of the declared kind, and a final look at the persisted
artifact; the Host persists a pending publication marker before accepting a
final answer.

The execution-integrity guard verifies proof existence, caller scope, proof
links, artifact digests, and ordering. It does not accept:

- a successful `sciforge_invoke` with unrelated visual-looking text;
- file existence or dimensions;
- an unattested screenshot;
- a reference to a different artifact digest;
- inspection performed before the final crop or edit;
- a model statement that the chain completed.

### 8. Extraction and generation remain explicit

Native perception does not decide whether a report should reproduce a source
figure or create a new explanatory visual. Task planning keeps that choice
explicit:

- source extraction uses `look` to locate the original, `capture` to persist it,
  and retains source provenance;
- visual generation uses its canonical generation operation, then uses `look`
  on the final generated artifact;
- generated material is marked as derived and cannot inherit a source figure's
  identity or caption.

Both modes use the same final inspection and consumer-reference proofs.

### 9. Existing implementations migrate behind the new runtime

The cutover reuses implementations where appropriate but removes their old
public identities:

- visible Electron surface capture becomes a Core `VisualSource`;
- workspace PNG/JPEG/WebP loading becomes a Core `VisualSource`;
- PDF page rendering and normalized cropping become a source implementation
  owned by the canonical document/preview provider;
- visual quality review becomes `sciforge_look` with
  `outputIntent.kind = "quality-review"`.

After callers migrate, delete:

- broker actions `surface.inspect` and `artifact.inspect`;
- managed `gui_pdf_render_image`;
- `gui_markdown_validate_images`, including its unused agent-visible validator,
  registration, schemas, and dead implementation;
- visual inspection use of generation-review paths; their independent
  release/candidate semantics remain outside Agent Visual Runtime;
- legacy prompt instructions, execution-guard tool-name special cases, direct
  IPC/MCP routes, and fallback branches.

No forwarding alias or permanent dual registration is retained.

### 10. Governance enforces the pending native proof chain

The Host derives `nativeVisualProofChainPending` from the same receipt ledger
that validates completion. It pushes that fact into each runtime's turn-scoped
governance snapshot. Runtime pre-tool hooks submit every supported tool call to
the shared execution governor before dispatch; the governor, rather than a
runtime-specific matcher, decides whether the call is relevant. While the chain
is pending it allows `sciforge_look` and `sciforge_capture`, and denies
non-native visual inspection and command execution with a stable failure code.
No runtime parses request text or maintains a second proof ledger.

Claude installs that callback directly on the SDK query after seeding the typed
turn state. Codex uses one SciForge-owned user hook inside its isolated managed
`CODEX_HOME`: startup lists the discovered hook through app-server, verifies
its exact source, command, event, and current hash, persists trust for only that
hash, reloads, and verifies it again. It neither writes system requirements nor
bypasses hook trust. Missing state, hook diagnostics, identity mismatch, or
failed trust verification prevents governed execution instead of silently
falling back.

External application work may still use trusted computer use. Unavailable visual
understanding is a visible failure, not permission to claim inspection. A
capture-only task may complete without Model Router evidence only when its
obligation explicitly requires capture rather than semantic visual
understanding.

### 11. The Host commits only validated final responses

Assistant output from a turn with execution obligations is a candidate, not a
committed user-visible result. The runtime-neutral Host delays candidate
assistant events until the terminal lifecycle arrives and the canonical
receipt ledger passes. On success it publishes the candidate exactly once
before the successful lifecycle, after durably persisting a publication commit.
The committed candidate does not reuse its earlier runtime sequence number,
because receipts may already have advanced the visible stream.

The persisted user item carries a typed pending marker. Thread-detail reads
fail closed until the matching commit marker exists, and admit only assistant
items created no later than that commit. On failure, cancellation, a refresh
race, late post-terminal output, or an integrity violation the Host discards
the candidate and exposes only non-assistant evidence plus the failed lifecycle
and structured error.

Rejected assistant items are also removed from thread-detail reads, and late or
replay subscribers consult the remembered rejection before publishing events.
Reasoning, tool receipts, and audit traces remain evidence; none can be promoted
into a successful final answer.

### 12. Source and packaged applications use the same composition

The native tool definitions and Core source registrations compile into the
Electron main output. Installed domains continue to come only from generated
manifest projections. Release packaging does not ship a second TypeScript
visual runtime or managed MCP fallback.

Packaged validation covers:

- presence of both native tools;
- current-surface or fixture-target capture;
- workspace-confined artifact persistence;
- PNG decoding/cropping and native canvas bindings where used;
- Model Router visual adapter availability and fail-visible behavior;
- absence of retired visual tool entrypoints.

Tests that require semantic model output use a local deterministic Model Router
stub. Smoke tests do not require external credentials.

## Risks and Mitigations

- **Native tools weaken the small-tool-surface rule.** Limit the exception to two
  exact Core names and add governance tests rejecting every other owned native
  tool.
- **A generic source contract becomes an implicit domain switch.** Resolve
  providers by owner-aware registrations and opaque source references; forbid
  Host imports and source-kind switches for installed domains.
- **Model-generated regions are inaccurate.** Require strict region schemas,
  deterministic crop, and final inspection of the exact artifact digest.
- **Proofs become ornamental metadata.** Store and resolve them in the runtime;
  completion checks opaque proof records rather than trusting caller-provided
  JSON.
- **Hidden tasks capture the wrong UI.** Bind visible sources to the starting task
  and verify visibility after on-demand layout refresh.
- **Packaged native image dependencies fail.** Exercise real capture and crop in
  unpacked application smoke tests and validate target-platform native bindings
  during packaging.
- **Migration creates temporary duplicate paths.** Perform an atomic cutover and
  make architecture checks fail while any retired public path remains.
- **A runtime executes a bypass before the observer can interrupt it.** Make the
  hard deny a pre-tool hook driven by the Host snapshot; keep post-event
  governance for recovery and audit only.
- **An unverified success message reaches the user before terminal validation.**
  Gate assistant publication in the Host and remove rejected assistant items
  from history and replay.

## Migration Plan

1. Add shared native-tool, source, artifact, and proof contracts plus fail-closed
   unit tests.
2. Implement the Core source registry and Agent Visual Runtime without exposing
   tools.
3. Move current-surface acquisition behind a Core `VisualSource` provider and
   expose workspace files only through Workspace Preview resource-backed
   `VisualSource` providers.
4. Add the Model Router structured inspection adapter, scoped reference stores,
   capture persistence, and proof validation.
5. Expose `sciforge_look` and `sciforge_capture` through the common native agent
   surface used by every owned runtime.
6. Add generic Domain SDK source contributions and migrate PDF/document
   rendering through generated domain composition where ownership requires it.
7. Integrate the typed completion chain and Host final-response publication
   barrier.
8. Add turn-scoped pre-dispatch runtime governance, migrate callers, then delete
   all superseded broker, MCP, IPC, prompt, and guard paths in the same cutover.
9. Regenerate capability documentation and run architecture, type, focused,
   full regression, source smoke, and packaged smoke verification.
