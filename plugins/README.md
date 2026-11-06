# SciForge plug-in services

Optional service modules. Model Router owns translator roles directly.

Scientific Compute is **retired** in both built-in domain and DSH plugin forms.
Historical plugin acceptance is not current installation or availability guidance.
Generic Host grants, lifecycle and G7 registration fixes remain supported; see the
[retirement note](../docs/operations/scientific-compute-retirement.zh-CN.md).

> The scientific-modality translator now lives as a **worker** at
> [`packages/workers/sci-modality-router`](../packages/workers/sci-modality-router) (port 3898,
> `POST /modality/translate`, four native-to-text experts), not as a plug-in. It is configured
> inside Model Router as `translators.scientific`; the GUI sidecar may convert
> `SCIFORGE_SCIMODALITY_SERVICE_URL` / `SCIFORGE_SCIMODALITY_SERVICE_TOKEN` into that router role.

## Biology Workbench is built in

Biology Room and Life Science Preview ship together in the built-in
`@sciforge/domain-biology-workbench` package as two submodules. They are not DSH
runtime plugins and require no market installation, plugin enablement or plugin
takeover. Their canonical paths are the generic CapabilityBroker and Workspace
Preview contributions; see the [built-in design](<../docs/operations/biology-workbench-built-in.zh-CN.md>).
Generic plugin SDK and market tooling remain available for actual plugins.

## Versioning-group DSH backend plugins

Runtime-plugin backends for the versioning domain group
(`feat/plugin-versioning-modules`, baseline `main @ e975be58`). Each plugin is a self-contained
DSH (detached session host) backend loaded through `ProcessExtensionHost`, with the cordis
`inject: ['tools']` / `apply(ctx, config)` shape. A tool that operates on the caller's
workspace declares `workspaceRoot` and a Host grant (`scope: 'workspace'` for compute/write,
`readResource: 'workspace'` for reads); the Host binds the caller workspace into that argument,
so a plugin never trusts a caller-supplied directory. The binding is preceded by the Host's own
workspace authority (`src/main/extensions/workspace-authority.ts`): a declared path is authorized
only when it is the configured workspace, one of the configured write workspaces, or a live
workspace-host Session root — canonicalised, symlink-resolved, and prefix-safe. Shared protocol
gaps and their current status are tracked in [GAPS.md](./GAPS.md).

| Plugin | Static counterpart | Tests | Notes |
| --- | --- | --- | --- |
| [`git-checkpoints`](./git-checkpoints) | `packages/domains/git-checkpoints` (main) | 21 | Git port fixture in DSH env; real `version-control.*` bridge blocked by G1. Auto-capture needs G2 turn events. |
| [`change-inspector`](<./change-inspector/README.md>) | None; independent plugin is the sole production implementation | 75/75 plugin tests; Host focused 14 suites / 495 pass (overlapping coverage, not additive) | Formal version **0.1.2** owns `change-inspector.open-session` / `change-inspector.list-changes`: 2 declared read tools plus a Host-derived generic session opener. `agentThreads` (`agent-threads.read`) proxies only the authenticated current session, with async workspace reauthorization and lease fences after snapshot/artifact awaits and before return. Raw patch whitespace/LF/CRLF is preserved in bytes/hash; budgets remain 64 KiB patch / 256 KiB snapshot / 1 KiB summary, with session/revision-bound cursor and explicit truncation. Same-app `yunshu/gpt-6.1-sol` two-turn evidence verifies 275/277-byte receipts, one-to-two trailing spaces with LF, old-cursor handler rejection and stable new-revision pages; both task test runs pass 5/5. Durable capture-failed journals are isolated in listings while cold reads/status/turn/artifact/subscriptions fail closed; Git C-style headers have actual Git/Broker roundtrip coverage. See README for live and release limits. |
| [`research-checkpoints`](./research-checkpoints) | `packages/domains/research-checkpoints` (main) | 97 | Fail-closed artifact port fixture in DSH env (G1); turn-boundary forwarding blocked by G2. |
| [`scientific-plotting`](./scientific-plotting) | None; independently installed Scientific Figures plugin | 92 focused tests | Version **0.4.0-mvp.11** owns one `scientific-figures.operation` tool, native DSH and iframe UI, immutable data/code/run/image histories, real isolated Python execution, analysis artifacts, paginated summaries, interrupted commit recovery and explicit human candidate acceptance. The generic `nativeExecution` Host service supplies authenticated cwd, sandbox policy, subprocess and approvals. Platform-specific native Canvas bytes ship inside the artifact; no legacy MCP or artifact-version forwarding is used. |

