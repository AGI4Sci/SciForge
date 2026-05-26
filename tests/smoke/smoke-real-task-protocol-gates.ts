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
  runtimeEvents,
  packageBridge,
  packageBridgeTest,
  planner,
  plannerTest,
  noLegacyGate,
  noHardcodedSuccessGate,
] = await Promise.all([
  readText('PROJECT.md'),
  readJson<{ scripts?: Record<string, string> }>('package.json'),
  readText('docs/Architecture.md'),
  readText('docs/Usage.md'),
  readText('packages/actions/computer-use/action-provider.manifest.json'),
  readText('packages/actions/computer-use/README.md'),
  readText('src/ui/src/api/sciforgeToolsClient/client.ts'),
  readText('src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts'),
  readText('src/runtime/computer-use/package-bridge.ts'),
  readText('src/runtime/computer-use/package-bridge.test.ts'),
  readText('src/runtime/codex/computer-use-text-planner.ts'),
  readText('src/runtime/codex/computer-use-text-planner.test.ts'),
  readText('tools/check-no-legacy-paths.ts'),
  readText('tests/smoke/smoke-no-hardcoded-success.ts'),
]);

assert.equal(
  packageJson.scripts?.['smoke:real-task-protocol-gates'],
  'tsx tests/smoke/smoke-real-task-protocol-gates.ts',
  'package.json must expose the Computer Use project-board gate',
);

const activeComputerUseNextTasks = [
  'CU-NEXT-01',
  'CU-NEXT-02',
  'CU-NEXT-03',
  'CU-NEXT-04',
  'CU-NEXT-05',
  'CU-NEXT-06',
  'CU-NEXT-07',
];

assert.match(
  projectText,
  /## 当前任务板：下一轮 Computer Use 真实复杂任务/,
  'PROJECT.md must expose the active CU-NEXT Computer Use task board',
);
for (const taskId of activeComputerUseNextTasks) {
  assert.match(projectText, new RegExp(`^### ${taskId}\\b`, 'm'), `${taskId}: must remain in the active PROJECT.md task board`);
}
assert.doesNotMatch(projectText, /^### CU-\d{2}\b/m, 'PROJECT.md must not restore the retired CU-00..CU-08 task board');
assert.doesNotMatch(projectText, /^- \[[ xX]\]\s+R-[A-Z0-9-]+\b/m, 'PROJECT.md must not restore the retired R-* task board');

assert.match(architecture, /TUI-owned extension|TUI Host/i, 'Architecture must keep Computer Use owned by the TUI Host');
assert.match(architecture, /gui\.present|gui\.ask_user/, 'Architecture must document TUI-to-GUI presentation and confirmation intents');
assert.match(usage, /SCIFORGE_RUNTIME_API_KEY/, 'Usage must document Runtime Codex API key preflight');
assert.match(usage, /SCIFORGE_PROXY_UPSTREAM_BASE_URL|upstream base URL|upstreamBaseUrl/, 'Usage must document provider proxy upstream preflight');

assert.match(computerUseManifest, /runTask|hostPorts|approvalRequest/, 'Computer Use manifest must expose runTask, host ports, and approval requests');
assert.match(computerUseManifest, /refs-first|trace/i, 'Computer Use manifest must keep refs-first trace semantics');
assert.match(computerUseReadme, /packages\/observe\/vision[\s\S]+observation/, 'Computer Use README must describe observe/vision as consumed observation input');
assert.match(computerUseReadme, /vision-sense[\s\S]+不拥有 executor/, 'Computer Use README must keep vision-sense out of executor ownership');
assert.match(computerUseReadme, /TUI-owned extension[\s\S]+GUI[\s\S]+gui\.present/, 'Computer Use README must keep GUI participation behind TUI Host presentation');

assert.match(sciforgeToolsClient, /\/api\/sciforge\/tools\/run\/stream/, 'default chat /computer-use must route through the Workspace Gateway tools stream');
assert.match(sciforgeToolsClient, /action\.sciforge\.computer-use/, 'default chat must select the Computer Use action provider');
assert.doesNotMatch(sciforgeToolsClient, /computer-use[\s\S]{0,220}\/api\/sciforge\/runtime\/codex\/stream/, 'Computer Use default chat path must not call Runtime Codex stream directly');
assert.match(runtimeEvents, /computer-use\.tui-host-actions/, 'runtime event projection must consume TUI host action events');
assert.match(runtimeEvents, /gui\.present/, 'runtime event projection must surface gui.present');
assert.match(runtimeEvents, /gui\.ask_user/, 'runtime event projection must surface gui.ask_user');

assert.match(packageBridge, /sciforge_computer_use|packages\/actions\/computer-use/, 'runtime bridge must call the package action provider');
assert.match(packageBridge, /attachPackageResultHostActions|computer-use\.tui-host-actions|gui\.ask_user|gui\.present/, 'runtime bridge must preserve GUI intent metadata from package results');
assert.match(packageBridgeTest, /gui\.ask_user|approvalRequest|package bridge/i, 'package bridge tests must cover high-risk confirmation projection');

assert.match(planner, /visibleText|recentActions|verifierFeedback|compactObservation/, 'planner input must be compact text context, not GUI internals');
assert.match(planner, /Do not inspect screenshots[\s\S]+DOM[\s\S]+accessibility trees/, 'planner must explicitly reject screenshots, DOM, and accessibility-tree inspection');
assert.match(planner, /Never output coordinate fields/, 'planner must explicitly reject coordinate output');
assert.match(plannerTest, /coordinate|multi-action|app-private|fail/i, 'planner tests must fail closed for invalid action outputs');

assert.match(noLegacyGate, /SCIFORGE_VISION_PLANNER|computer-use-action-loop|computer-use-bridge/, 'no-legacy gate must ban retired vision-sense Computer Use paths');
assert.match(noHardcodedSuccessGate, /Computer Use|fake-success|hardcoded/i, 'no-hardcoded-success gate must cover Computer Use success claims');

console.log('[ok] Computer Use protocol gates cover CU-* board, package ownership, Runtime Codex planner, TUI-GUI intents, and old-logic deletion guards');

async function readText(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T;
}
