import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { loadComputerUseLongTaskPool } from '../../tools/computer-use-long-task-pool/internal.js';
import {
  CU_NEXT_TASK_MAPPINGS,
  CU_NEXT_TASK_MAP_SCHEMA_VERSION,
  DEFAULT_CU_NEXT_TASK_MAP_PATH,
  getCuNextTaskMapping,
  loadValidatedCuNextTaskMap,
  scenarioIdsForCuNextTask,
} from '../../tools/computer-use-next/task-map.js';
import { projectCuNextAcceptanceForScenarioRun } from '../../tools/cu-next-run.js';

const execFileAsync = promisify(execFile);
const fixturePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADgwGOSyRGjgAAAABJRU5ErkJggg==',
  'base64',
);
const cuNextRuntimeEnvKeys = [
  'SCIFORGE_CONFIG_PATH',
  'SCIFORGE_RUNTIME_API_KEY',
  'SCIFORGE_RUNTIME_BASE_URL',
  'SCIFORGE_RUNTIME_MODEL',
  'SCIFORGE_RUNTIME_PROVIDER',
  'SCIFORGE_PROXY_UPSTREAM_BASE_URL',
  'SCIFORGE_PROXY_DEFAULT_MODEL',
  'SCIFORGE_COMPUTER_USE_PLANNER_PROFILE',
  'SCIFORGE_VISION_KV_GROUND_URL',
  'SCIFORGE_VISION_INPUT_ADAPTER',
  'SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER',
  'SCIFORGE_VISION_VLM_MODEL',
] as const;

function cuNextRuntimeEnv(overrides: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env };
  for (const key of cuNextRuntimeEnvKeys) delete env[key];
  return { ...env, ...overrides };
}

function customCuNextTaskMap(): Record<string, unknown> {
  return {
    schemaVersion: CU_NEXT_TASK_MAP_SCHEMA_VERSION,
    tasks: [
      {
        taskId: 'CU-NEXT-42',
        title: 'Override visual task',
        slug: 'override-visual-task',
        priority: 1,
        primaryScenarioId: 'CU-LONG-004',
        longScenarioIds: ['CU-LONG-004'],
        requirements: ['l3-workflow-refs', 'dense-grounding', 'no-dom-playwright-accessibility'],
        recommendedTargetMode: 'app-window',
        recommendedTargetApp: 'Browser',
        recommendedMaxSteps: 4,
      },
    ],
  };
}

test('CU-NEXT task map validates against the CU-LONG task pool', async () => {
  const [map, longPool] = await Promise.all([
    loadValidatedCuNextTaskMap(),
    loadComputerUseLongTaskPool(),
  ]);
  const longScenarioIds = new Set(longPool.scenarios.map((scenario) => scenario.id));
  assert.ok(map.tasks.length > 0);
  assert.equal(map.tasks.length, CU_NEXT_TASK_MAPPINGS.length);
  assert.match(DEFAULT_CU_NEXT_TASK_MAP_PATH, /tools[/\\]computer-use-next[/\\]task-map\.json$/);
  assert.doesNotMatch(DEFAULT_CU_NEXT_TASK_MAP_PATH, /tests[/\\]computer-use-next[/\\]task-map\.json$/);
  const explicitTestFixtureMap = await loadValidatedCuNextTaskMap(join('tests', 'computer-use-next', 'task-map.json'));
  assert.deepEqual(
    explicitTestFixtureMap.tasks.map((task) => task.taskId),
    map.tasks.map((task) => task.taskId),
  );
  assert.ok(map.tasks.every((task) => /^CU-NEXT-\d{2,}$/.test(task.taskId)));
  const first = getCuNextTaskMapping(map, 'CU-NEXT-07');
  assert.deepEqual(scenarioIdsForCuNextTask(first), ['CU-LONG-004']);
  assert.deepEqual(scenarioIdsForCuNextTask(first, 'all'), ['CU-LONG-004', 'CU-LONG-007']);
  for (const task of map.tasks) {
    assert.ok(longScenarioIds.has(task.primaryScenarioId), `${task.taskId}: primary scenario must exist`);
    assert.ok(task.longScenarioIds.every((id) => longScenarioIds.has(id)), `${task.taskId}: all scenarios must exist`);
    assert.ok(task.requirements.includes('no-dom-playwright-accessibility'));
  }
});

