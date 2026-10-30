# DSH ACP runtime (stage-one core)

Independent Node-only `@sciforge/dsh-runtime` package. Runtime ID is **`dsh`**; this is not a DSH plugin or a legacy-runtime alias. Production sources import no Host-private modules. The Host retains its normal neutral IPC/event/Broker paths.

## Public composition

```ts
import { createDshRuntimeAdapter, type DshRuntimeOptions } from '@sciforge/dsh-runtime'
const adapter = createDshRuntimeAdapter(options) // DshRuntimeAdapter
```

`DshRuntimeOptions` is exported from `src/types.ts`:

- `executable: string`: absolute, trusted, already provisioned DSH launcher.
- `executableArgs?: readonly string[]`: trusted launcher prefix (not shell text).
- `stateDirectory: string`: absolute, dedicated Host-owned state directory; never an existing user's profile.
- `providerEnv?: Readonly<Record<string, string>>`: explicit approved values only. Allowlist: `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`.
- **`verifyDeployment: (deployment: DshDeployment) => Promise<void>`**, required. Receives `{ version, configDigest, composedConfig, executable }`; must reject unapproved composition/digest, unknown executable plugins, unsafe profile hooks and untrusted launcher provenance. A no-op callback is **not** a production policy. Configuration can contain secrets: never log this callback payload.
- `getAuthorizedMcpServers?: (identity: DshIdentity & { workspace: string; allowedTools?: readonly string[]; permissionLevel?: string; governanceProfile?: string; signal: AbortSignal }) => Promise<readonly DshMcpServer[]>`: Host-authorized HTTP MCP gateway only, with exact turn lease. Return `{ type: 'http', name, url, headers: [{name,value}] }[]`. No stdio server spawning is exposed. Absence means no MCP tools; an explicit empty `allowedTools` bypasses this callback and disables MCP for the turn.
- `resolveWorkspace?: (context: DshContext, input: {workspace?: string | null; workspaceLocator?: unknown}) => Promise<string>`: Host resolves local placement for create/resume. Without it callers must provide an absolute `workspace`. Never convert a remote locator to an unvalidated local path.
- `requestTimeoutMs?: number` (default 15000): finite preflight, ACP-request and Host-callback budget. Set explicitly for the approved model policy; default is not a model-performance claim.
- `approvalTimeoutMs?: number` (default 60000).

Canonical neutral methods: `id`, `transport`, `probe`, `connect`, `capabilities`, `startThread`, `listThreads`, `startTurn`, `interruptTurn`, `resolveApproval`, `resumeSession`, `subscribeEvents`, `usage`; also `closeSession` and adapter-wide `close`. `resolveApproval` uses `{runtimeId, threadId, approvalId, decision: 'allowed' | 'denied'}` and resolves void, as does `interruptTurn`.

`readThreadStatus` reports the local active-turn view. Provider transcript pages, tool artifacts, rename/delete and steer explicitly reject `runtime_unsupported`. The Host's own durable event store remains the transcript owner. Usage, replay, attachments, command/file/web execution, skills, subagents, compaction, fork, guard execution and unsupported modalities are not advertised. Explicit per-turn model/mode/reasoning/service-tier overrides, attachments/file references and output schema are rejected rather than silently dropped. MCP tool availability is conditional on the authorized Host callback.

## Protocol and safety

Read-only source audit: official `dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84`. Wire: ACP protocol 1, newline-delimited JSON-RPC 2.0 over a real spawned Node/DSH child's stdio. Implements initialize, session new/list/resume/prompt/cancel/close and permission response. Official source references: `packages/acp/acp/src/{index,session,updates,mcp,codec}.ts`, `apps/cli/src/{args,dump-config,profile-boot}.ts`, `packages/boot/app-boot/src/index.ts`, `packages/bundle/base/cordis.patch.yml`.

Preflight executes the trusted launcher `--version`, then `acp --patch <owned-file> --dump-config`. It requires the exact CLI version and validates the composed YAML without evaluating `!!js`, then calls mandatory Host deployment verification before ACP startup. `DSH_SAFETY_PATCH` disables the audited native execution/network/MCP-manager entry IDs, disables telemetry and forces ACP `autoApprove: false`. Host verification must pin the whole executable composition; a version string and known-row checks alone do not authorize an arbitrary plugin. The launcher/profile must already be provisioned; this package does not install dependencies or grant permission to provision them.

