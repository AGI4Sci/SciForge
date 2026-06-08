import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const [
  projectText,
  packageJson,
  architecture,
  usage,
  computerUseManifest,
  computerUseReadme,
  sciforgeToolsClient,
  sciforgeToolsClientComputerUseRequest,
  runtimeEvents,
  packageBridge,
  packageBridgeTest,
  planner,
  plannerTest,
  noLegacyGate,
  noHardcodedSuccessGate,
  computerUseReleaseWorkflow,
  releaseChecklist,
] = await Promise.all([
  readText('PROJECT.md'),
  readJson<{ scripts?: Record<string, string> }>('package.json'),
  readText('docs/Architecture.md'),
  readText('docs/Usage.md'),
  readText('packages/actions/computer-use/action-provider.manifest.json'),
  readText('packages/actions/computer-use/README.md'),
  readText('src/ui/src/api/sciforgeToolsClient/client.ts'),
  readText('src/ui/src/api/sciforgeToolsClient/computerUseWorkspaceGatewayRequest.ts'),
  readText('src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts'),
  readText('src/runtime/computer-use/package-bridge.ts'),
  readText('src/runtime/computer-use/package-bridge.test.ts'),
  readText('src/runtime/codex/computer-use-text-planner.ts'),
  readText('src/runtime/codex/computer-use-text-planner.test.ts'),
  readText('tools/check-no-legacy-paths.ts'),
  readText('tests/smoke/smoke-no-hardcoded-success.ts'),
  readText('.github/workflows/computer-use-complex-matrix-release-report.yml'),
  readText('docs/release-checklist.md'),
]);

assert.equal(
  packageJson.scripts?.['smoke:real-task-protocol-gates'],
  'tsx tests/smoke/smoke-real-task-protocol-gates.ts',
  'package.json must expose the Computer Use project-board gate',
);
assert.match(
  packageJson.scripts?.['smoke:computer-use-chat-live-e2e:opt-in'] ?? '',
  /--task-id CU-NEXT-01 --scenario-id CU-LONG-001/,
  'completed chat live smoke must pass structured CU-NEXT task and scenario ids',
);
assert.match(
  packageJson.scripts?.['smoke:computer-use-chat-live-e2e:opt-in'] ?? '',
  /--completion-evidence-producer computer-use\.embedded-isolated-desktop-l3/,
  'completed chat live smoke must explicitly request the embedded isolated desktop L3 completion evidence producer',
);
assert.match(
  packageJson.scripts?.['smoke:computer-use-chat-live-continuation-completed:opt-in'] ?? '',
  /--task-id CU-NEXT-05 --scenario-id CU-LONG-006/,
  'continuation-completed chat live smoke must pass structured repair-continuity task and scenario ids',
);
assert.match(
  packageJson.scripts?.['smoke:computer-use-chat-live-continuation-completed:opt-in'] ?? '',
  /--completion-evidence-producer computer-use\.embedded-isolated-desktop-l3/,
  'continuation-completed chat live smoke must explicitly request the embedded isolated desktop L3 completion evidence producer',
);
assert.match(
  packageJson.scripts?.['smoke:computer-use-chat-live-complex-matrix:opt-in'] ?? '',
  /--completion-evidence-producer computer-use\.embedded-isolated-desktop-l3/,
  'complex matrix opt-in smoke must explicitly request the embedded isolated desktop L3 completion evidence producer for completed cases',
);
assert.match(
  packageJson.scripts?.['smoke:computer-use-chat-live-complex-matrix:opt-in-isolated'] ?? '',
  /--case-isolation per-case-workspace-fork/,
  'isolated complex matrix opt-in smoke must run with per-case workspace fork isolation',
);
assert.match(
  packageJson.scripts?.['smoke:computer-use-chat-live-complex-matrix:opt-in-isolated'] ?? '',
  /--completion-evidence-producer computer-use\.embedded-isolated-desktop-l3/,
  'isolated complex matrix opt-in smoke must explicitly request the embedded isolated desktop L3 completion evidence producer for completed cases',
);
assert.equal(
  packageJson.scripts?.['release:computer-use-chat-live-complex-matrix-report'],
  'npm run smoke:computer-use-chat-live-complex-matrix:aggregate --silent && npm run smoke:computer-use-chat-live-complex-matrix:opt-in-report --silent',
  'manual release report script must only rebuild aggregate/report artifacts',
);
assert.doesNotMatch(
  packageJson.scripts?.['release:computer-use-chat-live-complex-matrix-report'] ?? '',
  /smoke:computer-use-chat-live-complex-matrix:opt-in(?:\s|$)/,
  'manual release report script must not run the live complex matrix long task',
);