test('CU-NEXT CLI accepts explicit task-map overrides without using the default task list', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-task-map-override-'));
  try {
    const taskMapPath = join(workspace, 'task-map.json');
    const projectPath = join(workspace, 'PROJECT.md');
    const outPath = join(workspace, 'readiness.json');
    await writeFile(taskMapPath, `${JSON.stringify(customCuNextTaskMap(), null, 2)}\n`);
    await writeFile(projectPath, [
      '# Override board',
      '',
      '### CU-NEXT-42 Override visual task',
      '',
      '- [ ] Run override task',
      '- [ ] Present override refs',
      '',
      '## 验证规则',
      '',
    ].join('\n'));

    const list = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'list',
      '--task-map',
      taskMapPath,
    ]);
    assert.match(list.stdout, /CU-NEXT-42 -> CU-LONG-004/);
    assert.doesNotMatch(list.stdout, /CU-NEXT-07/);

    const readiness = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'readiness',
      '--task-map',
      taskMapPath,
      '--project',
      projectPath,
      '--out',
      outPath,
    ]);
    assert.match(readiness.stdout, /\[blocked\] CU-NEXT readiness 0\/1 passed; completionEligible=false/);
    const manifest = JSON.parse(await readFile(outPath, 'utf8'));
    assert.deepEqual(manifest.tasks.map((task: { id: string }) => task.id), ['CU-NEXT-42']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT CLI lists and prepares through the CU-LONG runner without copying runner logic', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-runner-'));
  try {
    const list = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'list',
    ]);
    assert.match(list.stdout, /CU-NEXT-07 -> CU-LONG-004/);

    const prepare = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'prepare',
      '--task',
      'CU-NEXT-07',
      '--out-root',
      workspace,
      '--run-id',
      'cu-next-07-runner-test',
      '--workspace-path',
      workspace,
    ]);

    assert.match(prepare.stdout, /\[ok\] prepared CU-NEXT-07 via CU-LONG-004/);
    const manifestPath = /manifest: (.+)/.exec(prepare.stdout)?.[1]?.trim();
    assert.ok(manifestPath, 'prepare output should include manifest path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	    assert.equal(manifest.taskId, 'T084');
	    assert.equal(manifest.cuNextTaskId, 'CU-NEXT-07');
	    assert.equal(manifest.cuNextTask.taskId, 'CU-NEXT-07');
	    assert.equal(manifest.cuNextTask.primaryScenarioId, 'CU-LONG-004');
	    assert.ok(manifest.cuNextTask.requirements.includes('dense-grounding'));
	    assert.equal(manifest.scenarioId, 'CU-LONG-004');
    assert.equal(manifest.run.id, 'cu-next-07-runner-test');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT CLI exposes readiness through the shared readiness manifest builder', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-readiness-cli-'));
  try {
    const outPath = join(workspace, 'readiness.json');
    const result = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'readiness',
      '--out',
      outPath,
    ]);
    assert.match(result.stdout, new RegExp(`\\[blocked\\] CU-NEXT readiness 0\\/${CU_NEXT_TASK_MAPPINGS.length} passed; completionEligible=false`));
    const manifest = JSON.parse(await readFile(outPath, 'utf8'));
    assert.equal(manifest.schemaVersion, 'sciforge.computer-use.cu-next-readiness.v1');
    assert.equal(manifest.completionEligible, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT preflight prints no-secret service-env repair actions for missing Runtime Codex planner config', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-preflight-repair-'));
  try {
    const result = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'preflight',
      '--task',
      'CU-NEXT-04',
      '--workspace-path',
      workspace,
      '--real',
    ], {
      env: cuNextRuntimeEnv({
        SCIFORGE_RUNTIME_API_KEY: '',
        SCIFORGE_PROXY_UPSTREAM_BASE_URL: '',
        SCIFORGE_VISION_KV_GROUND_URL: 'http://127.0.0.1:18081',
        SCIFORGE_VISION_INPUT_ADAPTER: 'remote-desktop',
        SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER: 'sciforge-simulated-remote-desktop',
      }),
    });

    assert.match(result.stdout, /\[repair-needed\] CU-NEXT-04 preflight -> CU-LONG-005/);
    assert.match(result.stdout, /runtime-codex-planner: Runtime Codex text planner config is incomplete/);
    assert.match(result.stdout, /repair: Set SCIFORGE_RUNTIME_API_KEY in the service environment/);
    assert.match(result.stdout, /SCIFORGE_PROXY_UPSTREAM_BASE_URL/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT preflight hydrates runtime env from explicit local config without printing secrets', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-preflight-config-'));
  try {
    const configPath = join(workspace, 'config.local.json');
    await writeFile(configPath, `${JSON.stringify({
      llm: {
        apiKey: 'sk-test-cu-next-local-config-secret',
        baseUrl: 'http://127.0.0.1:3888/v1',
        model: 'bailian/deepseek-v4-flash',
      },
      computerUse: {
        plannerProfile: 'sciforge-runtime-deepseek',
      },
      visionSense: {
        grounderBaseUrl: 'http://127.0.0.1:18081',
        inputAdapter: 'remote-desktop',
        independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
        vlmModel: 'qwen3.6-plus',
      },
    }, null, 2)}\n`);

    const result = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'preflight',
      '--task',
      'CU-NEXT-04',
      '--workspace-path',
      workspace,
      '--real',
    ], {
      env: cuNextRuntimeEnv({
        SCIFORGE_CONFIG_PATH: configPath,
      }),
    });

    assert.match(result.stdout, /\[ok\] CU-NEXT-04 preflight -> CU-LONG-005/);
    assert.doesNotMatch(result.stdout, /sk-test-cu-next-local-config-secret/);
    assert.doesNotMatch(result.stderr, /sk-test-cu-next-local-config-secret/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT preflight keeps explicit empty upstream fail-closed even with local config', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-preflight-empty-upstream-'));
  try {
    const configPath = join(workspace, 'config.local.json');
    await writeFile(configPath, `${JSON.stringify({
      llm: {
        apiKey: 'sk-test-cu-next-empty-upstream-secret',
        baseUrl: 'http://127.0.0.1:3888/v1',
        model: 'bailian/deepseek-v4-flash',
      },
      visionSense: {
        grounderBaseUrl: 'http://127.0.0.1:18081',
        inputAdapter: 'remote-desktop',
        independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
      },
    }, null, 2)}\n`);

    const result = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'preflight',
      '--task',
      'CU-NEXT-04',
      '--workspace-path',
      workspace,
      '--real',
    ], {
      env: cuNextRuntimeEnv({
        SCIFORGE_CONFIG_PATH: configPath,
        SCIFORGE_PROXY_UPSTREAM_BASE_URL: '',
        SCIFORGE_RUNTIME_BASE_URL: '',
      }),
    });

    assert.match(result.stdout, /\[repair-needed\] CU-NEXT-04 preflight -> CU-LONG-005/);
    assert.match(result.stdout, /SCIFORGE_PROXY_UPSTREAM_BASE_URL or SCIFORGE_RUNTIME_BASE_URL/);
    assert.doesNotMatch(result.stdout, /sk-test-cu-next-empty-upstream-secret/);
    assert.doesNotMatch(result.stderr, /sk-test-cu-next-empty-upstream-secret/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT readiness wrapper forwards explicit evidence inputs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-readiness-wrapper-'));
  try {
    const projectPath = join(workspace, 'PROJECT.md');
    const browserPath = join(workspace, 'browser.json');
    const kvPath = join(workspace, 'kv-ground-smoke.json');
    const outPath = join(workspace, 'readiness.json');
    await writeFile(projectPath, projectFixtureWithOnlyCuNext07Checked());
    await writeFile(browserPath, JSON.stringify(passedBrowserManifest({ observedAt: new Date().toISOString() }), null, 2));
    await writeFile(kvPath, JSON.stringify(passedKvGroundManifest(), null, 2));
    const acceptancePath = await writeBundleLocalCuNext07Acceptance(workspace);

    const result = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'readiness',
      '--project',
      projectPath,
      '--browser-manifest',
      browserPath,
      '--kv-ground-smoke',
      kvPath,
      '--acceptance-manifest',
      acceptancePath,
      '--out',
      outPath,
    ]);
    assert.match(result.stdout, new RegExp(`\\[blocked\\] CU-NEXT readiness 1\\/${CU_NEXT_TASK_MAPPINGS.length} passed; completionEligible=false`));
    const manifest = JSON.parse(await readFile(outPath, 'utf8'));
    assert.equal(manifest.tasks.find((task: { id: string }) => task.id === 'CU-NEXT-07')?.status, 'passed');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT validate-run rejects manifests outside the requested task mapping', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-validate-run-'));
  try {
    const prepare = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'prepare',
      '--task',
      'CU-NEXT-04',
      '--out-root',
      workspace,
      '--run-id',
      'cu-next-04-runner-test',
      '--workspace-path',
      workspace,
    ]);
    const manifestPath = /manifest: (.+)/.exec(prepare.stdout)?.[1]?.trim();
    assert.ok(manifestPath, 'prepare output should include manifest path');

    const mismatched = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'validate-run',
      '--task',
      'CU-NEXT-07',
      '--manifest',
      manifestPath,
    ]);
    assert.match(mismatched.stdout, /\[repair-needed\] validate-run CU-NEXT-07 -> CU-LONG-005/);
    assert.match(mismatched.stdout, /CU-LONG-005 is not mapped to CU-NEXT-07/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT validate-run requires passed CU-LONG manifest and scenario-summary status', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-validate-status-'));
  try {
    const manifestRepairNeededPath = await writeCuNextValidateRunStatusFixture(workspace, 'manifest-repair-needed', {
      manifestStatus: 'repair-needed',
      summaryStatus: 'repair-needed',
    });
    const manifestRepairNeeded = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'validate-run',
      '--task',
      'CU-NEXT-07',
      '--manifest',
      manifestRepairNeededPath,
    ]);
    assert.match(manifestRepairNeeded.stdout, /\[repair-needed\] validate-run CU-NEXT-07 -> CU-LONG-004/);
    assert.match(manifestRepairNeeded.stdout, /manifest\.status must be passed/);
    assert.doesNotMatch(manifestRepairNeeded.stdout, /\[ok\] validate-run/);

    const summaryRepairNeededPath = await writeCuNextValidateRunStatusFixture(workspace, 'summary-repair-needed', {
      manifestStatus: 'passed',
      summaryStatus: 'repair-needed',
    });
    const summaryRepairNeeded = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'validate-run',
      '--task',
      'CU-NEXT-07',
      '--manifest',
      summaryRepairNeededPath,
    ]);
    assert.match(summaryRepairNeeded.stdout, /\[repair-needed\] validate-run CU-NEXT-07 -> CU-LONG-004/);
    assert.match(summaryRepairNeeded.stdout, /scenario-summary status does not match manifest/);
    assert.doesNotMatch(summaryRepairNeeded.stdout, /\[ok\] validate-run/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT scenario projection writes task-scoped L3 user acceptance evidence from copied round artifacts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-projection-'));
  try {
    const runDir = join(workspace, 'CU-LONG-004', 'cu-next-07-projection');
    const evidenceDir = join(runDir, 'evidence', 'round-03');
    await mkdir(evidenceDir, { recursive: true });
    const manifestPath = join(runDir, 'manifest.json');
    const summaryPath = join(runDir, 'scenario-summary.json');
    const tracePath = join(evidenceDir, 'vision-trace.json');
    await writeCuNextProjectionEvidenceFiles(evidenceDir);
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: '1.0',
      taskId: 'T084',
      cuNextTaskId: 'CU-NEXT-07',
      scenarioId: 'CU-LONG-004',
      title: 'Dense visual grounding',
      status: 'passed',
      run: {
        id: 'cu-next-07-projection',
        workspacePath: workspace,
      },
      rounds: [
        { round: 1, status: 'passed', visionTraceRef: 'evidence/round-01/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
        { round: 2, status: 'passed', visionTraceRef: 'evidence/round-02/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
        { round: 3, status: 'passed', visionTraceRef: 'evidence/round-03/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
      ],
    }, null, 2));
    await writeFile(summaryPath, JSON.stringify({ schemaVersion: 'sciforge.computer-use-long.scenario-summary.v1', scenarioId: 'CU-LONG-004', status: 'passed' }));
    await writeFile(join(evidenceDir, 'computer-use-request.json'), JSON.stringify({ task: 'CU-NEXT-07 dense grounding acceptance from visible toolbar state.' }));
    await writeFile(join(evidenceDir, 'host-ports.json'), JSON.stringify({ ports: { execute: { provider: 'sciforge-simulated-remote-desktop-input-adapter' } } }));
    await writeFile(join(evidenceDir, 'tool-payload.json'), JSON.stringify({ displayIntent: { kind: 'gui.present' } }));
    await writeFile(join(evidenceDir, 'gui-present.json'), JSON.stringify({ port: 'gui.present', artifactRef: join(evidenceDir, 'dense-grounding-export.csv') }));
    await writeFile(tracePath, JSON.stringify(cuNextProjectionTrace('cu-next-07-projection', evidenceDir), null, 2));
    await writeFile(join(evidenceDir, 'independent-input-adapter.json'), JSON.stringify(cuNextProjectionAdapter('cu-next-07-projection'), null, 2));
    await writeFile(join(evidenceDir, 'virtual-remote-session.json'), JSON.stringify({ runId: 'cu-next-07-projection', mode: 'window' }));

    const projection = await projectCuNextAcceptanceForScenarioRun({
      taskId: 'CU-NEXT-07',
      dryRun: false,
      result: {
        manifestPath,
        scenarioId: 'CU-LONG-004',
        status: 'passed',
        attemptedRounds: [1, 2, 3],
        passedRounds: [1, 2, 3],
        summaryPath,
        roundResults: [],
      },
    });

    assert.equal(projection.status, 'projected');
    assert.equal(projection.manifestStatus, 'multi-app-workflow-passed');
    assert.ok(projection.paths?.manifest.endsWith('/cu-user-acceptance-manifest.json'));
    const manifest = JSON.parse(await readFile(String(projection.paths?.manifest), 'utf8'));
    assert.equal(manifest.taskId, 'CU-NEXT-07');
    assert.equal(manifest.level, 'L3');
    assert.equal(manifest.guiPresent.recordRef, 'gui-present.json');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT scenario projection preserves discovered generic markdown final artifact refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-projection-md-'));
  try {
    const runId = 'cu-next-07-projection-md';
    const runDir = join(workspace, 'CU-LONG-004', runId);
    const evidenceDir = join(runDir, 'evidence', 'round-03');
    await mkdir(evidenceDir, { recursive: true });
    const manifestPath = join(runDir, 'manifest.json');
    const summaryPath = join(runDir, 'scenario-summary.json');
    const finalArtifactRef = 'index.md';
    const visibleArtifact = cuNextVisibleMarkdownArtifact(finalArtifactRef, 'step-003-file-manager');
    await writeCuNextProjectionEvidenceFiles(evidenceDir);
    await writeFile(join(evidenceDir, finalArtifactRef), '# Acceptance index\n\nVisible final markdown artifact.\n');
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: '1.0',
      taskId: 'T084',
      cuNextTaskId: 'CU-NEXT-07',
      scenarioId: 'CU-LONG-004',
      title: 'Dense visual grounding',
      status: 'passed',
      run: {
        id: runId,
        workspacePath: workspace,
      },
      rounds: [
        { round: 1, status: 'passed', visionTraceRef: 'evidence/round-01/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
        { round: 2, status: 'passed', visionTraceRef: 'evidence/round-02/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
        { round: 3, status: 'passed', visionTraceRef: 'evidence/round-03/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
      ],
    }, null, 2));
    await writeFile(summaryPath, JSON.stringify({ schemaVersion: 'sciforge.computer-use-long.scenario-summary.v1', scenarioId: 'CU-LONG-004', status: 'passed' }));
    await writeFile(join(evidenceDir, 'computer-use-request.json'), JSON.stringify({ task: 'CU-NEXT-07 markdown acceptance from visible remote artifact state.' }));
    await writeFile(join(evidenceDir, 'host-ports.json'), JSON.stringify({ ports: { execute: { provider: 'sciforge-simulated-remote-desktop-input-adapter' } } }));
    await writeFile(join(evidenceDir, 'tool-payload.json'), JSON.stringify({
      displayIntent: { kind: 'gui.present' },
      visibleArtifactRefs: [finalArtifactRef],
      visibleArtifacts: [visibleArtifact],
    }));
    await writeFile(join(evidenceDir, 'gui-present.json'), JSON.stringify({
      port: 'gui.present',
      artifactRef: finalArtifactRef,
      visibleArtifactRefs: [finalArtifactRef],
      visibleArtifacts: [visibleArtifact],
    }));
    await writeFile(join(evidenceDir, 'virtual-remote-session.json'), JSON.stringify({
      schemaVersion: 'sciforge.computer-use.virtual-remote-session-trace.v1',
      runId,
      visibleArtifactRefs: [finalArtifactRef],
      visibleArtifacts: [visibleArtifact],
    }));
    const trace = cuNextProjectionTrace(runId, evidenceDir);
    delete trace.finalArtifactRef;
    trace.request = {
      taskId: 'CU-NEXT-07',
      cuNextTaskId: 'CU-NEXT-07',
      task: 'CU-NEXT-07 markdown acceptance from visible remote artifact state.',
    };
    trace.toolPayload = {
      displayIntent: { kind: 'gui.present' },
      visibleArtifactRefs: [finalArtifactRef],
      visibleArtifacts: [visibleArtifact],
    };
    trace.guiPresent = {
      recordRef: 'gui-present.json',
      payloadRef: 'tool-payload.json',
      displayedRefs: [finalArtifactRef],
      visibleArtifacts: [visibleArtifact],
    };
    trace.virtualRemoteSession = {
      sessionRef: 'virtual-remote-session.json',
      visibleArtifactRefs: [finalArtifactRef],
      visibleArtifacts: [visibleArtifact],
    };
    const adapter = cuNextProjectionAdapter(runId);
    await writeFile(join(evidenceDir, 'vision-trace.json'), JSON.stringify(trace, null, 2));
    await writeFile(join(evidenceDir, 'independent-input-adapter.json'), JSON.stringify(adapter, null, 2));

    const projection = await projectCuNextAcceptanceForScenarioRun({
      taskId: 'CU-NEXT-07',
      dryRun: false,
      result: {
        manifestPath,
        scenarioId: 'CU-LONG-004',
        status: 'passed',
        attemptedRounds: [1, 2, 3],
        passedRounds: [1, 2, 3],
        summaryPath,
        roundResults: [],
      },
    });

    assert.equal(projection.status, 'projected');
    assert.equal(projection.manifestStatus, 'multi-app-workflow-passed');
    const manifest = JSON.parse(await readFile(String(projection.paths?.manifest), 'utf8'));
    assert.equal(manifest.taskId, 'CU-NEXT-07');
    assert.equal(manifest.finalArtifactRef, finalArtifactRef);
    assert.ok(manifest.guiPresent.displayedRefs?.includes(finalArtifactRef));
    assert.ok(manifest.guiPresent.artifactRefs?.includes(finalArtifactRef));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

async function writeCuNextValidateRunStatusFixture(
  workspace: string,
  runId: string,
  options: { manifestStatus: 'passed' | 'repair-needed'; summaryStatus: 'passed' | 'repair-needed' },
): Promise<string> {
  const prepare = await execFileAsync(process.execPath, [
    '--import',
    'tsx',
    'tools/cu-next-run.ts',
    'prepare',
    '--task',
    'CU-NEXT-07',
    '--out-root',
    workspace,
    '--run-id',
    runId,
    '--workspace-path',
    workspace,
  ]);
  const manifestPath = /manifest: (.+)/.exec(prepare.stdout)?.[1]?.trim();
  assert.ok(manifestPath, 'prepare output should include manifest path');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.status = options.manifestStatus;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(dirname(manifestPath), 'scenario-summary.json'), `${JSON.stringify({
    schemaVersion: 'sciforge.computer-use-long.scenario-summary.v1',
    scenarioId: 'CU-LONG-004',
    status: options.summaryStatus,
  }, null, 2)}\n`);
  await writeFile(join(dirname(manifestPath), 'cu-user-acceptance-manifest.json'), `${JSON.stringify(passedCuNext07AcceptanceManifest(), null, 2)}\n`);
  return manifestPath;
}

async function writeCuNextProjectionEvidenceFiles(evidenceDir: string) {
  await Promise.all([
    'step-001-before.png',
    'step-001-before-focus.png',
    'step-001-after.png',
    'step-002-before.png',
    'step-002-after.png',
    'step-003-before.png',
    'step-003-after.png',
  ].map((name) => writeFile(join(evidenceDir, name), fixturePng)));
  await writeFile(join(evidenceDir, 'dense-grounding-export.csv'), 'label,x,y\nexport,100,80\n');
}

async function writeBundleLocalCuNext07Acceptance(workspace: string): Promise<string> {
  const runId = 'cu-next-07-wrapper';
  const bundleDir = join(workspace, '.sciforge', 'vision-runs', runId);
  await mkdir(bundleDir, { recursive: true });
  await Promise.all([
    'before.png',
    'after.png',
    'focus-crop.png',
    'final-visible.png',
  ].map((name) => writeFile(join(bundleDir, name), fixturePng)));
  await Promise.all([
    'window-switch-trace.json',
    'computer-use-request.json',
    'host-ports.json',
    'tool-payload.json',
    'gui-present.json',
    'vision-trace.json',
    'virtual-pointer-events.json',
    'coarse-fine-rejected-targets.json',
    'executor-lease.json',
    'verifier-verdict.json',
    'gui-present-payload.json',
  ].map((name) => writeFile(join(bundleDir, name), JSON.stringify({ runId, name }, null, 2))));
  await writeFile(join(bundleDir, 'dense-grounding-export.csv'), 'label,x,y\nexport,100,80\n');
  const manifestPath = join(bundleDir, 'cu-user-acceptance-manifest.json');
  await writeFile(manifestPath, JSON.stringify(passedBundleLocalCuNext07AcceptanceManifest(), null, 2));
  return manifestPath;
}

function passedBundleLocalCuNext07AcceptanceManifest(): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.computer-use.user-acceptance-manifest.v1',
    runId: 'cu-next-07-wrapper',
    taskId: 'CU-NEXT-07',
    createdAt: '2026-05-25T00:00:00.000Z',
    status: 'multi-app-workflow-passed',
    taskText: 'CU-NEXT-07 visual-grounding-pressure-test coarse fine focus crop rejected excluded targets',
    level: 'L3',
    appWorkflow: {
      kind: 'multi-app-workflow',
      apps: ['Browser', 'Dense Toolbar App', 'Finder'],
      windowSwitchTraceRefs: ['window-switch-trace.json'],
    },
    antiShortcutGuard: { status: 'passed', rejectedClaims: [] },
    tuiHostChain: [
      { id: 'tui-host-runTask', kind: 'tui-host-runTask', status: 'present', requestRef: 'computer-use-request.json', hostPortsRef: 'host-ports.json' },
      { id: 'computer-use-action-provider', kind: 'computer-use-action-provider', status: 'present', toolPayloadRef: 'tool-payload.json' },
      { id: 'gui-present', kind: 'gui.present', status: 'present', recordRef: 'gui-present.json' },
    ],
    evidenceClaims: [
      { id: 'real-computer-use-trace', kind: 'real-computer-use', ref: 'vision-trace.json' },
      {
        id: 'independent-input-adapter',
        kind: 'independent-input-adapter',
        refs: ['virtual-pointer-events.json'],
        sessionRefs: ['computer-use-session:cu-next-07-wrapper'],
      },
      {
        id: 'gui-present-record',
        kind: 'gui-present-record',
        ref: 'gui-present.json',
        refs: ['gui-present.json'],
        artifactRefs: ['dense-grounding-export.csv'],
      },
    ],
    screenshotRefs: {
      before: ['before.png'],
      after: ['after.png'],
    },
    focusCropRefs: ['focus-crop.png'],
    groundingDiagnosticsRefs: ['coarse-fine-rejected-targets.json'],
    executorLease: { status: 'present', ref: 'executor-lease.json' },
    finalArtifactRef: 'dense-grounding-export.csv',
    finalVisibleScreenshotRef: 'final-visible.png',
    verifierVerdict: {
      status: 'passed',
      verdict: 'multi-app-workflow-passed',
      ref: 'verifier-verdict.json',
    },
    guiPresent: {
      status: 'present',
      recordRef: 'gui-present.json',
      payloadRef: 'gui-present-payload.json',
      displayedRefs: ['dense-grounding-export.csv'],
    },
  };
}