## Anchored Comments

[`anchored-comments`](./anchored-comments) is the sole Anchored Comments implementation.
Its independent single-file DSH artifact declares eight workspace-scoped tools:
list/get/upsert/delete/asset.read/capture/feedback.submit/feedback.status. The built-in
domain, old overlay and static registration are removed; the MVP uses Agent tools and
real assets. State and content-addressed PNGs live under the Host-bound workspace at
`.sciforge/anchored-comments/`. Delete and external submission explicitly require
confirmation; declarations do not grant authority. Feedback Gateway imports the plugin's
public `./contract` schemas and refuses submission without gateway configuration.

Plugin/core tests and real-child Host regression tests are engineering checks, not
real-model application acceptance. The isolated latest-package acceptance exercised installation, model-created comments, real capture, a vision-translator upstream image request, approved/denied deletion and restart reads. Image attachment metadata alone is not proof of model consumption; vision inspection is on demand. Capture geometry still required public Host measurements, and slow approval can outlive a model tool timeout. Capability/eval indexes are regenerated from the canonical plugin composition; historical evidence remains history.

The former Visual Review runtime plugin is retired; it is not a separately installable package in this source snapshot.

`research-dossier` is **not** part of this plugin group: its package
(`packages/domains/research-dossier`) has no main-process entrypoint — `sciforge.domain.json`
declares only a `renderer` entrypoint and `contract.ts` is just the right-panel activation
payload. There is no backend surface to migrate; its runtime pluginization belongs to the
renderer-side workstream.

The static-counterpart plugins above document their source-fidelity, migrated static tests,
capability-parity, goldens, tool-surface checks, subprocess loading and clean-state audits in
their own READMEs. Change Inspector instead checks its independent package boundary and bounded
projection. Its recorded-aggregate child-process lifecycle tests remain distinct from the
separate live Agent evidence on a standard-build application with installed plugin 0.1.2.
Historical private application acceptance is not bundled with this source update. Current public-source validation and its limitations are recorded in [source sync notes](../docs/source-sync-20261106.md).

The remaining versioning backends use source-fidelity and factory parity checks where a
static counterpart still exists. Anchored Comments instead checks its single plugin-owned
source graph and independent bundle boundary, plus core contracts, storage, tool metadata,
baseline goldens, Host subprocess loading and lifecycle regressions. None of these test
harnesses replaces real-model selection of tools in the application.

## How the app uses them

- **Vision**: Model Router translates image inputs via its configured `translators.vision` provider.
  There is no standalone vision plug-in service; the router is the only vision translation chain.
- **Scientific**: now a worker — see
  [`packages/workers/sci-modality-router`](../packages/workers/sci-modality-router). Gated inside
  Model Router by the `translators.scientific` profile role; deployment env is only a sidecar/CLI
  input for generating that role.
  GUI, local runtime, Codex, and Claude pass workspace-local `input_object` refs; only Model Router reads explicit
  scientific files and calls the worker
  (which calls the GPU expert-translator). When unset or unreachable, Model Router falls back to
  readable raw file text where safe — no runtime-side service calls.

## Run a plug-in

```bash

# The scientific-modality translator is now a worker (packages/workers/sci-modality-router):
npm --workspace @sciforge/sci-modality-router run start          # :3898
npm --workspace @sciforge/sci-modality-router run test           # stubbed unit tests
```

The scientific expert provider behind `@sciforge/sci-modality-router` is deployed separately after
license review; see the worker deployment docs.