const defaultGateScripts = [
  packageJson.scripts?.verify,
  packageJson.scripts?.['verify:fast'],
  packageJson.scripts?.['verify:full'],
  packageJson.scripts?.['verify:single-agent-release'],
  packageJson.scripts?.['smoke:all'],
  packageJson.scripts?.['smoke:real-task-matrix'],
  packageJson.scripts?.['smoke:real-task-offline-gates'],
].join('\n');
assert.doesNotMatch(
  defaultGateScripts,
  /smoke:computer-use-chat-live-complex-matrix:opt-in(?:-isolated)?(?:\s|$)|release:computer-use-chat-live-complex-matrix-report/,
  'default gates must not run the live complex matrix or manual release report workflow script',
);

assert.match(computerUseReleaseWorkflow, /workflow_dispatch/, 'complex matrix release report workflow must be manual-only');
assert.doesNotMatch(computerUseReleaseWorkflow, /^\s+(push|pull_request|schedule):/m, 'complex matrix release report workflow must not run on default repository events');
assert.match(computerUseReleaseWorkflow, /smoke:computer-use-chat-live-complex-matrix:aggregate/, 'manual workflow must rebuild the aggregate manifest from split manifests');
assert.match(computerUseReleaseWorkflow, /smoke:computer-use-chat-live-complex-matrix:opt-in-report/, 'manual workflow must generate the opt-in report');
assert.match(computerUseReleaseWorkflow, /actions\/upload-artifact@v4[\s\S]+name: release-report/, 'manual workflow must upload the release-report artifact');
assert.doesNotMatch(computerUseReleaseWorkflow, /smoke:computer-use-chat-live-complex-matrix:opt-in(?:\s|$)/, 'manual workflow must not run the live complex matrix long task');
assert.doesNotMatch(computerUseReleaseWorkflow, /--completion-evidence-producer/, 'manual workflow must not enable live completion evidence production');

assert.match(releaseChecklist, /Computer Use Complex Matrix Opt-In Report/, 'manual release checklist must include the complex matrix opt-in report step');
assert.match(releaseChecklist, /release-report/, 'manual release checklist must name the release-report artifact');
assert.match(releaseChecklist, /npm run release:computer-use-chat-live-complex-matrix-report --silent/, 'manual release checklist must include the local aggregate/report command');
assert.match(releaseChecklist, /not part of default release gates/, 'manual release checklist must keep the live matrix out of default release gates');

const activeBoardHeading = '## 当前任务板：SciForge 对话栏 Computer Use E2E';
const currentScope = section(projectText, '## 当前范围');
const immutableRules = section(projectText, '## 不可变规则');
const activeBoard = section(projectText, activeBoardHeading);
const validationRules = section(projectText, '## 验证规则');