async function writeProjectedCuNext07Acceptance(workspace: string, runId: string): Promise<string> {
  const runDir = join(workspace, 'CU-LONG-004', runId);
  const evidenceDir = join(runDir, 'evidence', 'round-03');
  await mkdir(evidenceDir, { recursive: true });
  const manifestPath = join(runDir, 'manifest.json');
  const summaryPath = join(runDir, 'scenario-summary.json');
  await writeCuNextProjectionEvidenceFiles(evidenceDir);
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: '1.0',
    taskId: 'T084',
    cuNextTaskId: 'CU-NEXT-07',
    scenarioId: 'CU-LONG-004',
    title: 'Dense visual grounding',
    status: 'passed',
    run: {
      id: runId,
      workspacePath: workspace,
    },
    rounds: [
      { round: 1, status: 'passed', visionTraceRef: 'evidence/round-01/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
      { round: 2, status: 'passed', visionTraceRef: 'evidence/round-02/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
      { round: 3, status: 'passed', visionTraceRef: 'evidence/round-03/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
    ],
  }, null, 2));
  await writeFile(summaryPath, JSON.stringify({ schemaVersion: 'sciforge.computer-use-long.scenario-summary.v1', scenarioId: 'CU-LONG-004', status: 'passed' }));
  await writeFile(join(evidenceDir, 'computer-use-request.json'), JSON.stringify({ task: 'CU-NEXT-07 dense grounding acceptance from visible toolbar state.' }));
  await writeFile(join(evidenceDir, 'host-ports.json'), JSON.stringify({ ports: { execute: { provider: 'sciforge-simulated-remote-desktop-input-adapter' } } }));
  await writeFile(join(evidenceDir, 'tool-payload.json'), JSON.stringify({ displayIntent: { kind: 'gui.present' } }));
  await writeFile(join(evidenceDir, 'gui-present.json'), JSON.stringify({ port: 'gui.present', artifactRef: join(evidenceDir, 'dense-grounding-export.csv') }));
  await writeFile(join(evidenceDir, 'vision-trace.json'), JSON.stringify(cuNextProjectionTrace(runId, evidenceDir), null, 2));
  await writeFile(join(evidenceDir, 'independent-input-adapter.json'), JSON.stringify(cuNextProjectionAdapter(runId), null, 2));
  await writeFile(join(evidenceDir, 'virtual-remote-session.json'), JSON.stringify({ runId, mode: 'window' }));

  const projection = await projectCuNextAcceptanceForScenarioRun({
    taskId: 'CU-NEXT-07',
    dryRun: false,
    result: {
      manifestPath,
      scenarioId: 'CU-LONG-004',
      status: 'passed',
      attemptedRounds: [1, 2, 3],
      passedRounds: [1, 2, 3],
      summaryPath,
      roundResults: [],
    },
  });
  assert.equal(projection.status, 'projected');
  assert.ok(projection.paths?.manifest);
  return String(projection.paths.manifest);
}

