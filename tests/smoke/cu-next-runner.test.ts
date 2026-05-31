import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  computerUseLongAcceptanceProgress,
  isComputerUseLongActionQuotaEligibleRound,
  loadComputerUseLongTaskPool,
  preflightComputerUseLong,
  renderComputerUseLongRepairPlan,
} from '../../tools/computer-use-long-task-pool/internal.js';
import {
  CU_NEXT_TASK_MAPPINGS,
  CU_NEXT_TASK_MAP_SCHEMA_VERSION,
  DEFAULT_CU_NEXT_TASK_MAP_PATH,
  getCuNextTaskMapping,
  loadValidatedCuNextTaskMap,
  scenarioIdsForCuNextTask,
} from '../../tools/computer-use-next/task-map.js';
import {
  expectedCuNextAcceptanceManifestStatus,
  isSuccessfulCuNextAcceptanceProjection,
  parseCuNextRunArgs,
  projectCuNextAcceptanceForScenarioRun,
  writeCuNextDiagnosticSummaryIfNeeded,
} from '../../tools/cu-next-run.js';
import {
  cuNextProjectionAdapter,
  cuNextProjectionTrace,
  cuNextVisibleMarkdownArtifact,
  passedBrowserManifest,
  passedKvGroundManifest,
  projectFixtureWithOnlyCuNext07Checked,
  repairDiagnosticsFixture,
  writeBundleLocalCuNext07Acceptance,
  writeCuNextProjectionEvidenceFiles,
  writeCuNextValidateRunLiveAcceptanceFixture,
  writeCuNextValidateRunStatusFixture,
} from './helpers/cu-next-runner-fixtures.js';

const execFileAsync = promisify(execFile);
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

async function withProcessEnv<T>(overrides: Record<string, string | undefined>, handler: () => Promise<T>): Promise<T> {
  const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]] as const));
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    return await handler();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withKvGroundHealthServer<T>(handler: (baseUrl: string) => Promise<T>) {
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ok: true, inline_image_supported: true }));
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    return await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  }
}

function assertNoKvGroundSecretDiagnostics(blob: string): void {
  for (const secret of [
    'kvuser-redact',
    'kvpass-redact',
    'kvtoken-redact',
    'kvapikey-redact',
    'kvsecret-redact',
    'kvquerypass-redact',
    'kvhash-redact',
    'kvbearer-redact',
  ]) {
    assert.doesNotMatch(blob, new RegExp(secret));
  }
  assert.doesNotMatch(blob, /\/\/[^/\s]+@/);
  assert.doesNotMatch(blob, /[?&](?:token|apiKey|secret|password)=/);
  assert.doesNotMatch(blob, /\b(?:token|apiKey|secret|password)=/);
  assert.doesNotMatch(blob, /#kvhash/i);
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
        requirements: ['l3-workflow-refs', 'dense-grounding', 'dom-ax-observation-hints', 'no-dom-playwright-accessibility'],
        recommendedTargetMode: 'app-window',
        recommendedTargetApp: 'Browser',
        recommendedMaxSteps: 4,
      },
    ],
  };
}

test('CU-LONG acceptance progress rolls prior action shortfall into later rounds', () => {
  const progress = computerUseLongAcceptanceProgress({
    rounds: [{ round: 1 }, { round: 2 }, { round: 3 }, { round: 4 }],
    acceptance: ['至少 20 个通用动作。'],
  } as any, 4, {
    observedScenarioActionCount: 14,
  });

  assert.equal(progress.minimumScenarioActionCount, 20);
  assert.equal(progress.observedScenarioActionCount, 14);
  assert.equal(progress.remainingScenarioActionCount, 6);
  assert.equal(progress.remainingRounds, 1);
  assert.equal(progress.suggestedCurrentRoundActionTarget, 6);
});