assert.match(
  projectText,
  new RegExp(`^${escapeRegExp(activeBoardHeading)}$`, 'm'),
  'PROJECT.md must expose the active SciForge chat Computer Use E2E task board',
);
assert.match(projectText, /chat -> runtime -> computer_use\.runTask\(request, hostPorts\) -> gui\.present \/ gui\.ask_user -> verifier/, 'PROJECT.md must keep the chat-to-package E2E chain explicit');
assert.match(currentScope, /SciForge 对话栏[\s\S]+runtime Computer Use bridge[\s\S]+packages\/actions\/computer-use/, 'current scope must bind the chat E2E work to the runtime/package Computer Use boundary');
assert.match(currentScope, /公开 runtime\/package 边界[\s\S]+computer_use\.runTask\(request, hostPorts\)[\s\S]+GUI host ports[\s\S]+trace refs[\s\S]+verifier refs/, 'current scope must require public runtime/package boundary refs');
assert.match(currentScope, /GUI 私有状态[\s\S]+DOM[\s\S]+accessibility tree[\s\S]+Playwright DOM[\s\S]+shell 直写文件/, 'current scope must ban app-private and direct-write substitutes');
assert.match(currentScope, /gui\.present[\s\S]+gui\.ask_user[\s\S]+verifier verdict/, 'current scope must require user-visible GUI receipts and verifier verdicts');
assert.match(immutableRules, /所有修改必须通用，不能为当前案例写硬编码补丁/, 'immutable rules must keep generic-change discipline explicit');
assert.match(immutableRules, /secret|password|credential|API key|Authorization|provider URL/i, 'immutable rules must require provider and credential redaction');
assert.match(activeBoard, /^### 集成主线$/m, 'active board must keep the integration workstream');
assert.match(activeBoard, /^### 真实多轮复杂任务矩阵$/m, 'active board must keep the real complex task matrix');
assert.match(activeBoard, /从 SciForge 对话栏发起[\s\S]+Computer Use run/, 'active board must require chat-originated Computer Use runs');
assert.match(activeBoard, /gui\.present[\s\S]+gui\.ask_user[\s\S]+repair \/ continuation[\s\S]+completion-grade evidence/, 'active board must cover presentation, confirmation, continuation, and completion-grade evidence');
assert.match(activeBoard, /briefing deck|图表分析报告|邮件草稿|索引文档|多轮修复|approval chain|Dense visual grounding/, 'active board must keep the real-task matrix domains broad');
assert.equal((activeBoard.match(/^- \[ \] /gm) ?? []).length, 0, 'active board must not retain stale unchecked checklist items after the final full-run evidence lands');
assert.match(activeBoard, /^- \[x\] 将 complex matrix 单次长串运行稳定到 7\/7 passed/m, 'active board must mark single-run 7/7 matrix stability complete once proven');
assert.match(activeBoard, /^- \[x\] 将 monolithic matrix 的 case ordering、retry boundary 和 cleanup manifest 纳入 single-run 7\/7 稳定性实验/m, 'active board must mark monolithic full-run stability complete once a passed full-run manifest exists');
assert.match(activeBoard, /manifest-isolated-final-code-7of7\.json[\s\S]+status=passed[\s\S]+7 cases[\s\S]+issues=\[\]/, 'active board must cite the final single-run 7/7 passed manifest');
assert.match(activeBoard, /stabilityDiagnostics[\s\S]+caseOrdering\.preservedSelectedOrder=true[\s\S]+retryBoundary\.mode=case-scoped[\s\S]+cleanupManifestSummary\.expectedCaseCount=7/, 'active board must cite ordering, retry-boundary, and cleanup diagnostics from the passed full-run manifest');
assert.match(projectText, /^- \[x\] `src\/runtime\/workspace-server\.ts`/m, 'PROJECT.md must record the completed workspace-server long-file split once it is under budget');
assert.match(validationRules, /SciForge 对话栏 E2E 声明[\s\S]+对话栏触发证据[\s\S]+TUI Host\/package bridge chain refs/, 'validation rules must require chat-trigger and TUI/package chain evidence');
assert.match(validationRules, /final artifact refs[\s\S]+verifier verdict[\s\S]+virtual input logs[\s\S]+evidence ledger[\s\S]+isolation flags/, 'validation rules must require visible artifact, verifier, input, ledger, and isolation evidence');
assert.match(validationRules, /gui\.present[\s\S]+verifier 证据/, 'validation rules must prevent artifact/report completion without GUI presentation and verifier evidence');
assert.match(validationRules, /canonical `isolated-desktop-l3-workflow-evidence\.json` regular file/, 'validation rules must keep completion evidence canonical and bundle-local');
assert.doesNotMatch(projectText, /^### CU-\d{2}\b/m, 'PROJECT.md must not restore the retired CU-00..CU-08 task board');
assert.doesNotMatch(projectText, /^## 当前任务板：下一轮 Computer Use 真实复杂任务$/m, 'PROJECT.md must not restore the retired CU-NEXT board heading');
assert.doesNotMatch(projectText, /^- \[[ xX]\]\s+R-[A-Z0-9-]+\b/m, 'PROJECT.md must not restore the retired R-* task board');

assert.match(architecture, /TUI-owned extension|TUI Host/i, 'Architecture must keep Computer Use owned by the TUI Host');
assert.match(architecture, /gui\.present|gui\.ask_user/, 'Architecture must document TUI-to-GUI presentation and confirmation intents');
assert.match(usage, /SCIFORGE_RUNTIME_API_KEY/, 'Usage must document Runtime Codex API key preflight');
assert.match(usage, /SCIFORGE_MODEL_ROUTER_BASE_URL|SCIFORGE_MODEL_ROUTER_URL|SCIFORGE_MODEL_ROUTER_PORT|Model Router \/v1 base URL|Router URL|Router port/i, 'Usage must document Model Router base URL/URL/PORT preflight');
assert.doesNotMatch(usage, /SCIFORGE_PROXY_UPSTREAM_BASE_URL|SCIFORGE_RUNTIME_BASE_URL/, 'Usage must not require legacy upstream env for Runtime/API services');

assert.match(computerUseManifest, /runTask|hostPorts|approvalRequest/, 'Computer Use manifest must expose runTask, host ports, and approval requests');
assert.match(computerUseManifest, /refs-first|trace/i, 'Computer Use manifest must keep refs-first trace semantics');
assert.match(computerUseReadme, /TypeScript-only|TS-only/, 'Computer Use README must state the TS-only product path');
assert.match(computerUseReadme, /WindowActionSession[\s\S]+current-run evidence bundle/, 'Computer Use README must describe WindowActionSession current evidence as the product path');
assert.match(computerUseReadme, /retired[\s\S]+Python[\s\S]+VirtualAppScreen/, 'Computer Use README must keep retired Python and VirtualAppScreen out of product acceptance');

assert.match(sciforgeToolsClient, /\/api\/sciforge\/tools\/run\/stream/, 'default chat /computer-use must route through the Workspace Gateway tools stream');
const sciforgeToolsComputerUseTransport = `${sciforgeToolsClient}\n${sciforgeToolsClientComputerUseRequest}`;
assert.match(sciforgeToolsComputerUseTransport, /action\.sciforge\.computer-use/, 'default chat must select the Computer Use action provider');
assert.match(sciforgeToolsComputerUseTransport, /selectedActionIds[\s\S]+COMPUTER_USE_ACTION_PROVIDER_ID/, 'default chat must support explicit Computer Use provider selection for natural-language prompts');
assert.doesNotMatch(sciforgeToolsClient, /computer-use[\s\S]{0,220}\/api\/sciforge\/runtime\/codex\/stream/, 'Computer Use default chat path must not call Runtime Codex stream directly');
assert.match(runtimeEvents, /computer-use\.tui-host-actions/, 'runtime event projection must consume TUI host action events');
assert.match(runtimeEvents, /gui\.present/, 'runtime event projection must surface gui.present');
assert.match(runtimeEvents, /gui\.ask_user/, 'runtime event projection must surface gui.ask_user');

assert.match(packageBridge, /packages\/actions\/computer-use|action\.sciforge\.computer-use/, 'runtime bridge must call the TS package action provider');
assert.match(packageBridge, /attachPackageResultHostActions|computer-use\.tui-host-actions|gui\.ask_user|gui\.present/, 'runtime bridge must preserve GUI intent metadata from package results');
assert.match(packageBridgeTest, /gui\.ask_user|approvalRequest|package bridge/i, 'package bridge tests must cover high-risk confirmation projection');

assert.match(planner, /visibleText|recentActions|verifierFeedback|compactObservation/, 'planner input must be compact text context, not GUI internals');
assert.match(planner, /Do not inspect screenshots[\s\S]+DOM[\s\S]+accessibility trees/, 'planner must explicitly reject screenshots, DOM, and accessibility-tree inspection');
assert.match(planner, /Never output coordinate fields/, 'planner must explicitly reject coordinate output');
assert.match(plannerTest, /coordinate|multi-action|app-private|fail/i, 'planner tests must fail closed for invalid action outputs');

assert.match(noLegacyGate, /SCIFORGE_VISION_PLANNER|computer-use-action-loop|computer-use-bridge/, 'no-legacy gate must ban retired vision-sense Computer Use paths');
assert.match(noHardcodedSuccessGate, /Computer Use|fake-success|hardcoded/i, 'no-hardcoded-success gate must cover Computer Use success claims');

console.log('[ok] Computer Use protocol gates cover SciForge chat E2E board, package ownership, Runtime Codex planner, TUI-GUI intents, and old-logic deletion guards');

async function readText(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T;
}

function section(text: string, heading: string): string {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `${heading}: missing PROJECT.md section`);
  const nextHeading = text.slice(start + heading.length).search(/\n## /);
  if (nextHeading === -1) return text.slice(start);
  return text.slice(start, start + heading.length + nextHeading);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