function projectFixtureWithOnlyCuNext07Checked(): string {
  const sections = CU_NEXT_TASK_MAPPINGS.map((mapping) => [
    `### ${mapping.taskId} ${mapping.title}`,
    '',
    `- [${mapping.taskId === 'CU-NEXT-07' ? 'x' : ' '}] Run ${mapping.slug}${mapping.taskId === 'CU-NEXT-07' ? ' - 2026-05-25 evidence: passed with cu-user-acceptance-manifest and verifier status.' : ''}`,
    `- [${mapping.taskId === 'CU-NEXT-07' ? 'x' : ' '}] Present trace refs${mapping.taskId === 'CU-NEXT-07' ? ' - 2026-05-25 evidence: passed with cu-user-acceptance-manifest and verifier status.' : ''}`,
    '',
  ].join('\n')).join('\n');
  return `# SciForge 项目协议\n\n## 当前任务板：下一轮 Computer Use 真实复杂任务\n\n${sections}\n## 验证规则\n`;
}

function passedBrowserManifest(options: { observedAt?: string } = {}): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'passed',
    source: 'codex-in-app-browser',
    observedAt: options.observedAt ?? '2026-05-25T00:00:00.000Z',
    releaseEligible: true,
    acceptanceConclusionFromRealBrowser: true,
    automationSubstituteUsed: false,
    seedDemoFixtureEvidenceUsed: false,
    startedFromDefaultChatEntry: true,
    submittedThroughRuntimeCodex: true,
    providerModelProfileVisible: true,
    workspaceVisible: true,
    commandIdVisible: true,
    singleTurn: browserStep(),
    artifactFollowUp: browserStep(),
    multiTurn: {
      ...browserStep(),
      secondTurnVisibleAnswerConfirmed: true,
    },
  };
}