test('CU-LONG acceptance progress does not assign action quota to refs-only summary rounds', () => {
  const rounds = [
    {
      round: 1,
      prompt: '打开平台设置并执行低风险视觉操作。',
      expectedTrace: ['control-specific actions'],
    },
    {
      round: 2,
      prompt: '视觉修改或重新检查 3 个低风险控件。',
      expectedTrace: ['field before screenshots', 'after state screenshots'],
    },
    {
      round: 3,
      prompt: '制造一个低风险校验/无结果状态，随后清除或修正该字段。',
      expectedTrace: ['validation screenshot', 'repair action'],
    },
    {
      round: 4,
      prompt: '让 SciForge 总结每个字段/控件的视觉证据和对应 action，只引用 screenshot refs、窗口目标、坐标和 action ledger。',
      expectedTrace: ['field evidence refs', 'action mapping', 'no DOM/accessibility labels'],
    },
  ];
  assert.equal(isComputerUseLongActionQuotaEligibleRound(rounds[2]), true);
  assert.equal(isComputerUseLongActionQuotaEligibleRound(rounds[3]), false);

  const beforeSummary = computerUseLongAcceptanceProgress({
    rounds,
    acceptance: ['至少 20 个通用动作。'],
  } as any, 3, {
    observedScenarioActionCount: 14,
  });
  assert.equal(beforeSummary.remainingActionQuotaRounds, 1);
  assert.equal(beforeSummary.suggestedCurrentRoundActionTarget, 6);

  const summaryRound = computerUseLongAcceptanceProgress({
    rounds,
    acceptance: ['至少 20 个通用动作。'],
  } as any, 4, {
    observedScenarioActionCount: 14,
  });
  assert.equal(summaryRound.currentRoundActionQuotaEligible, false);
  assert.equal(summaryRound.remainingActionQuotaRounds, 0);
  assert.equal(summaryRound.remainingScenarioActionCount, 6);
  assert.equal(summaryRound.suggestedCurrentRoundActionTarget, undefined);
});

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
    assert.ok(task.requirements.includes('dom-ax-observation-hints'));
    assert.ok(task.requirements.includes('no-dom-playwright-accessibility'));
  }
});

test('CU-NEXT run-scenario CLI accepts approvalRef and prompt suffix for confirmed retries', () => {
  const parsed = parseCuNextRunArgs([
    'run-scenario',
    '--task',
    'CU-NEXT-06',
    '--real',
    '--prompt-suffix',
    'retry the guarded action after approval',
    '--approval-ref',
    'approval:computer-use:cu-next-06-confirmed',
  ]);

  assert.equal(parsed.command, 'run-scenario');
  assert.equal(parsed.taskId, 'CU-NEXT-06');
  assert.equal(parsed.dryRun, false);
  assert.equal(parsed.promptSuffix, 'retry the guarded action after approval');
  assert.equal(parsed.approvalRef, 'approval:computer-use:cu-next-06-confirmed');
});

test('CU-NEXT CLI rejects non approval-token approvalRef values', () => {
  assert.throws(() => parseCuNextRunArgs([
    'run-scenario',
    '--task',
    'CU-NEXT-06',
    '--approval-ref',
    'session:derived',
  ]), /approval-ref must be a non-empty approval: token/);
});

