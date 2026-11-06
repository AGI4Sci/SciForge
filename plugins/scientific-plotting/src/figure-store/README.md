# Minimal scientific figure store

`index.ts` exports `FigureStore`, its filesystem/confirmation ports, inferred operation input types, and zod schemas. It imports Node crypto and path utilities, but performs no direct filesystem IO. Native DSH tools and UI orchestration inject the same authorized filesystem port.

```ts
const store = new FigureStore(authorizedWorkspace, permissionCheckedFiles, trustedConfirmation)
const imported = await store.create({
  documentId: 'figure-1', operationId: 'import-1', expectedDocumentRevision: 0,
  image: { revisionId: 'original', originalFilename: 'plot.PNG', bytes: snapshotBytes }
})
const document = await store.read(imported.documentId)
const baseline = document.revisions.find(r => r.metadata.revisionId === document.currentRevisionId)!.metadata
await store.addCandidate({
  documentId: document.documentId, operationId: 'generate-1',
  expectedDocumentRevision: document.documentRevision,
  baselineRevisionId: baseline.revisionId, baselineHash: baseline.image.sha256,
  image: { revisionId: 'candidate-1', originalFilename: 'candidate.PNG', bytes: generatedBytes },
  generation: { generationId: 'generation-1', recipe: actualRecipe, code: actualCode, inputs: actualInputs }
})
```

The exact persistent layout is:

```text
<authorized workspace>/.scientific-figures/
  store.json
  documents/<documentId>/
    document.json
    images/<revisionId>.<original extension>
    revisions/<revisionId>.json
    sources/<generationId>/recipe.json
    sources/<generationId>/code.py
    sources/<generationId>/inputs.json
```

Every persisted file path is relative to `.scientific-figures`. Port paths include the `.scientific-figures/` prefix and are relative to the workspace. Imported image bytes are copied exactly; filenames preserve the original extension including case. Imports have no fabricated generation data. Optional real generation recipe/inputs are validated finite JSON without absolute path strings/keys; canonical JSON is written with sorted keys. Python code is preserved as exact UTF-8 text. There is no cleanup or migration.

`read(documentId)` returns the complete validated document. `list()` returns `{documentId,path}[]`. `saveAnnotations` replaces annotations using the canonical normalized box/pin/arrow/freehand geometry and instruction fields. All mutations require a unique operation ID and an expected document revision. Creation expects zero; the first committed revision is one. `addCandidate` additionally requires the current baseline revision ID and SHA256. Candidate IDs cannot be reused. An image and its revision metadata are immutable and written before the atomic document commit. Acceptance only changes the current revision pointer.

`acceptCandidate` requires a confirmation callback supplied by trusted native orchestration at construction, outside caller JSON. The callback returns `{decision:'confirmed',confirmationId}` or `{decision:'cancelled'}`. Its request includes the exact candidate/current image hashes and expected document revision. The store releases the document lock while awaiting confirmation, then reloads all referenced files and rechecks the expected revision and baseline before committing. A cancelled confirmation records a cancelled operation and leaves the candidate pending. `rejectCandidate` and `cancelCandidate` mark the candidate terminal without changing current. Their request shape is `{documentId,operationId,expectedDocumentRevision,revisionId}`.

Revision metadata explicitly includes normalized `format`, original filename, SHA256 and image byte length. Trusted render orchestration may supply `requestKey` (SHA256 of the full canonical original request including action, parameters and input data contents) to creation/candidate operations and call `replayOperation(documentId,operationId,requestKey)` before rerendering. This returns the original result without regenerating timestamp-dependent image bytes, and rejects changed requests. Compute this key in native code; never take it from UI/tool JSON. Imports should omit this key so altered source bytes are rejected on replay.

Operation receipts and minimal exact operation results live inside the atomic document JSON. Repeating the same ID and same validated input returns the original result, even after later changes or restart; a changed input fails. A replay still verifies referenced files first. Results intentionally contain IDs, committed document revision and status rather than recursively embedding documents and previous receipts. Read separately to obtain current state. A failed mutation may leave unreferenced immutable files; an exact retry can reuse matching bytes. Mismatched orphan contents fail rather than overwriting them.

`store.json` is a durable discovery cache, not the sole authority. Creation commits `document.json` before updating the index. `list()` validates existing index entries and scans document directories for additional committed `document.json` files, then atomically reconciles the index. If the process stops or the index write fails after a document commit, the document remains readable by ID and a later `list()` discovers it. Retrying the original creation repairs the index and returns its original receipt. Partial directories without a committed document are ignored and retained. Missing/corrupt indexed documents and malformed indexes fail closed; there is no silent fallback. Every read verifies all referenced images, including rejected/superseded revisions, against hash and byte length, compares every immutable revision metadata file with its document entry, and verifies optional source files.

The filesystem adapter must authorize **every** underlying read, listing, parent creation, exclusive file creation, atomic staging/rename and lock IO through DSH, including symlink/containment checks. `read` returns null only for missing files; permission and other errors must propagate. `listDirectories` returns an empty array when its parent is absent. `writeImmutable` creates parents and exclusively creates a complete file; `writeAtomic` creates parents and atomically replaces a complete file. Durability/fsync behavior belongs to the adapter. All store instances in this process share document/index serialization by normalized absolute workspace root. Use the same canonical authorized root across instances. When multiple processes can write, the adapter must implement `withLock(workspaceRoot,key,run)` using shared exclusive locks (keys are safe document IDs or `@index`) and hold it through the callback. No document lock is held while updating the index or awaiting confirmation. Lock recovery after process failure is an adapter responsibility.

Run focused checks from the repository root:

```sh
node --import tsx --test plugins/scientific-plotting/src/figure-store/index.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types node plugins/scientific-plotting/src/figure-store/index.ts plugins/scientific-plotting/src/figure-store/index.test.ts
node node_modules/eslint/bin/eslint.js plugins/scientific-plotting/src/figure-store/index.ts plugins/scientific-plotting/src/figure-store/index.test.ts
```