function browserStep(): Record<string, unknown> {
  return {
    status: 'passed',
    visibleAnswerConfirmed: true,
    providerModelProfileVisible: true,
    workspaceCommandIdVisible: true,
  };
}

function passedKvGroundManifest(): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.kv-ground-smoke.v1',
    runId: 'kv-ground-smoke-20260525T000000Z',
    createdAt: '2026-05-25T00:00:00.000Z',
    endpoint: 'http://127.0.0.1:18081',
    checks: {
      health: { ok: true },
      predict: { coordinates: [480, 1062] },
    },
    predictRequest: { textPrompt: 'Click the Ask SciForge input box' },
  };
}

function passedCuNext07AcceptanceManifest(): Record<string, unknown> {
  const runId = 'cu-next-07-wrapper';
  return {
    schemaVersion: 'sciforge.computer-use.user-acceptance-manifest.v1',
    runId,
    taskId: 'CU-NEXT-07',
    createdAt: '2026-05-25T00:00:00.000Z',
    status: 'multi-app-workflow-passed',
    taskText: 'CU-NEXT-07 visual-grounding-pressure-test coarse fine focus crop rejected excluded targets',
    level: 'L3',
    appWorkflow: {
      kind: 'multi-app-workflow',
      apps: ['Browser', 'Dense Toolbar App', 'Finder'],
      windowSwitchTraceRefs: [`.sciforge/vision-runs/${runId}/window-switch-trace.json`],
    },
    antiShortcutGuard: { status: 'passed', rejectedClaims: [] },
    tuiHostChain: [
      {
        id: 'tui-host-runTask',
        kind: 'tui-host-runTask',
        status: 'present',
        requestRef: `.sciforge/vision-runs/${runId}/computer-use-request.json`,
        hostPortsRef: `.sciforge/vision-runs/${runId}/host-ports.json`,
      },
      {
        id: 'computer-use-action-provider',
        kind: 'computer-use-action-provider',
        status: 'present',
        toolPayloadRef: `.sciforge/vision-runs/${runId}/tool-payload.json`,
      },
      {
        id: 'gui-present',
        kind: 'gui.present',
        status: 'present',
        recordRef: `.sciforge/vision-runs/${runId}/gui-present.json`,
      },
    ],
    evidenceClaims: [
      { id: 'real-computer-use-trace', kind: 'real-computer-use', ref: `.sciforge/vision-runs/${runId}/vision-trace.json` },
      {
        id: 'independent-input-adapter',
        kind: 'independent-input-adapter',
        refs: [`.sciforge/vision-runs/${runId}/virtual-pointer-events.json`],
        sessionRefs: [`computer-use-session:${runId}`],
      },
      {
        id: 'gui-present-record',
        kind: 'gui-present-record',
        ref: `.sciforge/vision-runs/${runId}/gui-present.json`,
        refs: [`.sciforge/vision-runs/${runId}/gui-present.json`],
        artifactRefs: [`.sciforge/vision-runs/${runId}/dense-grounding-export.csv`],
      },
    ],
    screenshotRefs: {
      before: [`.sciforge/vision-runs/${runId}/before.png`],
      after: [`.sciforge/vision-runs/${runId}/after.png`],
    },
    focusCropRefs: [`.sciforge/vision-runs/${runId}/focus-crop.png`],
    groundingDiagnosticsRefs: [`.sciforge/vision-runs/${runId}/coarse-fine-rejected-targets.json`],
    executorLease: { status: 'present', ref: `.sciforge/vision-runs/${runId}/executor-lease.json` },
    finalArtifactRef: `.sciforge/vision-runs/${runId}/dense-grounding-export.csv`,
    finalVisibleScreenshotRef: `.sciforge/vision-runs/${runId}/final-visible.png`,
    verifierVerdict: {
      status: 'passed',
      verdict: 'multi-app-workflow-passed',
      ref: `.sciforge/vision-runs/${runId}/verifier-verdict.json`,
    },
    guiPresent: {
      status: 'present',
      recordRef: `.sciforge/vision-runs/${runId}/gui-present.json`,
      payloadRef: `.sciforge/vision-runs/${runId}/gui-present-payload.json`,
      displayedRefs: [`.sciforge/vision-runs/${runId}/dense-grounding-export.csv`],
    },
  };
}

