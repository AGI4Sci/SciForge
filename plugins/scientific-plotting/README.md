# Scientific Figures — standalone DSH MVP

One native DSH bundle owns reproducible scientific plotting. It uses the live caller's `workingDirectory`, DSH sandbox policy and managed subprocess service. It does not require SciForge, Artifact Versions, Evidence DAG, Git Checkpoints or another review plugin. Existing unrelated domain packages and historical data are untouched.

## Build and artifact

From this directory, run `npm run typecheck`, `npm test`, `npm run build`, then `npm pack --ignore-scripts`. Install development dependencies first using your ordinary package manager when building a separate checkout; the build reads only package-owned configuration, and never searches upward for a SciForge Tailwind config. DSH public packages are supplied by the host. `zod`, React canvas UI helpers and rendering JS are bundled. React itself comes from the DSH browser module table.

The artifact includes `dist/main.js`, `dist/figure-worker.cjs`, `dist/client.js`, CSS, and exact `@napi-rs/canvas@0.1.100` JS plus the native package actually loaded by that Canvas instance. The build verifies its declared optional dependency, exact version, platform/architecture and binding real path, and copies physical packages under `dist/node_modules`. `dist/native-runtime.json` retains platform/architecture, Canvas version and native package identity. Rebuild for another platform/architecture or Linux libc; the artifact never relies on the host having Canvas installed. Install the packed tarball, not a source-directory link, to verify source independence. Pure Node selection fixtures run with `node --test scripts/canvas-runtime.test.mjs`; they do not establish that a real native binary loads in an installed artifact.

This MVP targets native DSH >=0.2.1-rc.4 <0.3.0. The plugin registers the `scientific_figures` tool and `/scientific-figures` session command. Its native Client module adds a collapsible Figures panel to the session composer dock. The same package also ships the generic SciForge iframe adapter, without depending on other domain packages.

## Runtime

Configure `pythonCommand` in the plugin's Cordis row to the actual executable you have verified contains Matplotlib. The default is `python3`; it is diagnostic fallback, not a claim that Matplotlib is installed. The plugin never installs Python or Python packages. Use tool action `status`, input `{}` to inspect the configured renderer. Missing Python/Matplotlib produces an explicit diagnostic and no substituted figure.

In the SciForge adapter, a plain executable name is resolved once during Host plan preparation using only absolute directories in the Host's own PATH, then bound as a canonical executable path. Relative paths, cwd search and plugin-supplied child PATH do not select that executable. An explicit absolute interpreter path is preferable when multiple installations exist. Electron's executable is never substituted for Python; the Host's separate approved Node configuration applies only to explicit Electron executable requests.

Artifact build portability is separate from execution support. The current SciForge Host rejects native process groups on Windows and confined operations on Linux (and other non-macOS platforms). On macOS it must successfully probe the actual sandbox backend; presence of `sandbox-exec` alone is insufficient. A successful `status` diagnostic or Canvas package build does not establish that an operation can execute under the required confinement. These failures do not downgrade policy or switch execution lanes.

Open the intended authorized workspace in DSH before using the plugin. All automatic data is derived from that current workspace as `.scientific-figures`, never an absolute development path. Relative source-image paths are restricted to that workspace; symlinks are rejected. Each operation resolves the calling session's actual current directory and file policy; binary and atomic IO run in a DSH-confined managed child. The immutable sandbox writable boundary remains the original session workspace, even if the current directory changes. Denial or unavailable confinement fails explicitly with no alternate data directory.

Start from data (AI writes Python) or existing data plus Python code. A provided image is optional comparison material, never a substitute for data/code. Every code revision freezes complete source files, parameters and selected data bytes. `saveCode` with omitted `inputPaths` inherits verified frozen parent inputs into independent child paths; explicit paths refresh data, and `[]` clears inputs. Transformed datasets must be persisted and explicitly snapshotted for the next step. Generated figures link the exact code/run/output. Optional `importBaseline` links a provided original image to a saved code revision as supplied/unverified provenance, without fabricating a historical execution.

The chat and file controls start live agent operations. Historical code, input, run and all image revisions remain available; a new run ID reruns the selected frozen code/input snapshot. Graphical annotation tools have been deleted.

Only Python + Matplotlib is implemented. `SnapshotExecutionAdapter` is the extension boundary; there is no R/MATLAB runtime, UI or dependency. Scripts save PNG figures and UTF-8 CSV/TSV/JSON/TXT analysis artifacts into `SCIENTIFIC_FIGURES_OUTPUT_DIR`, read explicit input snapshots from `SCIENTIFIC_FIGURES_INPUT_DIR`, and receive JSON parameters via `SCIENTIFIC_FIGURES_PARAMETERS_JSON`. The host directly manages Python with `-I`, bounded logs, deadline and cancellation; it narrows file-write confinement to a fresh staging directory even under full-access sessions, and refuses read-only/partial confinement. DSH also grants platform temporary writes and global reads/network; this is not a hostile-code security sandbox. Workspaces under platform temporary roots are refused to protect stored revisions. Run trusted scripts. After process-range termination, a trusted worker validates outputs and persists run records; failures/cancellations cannot publish.