Environment is constructed from an allowlist, not `...process.env`: isolated HOME/DSH_HOME/temp directories, fixed safe PATH, telemetry disabled, no ambient Node preload hooks. No credential is written to patch/log files. Child stderr is discarded rather than forwarded unredacted; diagnostics currently expose structured generic codes only. This is **not an OS sandbox** and cannot constrain a malicious trusted launcher.

ACP updates identify sessions, not turns. Each turn therefore gets a fresh process generation and `session/resume`, reattaching a new Host MCP lease. Host principal/context are detached at turn capture and never sourced from request payloads. Old-generation text/tool/permission traffic cannot attach to a new turn. Host admission acknowledgement precedes prompt dispatch. Cancel/close/deadline/disconnect terminate pending approvals, abort the lease, give pending tools a terminal local snapshot and settle the turn once; owned child shutdown waits for actual exit, escalating SIGTERM to SIGKILL. Local tool snapshots do not fabricate execution receipts. An aborted lease/turn is not proof an external Host provider has become quiescent.

## Reproduce engineering gates

From repository root with the existing audited dependencies, **no installation**:

```sh
node --import tsx --test packages/workers/dsh-runtime/test/runtime.test.ts
node node_modules/typescript/bin/tsc --noEmit -p packages/workers/dsh-runtime/tsconfig.json
node packages/workers/dsh-runtime/test/check-host-contract.mjs
node node_modules/eslint/bin/eslint.js packages/workers/dsh-runtime/src packages/workers/dsh-runtime/test
```

`test/check-host-contract.mjs` is a **narrow consumer semantic gate**, not global type safety. Base `AgentRuntimeId` lacks `dsh`; the script applies only that expected parent-owned ID addition in memory, then checks the real adapter against `AgentRuntimeAdapter`. It writes no Host files. Parent must rerun against the actual combined Host/UI changes. Workspace links resolve to this worktree and Vite caches are local; third-party dependencies are shallow-linked read-only from the supplied audited dependency source. `js-yaml` is pinned to the existing 4.3.0; package-manager lock/composition and packaged delivery remain parent integration work.

## Evidence and boundaries

Raw output/actual subprocess exits: `evidence/*.log`; programmatically parsed counts: `evidence/ledger.json`.

- `01`: initial absent-module/import failure (not a behavioral security RED); `02`: first stdio vertical, 1/1 green.
- `03` → `04`: context identity and neutral approval contract, 2 failing of 3 → 3/3.
- `05` → `06`: unsafe native config and close, 2 failing of 12 → 12/12.
- `07` → `08`: tool snapshots, suspended Host callback cancellation, unsupported input, 3 failing of 15 → expanded 16/16.
- `09` preserves a workspace-resolver RED **and** an intermediate method-renaming regression (6 failures of 16, including 5 approval regressions); fixed before `08`/later gates. Filenames reflect evidence labels, not chronological ordering.
- `12` → `13`: terminal tool snapshot and early AbortSignal, 2 failing of 18 → 18/18.
- `16` preserves initial lint failure (empty catch); `21`/`23` are clean reruns.
- `17` → `18`: malformed correlated response dropped its pending owner, focused 0/1 → full 19/19.
- `22`: final expanded wire-denial regression control, **20 tests / 20 pass / 0 fail / 0 skipped**, exit 0. The denial control was added after implementation and is not claimed as a new TDD RED.
- `19`: standalone production package typecheck exit 0; `20`: narrow Host-consumer check, zero diagnostics, exit 0; `23`: changed-source/test ESLint exit 0.

Tests execute the real production transport/adapter against isolated **Node protocol-fixture subprocesses**. They do not execute the official DSH runtime or a real model. No Electron launch, provider credential reuse, actual Host MCP gateway authorization, provider quiescence, real visible-tool inspection, packaged app, full repository regression or combined-tree acceptance was run. The missing trusted deployment verifier/provisioned launcher and real authorized gateway must fail closed in parent composition; do not replace them with the fixture's no-op reviewer. This delivery is a tested runtime core, **not third-runtime real-application acceptance**.