function cuNextProjectionTrace(runId: string, runRef: string): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.vision-trace.v1',
    runId,
    tool: 'action.sciforge.computer-use',
    runtime: 'sciforge.workspace-runtime.computer-use-package-bridge',
    actionProvider: 'action.sciforge.computer-use',
    createdAt: '2026-05-25T00:00:00.000Z',
    completedAt: '2026-05-25T00:01:00.000Z',
    request: {
      taskId: 'CU-NEXT-07',
      cuNextTaskId: 'CU-NEXT-07',
      task: 'CU-NEXT-07 dense grounding acceptance from visible toolbar state.',
    },
    config: {
      dryRun: false,
      inputAdapter: 'remote-desktop',
      independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
    },
    hostPorts: {
      ports: {
        execute: {
          provider: 'sciforge-simulated-remote-desktop-input-adapter',
          inputAdapter: 'remote-desktop',
          independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
        },
      },
    },
    genericComputerUse: {
      inputChannelContract: {
        currentIndependentAdapter: 'remote-desktop',
        pointerKeyboardOwnership: 'sciforge-independent-input-adapter',
        pointerMode: 'adapter-window-bound-pointer',
        keyboardMode: 'adapter-window-bound-keyboard',
        userDeviceImpact: 'none',
      },
    },
    finalArtifactRef: `${runRef}/dense-grounding-export.csv`,
    finalVisibleScreenshotRef: `${runRef}/step-003-after.png`,
    steps: [
      {
        id: 'step-001-browser',
        status: 'done',
        beforeScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${runRef}/step-001-before.png`,
            windowTarget: { appName: 'Browser' },
          },
          {
            type: 'screenshot',
            captureScope: 'focus-region',
            path: `${runRef}/step-001-before-focus.png`,
            windowTarget: { appName: 'Browser' },
          },
        ],
        afterScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${runRef}/step-001-after.png`,
            windowTarget: { appName: 'Browser' },
          },
        ],
        plannedAction: { type: 'click', appName: 'Browser', targetDescription: 'visible source summary' },
        grounding: { provider: 'kv-ground', localX: 100, localY: 80 },
      },
      {
        id: 'step-002-dense-app',
        status: 'done',
        beforeScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${runRef}/step-002-before.png`,
            windowTarget: { appName: 'Dense Toolbar App' },
          },
        ],
        afterScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${runRef}/step-002-after.png`,
            windowTarget: { appName: 'Dense Toolbar App' },
          },
        ],
        plannedAction: { type: 'click', appName: 'Dense Toolbar App', targetDescription: 'export button' },
        fineGrounding: { provider: 'kv-ground', rejectedTargets: ['Save', 'Share'] },
      },
      {
        id: 'step-003-file-manager',
        status: 'done',
        beforeScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${runRef}/step-003-before.png`,
            windowTarget: { appName: 'File Manager' },
          },
        ],
        afterScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${runRef}/step-003-after.png`,
            windowTarget: { appName: 'File Manager' },
          },
        ],
        plannedAction: { type: 'click', appName: 'File Manager', targetDescription: 'show exported artifact' },
      },
    ],
  };
}