test('CU-NEXT acceptance projection success accepts needs-confirmation for mail draft', () => {
  assert.equal(expectedCuNextAcceptanceManifestStatus('CU-NEXT-03'), 'needs-confirmation');
  assert.equal(expectedCuNextAcceptanceManifestStatus('CU-NEXT-07'), 'multi-app-workflow-passed');
  assert.equal(isSuccessfulCuNextAcceptanceProjection('CU-NEXT-03', {
    status: 'projected',
    manifestStatus: 'needs-confirmation',
  }), true);
  assert.equal(isSuccessfulCuNextAcceptanceProjection('CU-NEXT-03', {
    status: 'projected',
    manifestStatus: 'multi-app-workflow-passed',
  }), false);
  assert.equal(isSuccessfulCuNextAcceptanceProjection('CU-NEXT-07', {
    status: 'projected',
    manifestStatus: 'multi-app-workflow-passed',
  }), true);
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
    await withKvGroundHealthServer(async (grounderBaseUrl) => {
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
          grounderBaseUrl,
          inputAdapter: 'remote-desktop',
          independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
          vlmModel: 'qwen3.6-plus',
        },
      }, null, 2)}\n`);

      const reportPath = join(workspace, 'preflight.md');
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
        '--out',
        reportPath,
      ], {
        env: cuNextRuntimeEnv({
          SCIFORGE_CONFIG_PATH: configPath,
        }),
      });

      assert.match(result.stdout, /\[ok\] CU-NEXT-04 preflight -> CU-LONG-005/);
      assert.match(await readFile(reportPath, 'utf8'), /grounder\/grounder: KV-Ground health check passed/);
      assert.doesNotMatch(result.stdout, /sk-test-cu-next-local-config-secret/);
      assert.doesNotMatch(result.stderr, /sk-test-cu-next-local-config-secret/);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT real preflight fails closed when configured KV-Ground health is unreachable', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-preflight-grounder-health-'));
  try {
    const result = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'preflight',
      '--task',
      'CU-NEXT-07',
      '--workspace-path',
      workspace,
      '--real',
    ], {
      env: cuNextRuntimeEnv({
        SCIFORGE_RUNTIME_API_KEY: 'sk-test-cu-next-runtime',
        SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'http://127.0.0.1:3888/v1',
        SCIFORGE_VISION_KV_GROUND_URL: 'http://127.0.0.1:1',
        SCIFORGE_VISION_INPUT_ADAPTER: 'remote-desktop',
        SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER: 'sciforge-simulated-remote-desktop',
      }),
    });

    assert.match(result.stdout, /\[repair-needed\] CU-NEXT-07 preflight -> CU-LONG-004/);
    assert.match(result.stdout, /grounder: KV-Ground health check failed at http:\/\/127\.0\.0\.1:1\/health/);
    assert.match(result.stdout, /Start KV-Ground or its SSH tunnel/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT real KV-Ground preflight redacts health URL secrets from stdout reports and matrix summaries', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-preflight-grounder-redaction-'));
  try {
    const reportPath = join(workspace, 'preflight.md');
    const outRoot = join(workspace, 'matrix');
    const secretGrounderUrl = [
      'http://kvuser-redact:kvpass-redact@127.0.0.1:1/kv-ground',
      '?token=kvtoken-redact&apiKey=kvapikey-redact&secret=kvsecret-redact&password=kvquerypass-redact',
      '#kvhash-redact',
    ].join('');
    const env = cuNextRuntimeEnv({
      SCIFORGE_RUNTIME_API_KEY: 'sk-test-cu-next-runtime',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'http://127.0.0.1:3888/v1',
      SCIFORGE_VISION_KV_GROUND_URL: secretGrounderUrl,
      SCIFORGE_VISION_INPUT_ADAPTER: 'remote-desktop',
      SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER: 'sciforge-simulated-remote-desktop',
    });
    const preflight = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'preflight',
      '--task',
      'CU-NEXT-07',
      '--workspace-path',
      workspace,
      '--real',
      '--out',
      reportPath,
    ], { env });
    const report = await readFile(reportPath, 'utf8');
    assert.match(preflight.stdout, /\[repair-needed\] CU-NEXT-07 preflight -> CU-LONG-004/);
    assert.match(`${preflight.stdout}\n${report}`, /KV-Ground health check failed at http:\/\/127\.0\.0\.1:1\/kv-ground\/health/);

    const matrix = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'run-matrix',
      '--task',
      'CU-NEXT-07',
      '--out-root',
      outRoot,
      '--workspace-path',
      workspace,
      '--real',
    ], { env });
    const summaryPath = /summary: (.+)/.exec(matrix.stdout)?.[1]?.trim();
    assert.ok(summaryPath, 'run-matrix output should include summary path');
    const summary = await readFile(summaryPath, 'utf8');
    const repair = await renderComputerUseLongRepairPlan({
      summaryPath,
      out: join(workspace, 'repair-plan.md'),
    });
    const repairMarkdown = await readFile(repair.planPath, 'utf8');
    assertNoKvGroundSecretDiagnostics([
      preflight.stdout,
      preflight.stderr,
      report,
      matrix.stdout,
      matrix.stderr,
      summary,
      repair.markdown,
      repairMarkdown,
    ].join('\n'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-LONG KV-Ground preflight scrubs bearer tokens and token URLs from fetch error diagnostics', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-long-preflight-grounder-error-redaction-'));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      throw new Error([
        'Bearer kvbearer-redact rejected',
        'for http://kvuser-redact:kvpass-redact@127.0.0.1:1/kv-ground/health?token=kvtoken-redact#kvhash-redact',
        'apiKey=kvapikey-redact secret=kvsecret-redact password=kvquerypass-redact',
      ].join(' '));
    }) as typeof fetch;
    await withProcessEnv({
      SCIFORGE_CONFIG_PATH: join(workspace, 'missing-config.local.json'),
      SCIFORGE_RUNTIME_API_KEY: 'sk-test-cu-long-runtime',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'http://127.0.0.1:3888/v1',
      SCIFORGE_RUNTIME_BASE_URL: undefined,
      SCIFORGE_VISION_KV_GROUND_URL: 'http://127.0.0.1:1/kv-ground?token=kvtoken-redact#kvhash-redact',
      SCIFORGE_VISION_INPUT_ADAPTER: 'remote-desktop',
      SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER: 'sciforge-simulated-remote-desktop',
      SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS: undefined,
      SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT: undefined,
    }, async () => {
      const reportPath = join(workspace, 'preflight.md');
      const preflight = await preflightComputerUseLong({
        scenarioIds: ['CU-LONG-004'],
        workspacePath: workspace,
        dryRun: false,
        out: reportPath,
      });
      const report = await readFile(reportPath, 'utf8');
      const grounderCheck = preflight.checks.find((check) => check.id === 'grounder');
      assert.equal(grounderCheck?.status, 'fail');
      assert.match(String(grounderCheck?.message), /Bearer \[redacted\]/);
      assert.match(`${JSON.stringify(preflight)}\n${report}`, /http:\/\/127\.0\.0\.1:1\/kv-ground\/health/);
      assertNoKvGroundSecretDiagnostics(`${JSON.stringify(preflight)}\n${report}`);
    });
  } finally {
    globalThis.fetch = originalFetch;
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

test('CU-NEXT validate-run requires task-level live acceptance markers and bindings', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-validate-live-'));
  try {
    const manifestPath = await writeCuNextValidateRunLiveAcceptanceFixture(workspace, 'missing-live-marker', {
      includeMarker: false,
    });
    const result = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'validate-run',
      '--task',
      'CU-NEXT-07',
      '--manifest',
      manifestPath,
    ]);

    assert.match(result.stdout, /\[repair-needed\] validate-run CU-NEXT-07 -> CU-LONG-004/);
    assert.match(result.stdout, /live acceptance missing-task-marker/);
    assert.doesNotMatch(result.stdout, /\[ok\] validate-run/);

    const missingCompletionPath = await writeCuNextValidateRunLiveAcceptanceFixture(workspace, 'missing-completion-evidence', {
      includeMarker: true,
      mutateAcceptance: (acceptance) => {
        delete acceptance.completionEvidence;
      },
    });
    const missingCompletion = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'validate-run',
      '--task',
      'CU-NEXT-07',
      '--manifest',
      missingCompletionPath,
    ]);

    assert.match(missingCompletion.stdout, /\[repair-needed\] validate-run CU-NEXT-07 -> CU-LONG-004/);
    assert.match(missingCompletion.stdout, /completion-grade/);
    assert.doesNotMatch(missingCompletion.stdout, /\[ok\] validate-run/);

    const markerReadyPath = await writeCuNextValidateRunLiveAcceptanceFixture(workspace, 'with-live-marker', {
      includeMarker: true,
      materializeAcceptanceRefs: true,
      realTrace: true,
    });
    const markerReady = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'validate-run',
      '--task',
      'CU-NEXT-07',
      '--manifest',
      markerReadyPath,
    ]);

    assert.match(markerReady.stdout, /\[ok\] validate-run CU-NEXT-07 -> CU-LONG-004/);
    assert.doesNotMatch(markerReady.stdout, /live acceptance/);

    const symlinkCompletionPath = await writeCuNextValidateRunLiveAcceptanceFixture(workspace, 'symlink-completion-evidence', {
      includeMarker: true,
      materializeAcceptanceRefs: true,
      realTrace: true,
    });
    const symlinkFixture = JSON.parse(await readFile(symlinkCompletionPath, 'utf8')) as Record<string, any>;
    const finalRound = (symlinkFixture.rounds as Array<Record<string, unknown>>).at(-1);
    assert.ok(finalRound?.visionTraceRef, 'fixture should include final round trace ref');
    const acceptanceDir = dirname(join(dirname(symlinkCompletionPath), String(finalRound.visionTraceRef)));
    const completionEvidencePath = join(acceptanceDir, 'isolated-desktop-l3-workflow-evidence.json');
    const escapedCompletionEvidencePath = join(workspace, 'outside-isolated-desktop-l3-workflow-evidence.json');
    await writeFile(escapedCompletionEvidencePath, await readFile(completionEvidencePath, 'utf8'));
    await rm(completionEvidencePath, { force: true });
    await symlink(escapedCompletionEvidencePath, completionEvidencePath);
    const symlinkCompletion = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'validate-run',
      '--task',
      'CU-NEXT-07',
      '--manifest',
      symlinkCompletionPath,
    ]);

    assert.match(symlinkCompletion.stdout, /\[repair-needed\] validate-run CU-NEXT-07 -> CU-LONG-004/);
    assert.match(symlinkCompletion.stdout, /completion-grade/);
    assert.match(symlinkCompletion.stdout, /live acceptance missing-ref: required evidence ref isolated-desktop-l3-workflow-evidence\.json/);
    assert.doesNotMatch(symlinkCompletion.stdout, /\[ok\] validate-run/);

    const shapeOnlyPath = await writeCuNextValidateRunLiveAcceptanceFixture(workspace, 'shape-only-isolated-l3', {
      includeMarker: true,
      materializeAcceptanceRefs: true,
      mutateAcceptance: (acceptance) => {
        delete (acceptance.completionEvidence as Record<string, unknown>).finalArtifactRef;
      },
    });
    const shapeOnly = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'validate-run',
      '--task',
      'CU-NEXT-07',
      '--manifest',
      shapeOnlyPath,
    ]);

    assert.match(shapeOnly.stdout, /\[repair-needed\] validate-run CU-NEXT-07 -> CU-LONG-004/);
    assert.match(shapeOnly.stdout, /completion-grade/);
    assert.match(shapeOnly.stdout, /missing completed L3 ref field finalArtifactRef/);
    assert.match(shapeOnly.stdout, /non-dry-run Computer Use vision trace/);
    assert.doesNotMatch(shapeOnly.stdout, /\[ok\] validate-run/);

    const mismatchedPath = await writeCuNextValidateRunLiveAcceptanceFixture(workspace, 'mismatched-live-binding', {
      includeMarker: true,
      mutateAcceptance: (acceptance) => {
        acceptance.taskId = 'CU-NEXT-04';
        acceptance.scenarioId = 'CU-LONG-005';
        acceptance.cuNextTask = {
          taskId: 'CU-NEXT-04',
          primaryScenarioId: 'CU-LONG-005',
          longScenarioIds: ['CU-LONG-005'],
        };
      },
    });
    const mismatched = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'validate-run',
      '--task',
      'CU-NEXT-07',
      '--manifest',
      mismatchedPath,
    ]);

    assert.match(mismatched.stdout, /\[repair-needed\] validate-run CU-NEXT-07 -> CU-LONG-004/);
    assert.match(mismatched.stdout, /live acceptance task-id-mismatch/);
    assert.match(mismatched.stdout, /live acceptance scenario-not-mapped/);
    assert.doesNotMatch(mismatched.stdout, /\[ok\] validate-run/);
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
    assert.equal(manifest.scenarioId, 'CU-LONG-004');
    assert.equal(manifest.level, 'L3');
    assert.equal(manifest.guiPresent.recordRef, 'gui-present.json');
    assert.equal(manifest.completionEvidence?.evidenceKind, 'isolated-L3');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT scenario projection skips repair-needed scenario status', async () => {
  const projection = await projectCuNextAcceptanceForScenarioRun({
    taskId: 'CU-NEXT-07',
    dryRun: false,
    result: {
      manifestPath: '/tmp/nonexistent-cu-next-repair-needed-manifest.json',
      scenarioId: 'CU-LONG-004',
      status: 'repair-needed',
      attemptedRounds: [1, 2, 3, 4],
      passedRounds: [1, 2, 3, 4],
      summaryPath: '/tmp/nonexistent-cu-next-repair-needed-summary.json',
      roundResults: [],
      validation: {
        ok: false,
        manifestPath: '/tmp/nonexistent-cu-next-repair-needed-manifest.json',
        scenarioId: 'CU-LONG-004',
        checkedRounds: [1, 2, 3, 4],
        issues: ['real run action count 15 is below acceptance minimum 20'],
        repairDiagnostics: repairDiagnosticsFixture(),
        metrics: {
          passedRounds: 4,
          traceCount: 4,
          realTraceCount: 4,
          actionCount: 15,
          nonWaitActionCount: 15,
          screenshotRefCount: 50,
          actionLedgerCount: 4,
          failureDiagnosticsCount: 4,
        },
      },
    },
  });

  assert.equal(projection.status, 'skipped');
  assert.match(String(projection.reason), /scenario status is repair-needed/);
});

test('CU-NEXT diagnostic summary preserves machine-readable repair diagnostics', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-diagnostic-summary-'));
  try {
    const runDir = join(workspace, 'CU-LONG-004', 'cu-next-diagnostic-summary');
    const evidenceDir = join(runDir, 'evidence', 'round-04');
    await mkdir(evidenceDir, { recursive: true });
    const manifestPath = join(runDir, 'manifest.json');
    const summaryPath = join(runDir, 'scenario-summary.json');
    const acceptancePath = join(evidenceDir, 'cu-user-acceptance-manifest.json');
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: '1.0', taskId: 'T084', scenarioId: 'CU-LONG-004' }));
    await writeFile(summaryPath, JSON.stringify({ schemaVersion: 'sciforge.computer-use-long.scenario-summary.v1', scenarioId: 'CU-LONG-004', status: 'repair-needed' }));
    await writeFile(acceptancePath, JSON.stringify({
      schemaVersion: 'sciforge.computer-use.user-acceptance-manifest.v1',
      taskId: 'CU-NEXT-07',
      scenarioId: 'CU-LONG-004',
      status: 'blocked',
      verifierVerdict: {
        status: 'blocked',
        reasons: ['final-artifact-ref is missing'],
      },
    }, null, 2));

    const diagnosticPath = await writeCuNextDiagnosticSummaryIfNeeded({
      taskId: 'CU-NEXT-07',
      dryRun: false,
      acceptance: {
        status: 'projected',
        manifestStatus: 'blocked',
        paths: {
          verifier: join(evidenceDir, 'cu-l3-independent-input-verifier.json'),
          input: join(evidenceDir, 'cu-user-acceptance-input.json'),
          manifest: acceptancePath,
        },
      },
      result: {
        manifestPath,
        scenarioId: 'CU-LONG-004',
        status: 'repair-needed',
        attemptedRounds: [1, 2, 3, 4],
        passedRounds: [1, 2, 3, 4],
        summaryPath,
        roundResults: [],
        validation: {
          ok: false,
          manifestPath,
          scenarioId: 'CU-LONG-004',
          checkedRounds: [1, 2, 3, 4],
          issues: ['real run action count 15 is below acceptance minimum 20'],
          repairDiagnostics: repairDiagnosticsFixture(),
          metrics: {
            passedRounds: 4,
            traceCount: 4,
            realTraceCount: 4,
            actionCount: 15,
            nonWaitActionCount: 15,
            screenshotRefCount: 50,
            actionLedgerCount: 4,
            failureDiagnosticsCount: 4,
          },
        },
      },
    });

    assert.ok(diagnosticPath);
    const diagnostic = JSON.parse(await readFile(diagnosticPath, 'utf8'));
    assert.equal(diagnostic.repairDiagnostics.actionShortfall.missing, 5);
    assert.ok(diagnostic.repairDiagnostics.missingRefs.includes('finalArtifactRef'));
    assert.ok(diagnostic.acceptanceDiagnostics.issues.includes('acceptance finalArtifactRef is missing'));
    assert.ok(diagnostic.repairDiagnostics.nextRepairFocus.some((item: string) => /action budget/i.test(item)));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT validate-run --json emits structured action shortfall repair diagnostics', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-validate-json-'));
  try {
    const manifestPath = await writeCuNextValidateRunLiveAcceptanceFixture(workspace, 'cu-next-validate-json', {
      includeMarker: true,
      materializeAcceptanceRefs: true,
      realTrace: true,
    });
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const finalRound = (manifest.rounds as Array<Record<string, unknown>>).at(-1);
    assert.ok(finalRound?.visionTraceRef);
    const tracePath = join(dirname(manifestPath), String(finalRound.visionTraceRef));
    const trace = JSON.parse(await readFile(tracePath, 'utf8'));
    trace.steps = trace.steps.slice(0, 1);
    await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`);

    const result = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-run.ts',
      'validate-run',
      '--task',
      'CU-NEXT-07',
      '--manifest',
      manifestPath,
      '--json',
    ], { env: cuNextRuntimeEnv() });
    const parsed = JSON.parse(result.stdout);

    assert.equal(parsed.status, 'repair-needed');
    assert.equal(parsed.repairDiagnostics.actionShortfall.metric, 'actionCount');
    assert.equal(parsed.repairDiagnostics.actionShortfall.minimum, 20);
    assert.equal(parsed.repairDiagnostics.actionShortfall.observed, 16);
    assert.equal(parsed.repairDiagnostics.actionShortfall.missing, 4);
    assert.ok(parsed.repairDiagnostics.nextRepairFocus.some((item: string) => /action budget/i.test(item)));
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
    assert.equal(manifest.scenarioId, 'CU-LONG-004');
    assert.equal(manifest.finalArtifactRef, finalArtifactRef);
    assert.ok(manifest.guiPresent.displayedRefs?.includes(finalArtifactRef));
    assert.ok(manifest.guiPresent.artifactRefs?.includes(finalArtifactRef));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT scenario projection derives final artifact and gui-present claim from sibling gui.present evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-projection-gui-present-'));
  try {
    const runId = 'cu-next-07-projection-gui-present';
    const runDir = join(workspace, 'CU-LONG-004', runId);
    const evidenceDir = join(runDir, 'evidence', 'round-03');
    await mkdir(evidenceDir, { recursive: true });
    const manifestPath = join(runDir, 'manifest.json');
    const summaryPath = join(runDir, 'scenario-summary.json');
    const finalArtifactRef = 'dense-grounding-export.csv';
    await writeCuNextProjectionEvidenceFiles(evidenceDir);
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: '1.0',
      taskId: 'T084',
      cuNextTaskId: 'CU-NEXT-07',
      scenarioId: 'CU-LONG-004',
      title: 'Dense visual grounding',
      status: 'passed',
      run: { id: runId, workspacePath: workspace },
      rounds: [
        { round: 1, status: 'passed', visionTraceRef: 'evidence/round-01/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
        { round: 2, status: 'passed', visionTraceRef: 'evidence/round-02/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
        { round: 3, status: 'passed', visionTraceRef: 'evidence/round-03/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
      ],
    }, null, 2));
    await writeFile(summaryPath, JSON.stringify({ schemaVersion: 'sciforge.computer-use-long.scenario-summary.v1', scenarioId: 'CU-LONG-004', status: 'passed' }));
    await writeFile(join(evidenceDir, 'computer-use-request.json'), JSON.stringify({ task: 'CU-NEXT-07 gui.present sibling artifact projection.' }));
    await writeFile(join(evidenceDir, 'host-ports.json'), JSON.stringify({ ports: { execute: { provider: 'sciforge-simulated-remote-desktop-input-adapter' } } }));
    await writeFile(join(evidenceDir, 'tool-payload.json'), JSON.stringify({ displayIntent: { kind: 'gui.present' } }));
    await writeFile(join(evidenceDir, 'gui-present.json'), JSON.stringify({
      port: 'gui.present',
      status: 'present',
      artifactRef: finalArtifactRef,
      displayedRefs: [finalArtifactRef],
    }));
    const trace = cuNextProjectionTrace(runId, evidenceDir);
    delete trace.finalArtifactRef;
    delete trace.guiPresent;
    delete trace.toolPayload;
    await writeFile(join(evidenceDir, 'vision-trace.json'), JSON.stringify(trace, null, 2));
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
    const manifest = JSON.parse(await readFile(String(projection.paths?.manifest), 'utf8'));
    assert.equal(manifest.finalArtifactRef, finalArtifactRef);
    assert.equal(manifest.completionEvidenceRef, undefined);
    assert.ok(manifest.guiPresent.displayedRefs?.includes(finalArtifactRef));
    const guiClaim = manifest.evidenceClaims.find((claim: Record<string, unknown>) => claim.kind === 'gui-present-record');
    assert.ok(guiClaim);
    assert.deepEqual(guiClaim.artifactRefs, [finalArtifactRef]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