Each selected input is snapshotted (64 MiB aggregate cap), rather than copying the entire data workspace. Frozen code is not re-read from the editing location during execution. Same run ID returns its original terminal result; an interrupted reservation is not automatically rerun. Use a new run ID only after inspecting the interrupted process. New environment records include Python/Matplotlib versions, implementation, executable, platform/architecture and installed distribution versions. This inventory is not a packaged environment, dependency binary lock or deterministic-reproduction guarantee. Logs are bounded. Successful runs retain PNG plus UTF-8 CSV/TSV/JSON/TXT, rejecting malformed JSON/text rather than silently dropping it. PNG limits remain 16 files, 20 MiB/file, 64 MiB aggregate; analysis artifacts have separate limits of 32 files, 8 MiB/file, 32 MiB aggregate. `_environment` is reserved: successful collection generates `requirements.txt` with exact installed version pins, `environment.json`, and `REBUILD.md`. These are not hash-locked packages or bundled binaries; installing is an explicit user action. Failed runs expose no publishable outputs.

**Formal acceptance requires an active agent tool call.** The panel’s “申请接受” sends a live conversation request through the generic host composer service. The actual tool call triggers one-time host human approval. Only `allowed-once` advances the pointer; denial/cancellation/unavailable approval preserves the current image. No browser approval substitutes for host authority.

## Tool input

Every call is `{action,input}`. The host derives workspace and confirmation authority; callers cannot supply `workspaceRoot` or `approvalGranted`. `list` uses `{}`; `read` uses `{documentId}`; `image` uses `{documentId,revisionId}`. Mutations include `{documentId,operationId,expectedDocumentRevision}`. `importOriginal` adds `path` and requires revision zero. `importBaseline` additionally takes a saved `codeRevisionId` and records supplied/unverified data/code provenance. `addCandidate` adds `path,baselineRevisionId,baselineHash`. Legacy annotation records remain readable; no graphical annotation interface is shipped. `acceptCandidate`/`rejectCandidate` add `revisionId`. `render` adds `request:{template,data,...}` and, for a candidate, baseline ID/hash. New document and operation IDs must match `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`.

Code operations: `saveCode` takes `{codeRevisionId,parentCodeRevisionId?,entrypoint,files:[{path,content}],parameters,inputPaths}`; inputs are explicit workspace-relative files; omitted `inputPaths` inherits frozen parent bytes. `executePython` takes `{runId,codeRevisionId}`. `listCodes/listRuns` take `{limit?:1..50,cursor?:string}` and return compact `{items,nextCursor,errors}` pages (default 20, descending ID order). They do not load source bytes, output bytes or full logs; `readCode/readRun` perform complete integrity verification on demand. Corrupt entries report per-record errors and do not hide later pages. `listPendingRuns` is loaded independently and reports reserved runs plus stage identity and `recoverable`. After process termination, a trusted immutable outcome is persisted before collection; staging is removed only after the terminal record is durably committed. Same-ID execution on a recoverable interrupted finalization reuses that stored outcome without spawning Python. No outcome means no automatic rerun or invented terminal result; active/unquiescent processes and orphan locks still require inspection. `publishRun` takes `{documentId,operationId,expectedDocumentRevision,runId,outputPath,baselineRevisionId?,baselineHash?}`; `outputPath` must be the exact reference path returned by the run. Failed runs cannot publish. Template `render` freezes its own code/run IDs deterministically from document/operation IDs; changed template requests with reused IDs fail.

`status` returns renderer diagnostics. Example original import: `{ "action":"importOriginal", "input":{"documentId":"figure-a","operationId":"import-a","expectedDocumentRevision":0,"path":"inputs/original.png"} }`.

## Persistence and protection

The 0.4 plugin's `.scientific-figures` code/run/image records are independent storage. They do not automatically register ArtifactVersion records or Evidence DAG nodes with those domain owners; that integration requires their explicit public registration contracts.

```text
<workspace>/.scientific-figures/
  store.json
  codes/<code-revision-id>/
    code.json
    files/<entrypoint-and-helper-files>
    inputs/<selected-workspace-relative-files>
  runs/<run-id>/
    pending.json
    outcome.json            # trusted terminated-process receipt for finalization retry
    run.json
    outputs/<PNG-or-analysis-file>
    outputs/_environment/{requirements.txt,environment.json,REBUILD.md}
  documents/<document-id>/
    document.json
    images/<revision-id>.<original-format>
    revisions/<revision-id>.json
    sources/<generation-id>/
      recipe.json
      code.py
      inputs.json
```

New generated revisions link `execution:{codeRevisionId,runId,run,output}` to immutable code/run/output records. The legacy optional per-revision `sources` snapshot is retained when already present; new template and script generation use the shared code/run model. All stored JSON file references are relative. Documents retain original/current pointers, all revisions/candidate states, annotations, acceptance records, monotonic document revisions and compact original-result receipts. Accepting updates the pointer and records authority; image bytes are never overwritten or recopied. Every read verifies all referenced images, revision metadata and generated sources by hash and length. Missing or corrupt files fail visibly.

Writes serialize per document with exclusive cross-process locks and optimistic revisions. Confirmation releases the lock, then reloads and rechecks document revision, current baseline and candidate bytes before commit. Complete image/source/revision files are published before atomic document replacement. Discovery scans committed documents to repair a missed index update. Same operation and input return the original result after restart; changed content/inputs with a reused ID fail. A crashed worker can leave a lock: it fails closed and requires manual inspection, with no automatic lock stealing, migration or cleanup.

This plugin does not automatically export files; `exports/` is reserved for user-directed exports. The full manual installed-GUI, allowed approval and Matplotlib rendering acceptance must be completed in the configured local acceptance workspace. Source tests and a successful build alone do not establish those results.