function cuNextProjectionAdapter(runId: string): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.computer-use.independent-input-adapter.v1',
    adapter: 'remote-desktop',
    provider: 'sciforge-simulated-remote-desktop',
    runId,
    userDeviceImpact: 'none',
    systemMouseEvents: 'not-sent',
    systemKeyboardEvents: 'not-sent',
    pointerKeyboardOwnership: 'sciforge-independent-input-adapter',
    targetSession: {
      mode: 'window',
      appName: 'Dense Toolbar App',
      coordinateSpace: 'window-local',
    },
    virtualPointer: {
      mode: 'virtual-pointer',
      coordinateSpace: 'window-local',
      x: 100,
      y: 80,
    },
    virtualKeyboard: {
      mode: 'virtual-keyboard',
      pressedKeys: [],
      keyEvents: [],
    },
    virtualRemoteSession: {
      stateRef: 'virtual-remote-session.json',
    },
    actions: [
      {
        id: 'step-001-click',
        type: 'click',
        systemMouseEvents: 'not-sent',
        systemKeyboardEvents: 'not-sent',
      },
      {
        id: 'step-002-click',
        type: 'click',
        systemMouseEvents: 'not-sent',
        systemKeyboardEvents: 'not-sent',
      },
    ],
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:01:00.000Z',
  };
}

function cuNextVisibleMarkdownArtifact(artifactRef: string, sourceActionId: string): Record<string, unknown> {
  return {
    id: 'visible-markdown-index',
    title: 'Acceptance index',
    artifactRef,
    dataRef: artifactRef,
    path: artifactRef,
    mimeType: 'text/markdown',
    appId: 'Browser',
    delivery: 'virtual-remote-session-artifact',
    status: 'visible-and-saved',
    visibleTexts: ['Acceptance index', 'Visible final markdown artifact'],
    sourceActionIds: [sourceActionId],
  };
}
