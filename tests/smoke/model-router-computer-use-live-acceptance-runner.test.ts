import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  modelRouterComputerUseLiveAcceptanceCases,
} from '../../tools/model-router-computer-use-live-acceptance-cases.js';
import {
  runModelRouterComputerUseLiveAcceptanceRunner,
  MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RUNNER_SCHEMA_VERSION,
  type ModelRouterComputerUseLiveAcceptanceRunnerPlan,
} from '../../tools/model-router-computer-use-live-acceptance-runner.js';
import type {
  ModelRouterComputerUseLiveAcceptanceMatrixResult,
} from '../../tools/model-router-computer-use-live-acceptance-matrix.js';

const execFileAsync = promisify(execFile);

const requiredCaseIds = modelRouterComputerUseLiveAcceptanceCases.map((item) => item.id);

const forbiddenRunnerOutputPattern =
  /data:image|;base64,|[A-Za-z0-9+/]{120,}={0,2}|rawProviderPayload|providerPayload|Authorization|Bearer|sk-[A-Za-z0-9_-]+|https?:\/\/provider\.example|(?:^|[\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)|qwen3\.7-plus|deepseek-v4-flash|raw-private-model/i;

test('Model Router Computer Use live acceptance runner refuses to execute without live opt-in', async () => {
  let calls = 0;
  const manifest = await runModelRouterComputerUseLiveAcceptanceRunner({
    now: () => new Date('2026-06-05T03:04:05.000Z'),
    env: {},
    plan: runnerPlan(),
    execFileImpl: async () => {
      calls += 1;
      throw new Error('runner should not execute without opt-in');
    },
  });

  assert.equal(calls, 0);
  assert.equal(manifest.schemaVersion, MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RUNNER_SCHEMA_VERSION);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseAcceptance, 'not-evaluated');
  assert.equal(manifest.evidenceMode, 'external-runner-structural-input-only');
  assert.ok(manifest.issues.includes('missing-live-opt-in'));
  assert.deepEqual(manifest.caseRuns.map((item) => item.caseId), requiredCaseIds);
  assert.equal(manifest.caseRuns.every((item) => item.status === 'not-run'), true);
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRunnerOutputPattern);
});

test('Model Router Computer Use live acceptance runner collects five refs-first results and writes sanitized matrix input', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-model-router-cu-runner-'));
  const outInput = join(workspace, 'matrix-input.json');
  const plan = runnerPlan({
    commandByCaseId: Object.fromEntries(requiredCaseIds.map((caseId) => [
      caseId,
      {
        command: '/Users/alice/private/run-live-case',
        args: ['--case', caseId, '--provider', 'https://provider.example/v1', '--key', 'sk-private-secret', '--model', 'qwen3.7-plus'],
      },
    ])),
  });
  const seenCases: string[] = [];
  try {
    const manifest = await runModelRouterComputerUseLiveAcceptanceRunner({
      now: () => new Date('2026-06-05T03:04:05.000Z'),
      env: {
        SCIFORGE_REQUIRE_MODEL_ROUTER_CU_LIVE_ACCEPTANCE: '1',
      },
      outInputPath: outInput,
      plan,
      execFileImpl: async (_command, args) => {
        const caseId = String(args[1]);
        seenCases.push(caseId);
        return {
          stdout: `${JSON.stringify({ result: passingRunnerResult(caseId) })}\n`,
          stderr: '',
        };
      },
    });
    const input = JSON.parse(await readFile(outInput, 'utf8')) as { results: ModelRouterComputerUseLiveAcceptanceMatrixResult[] };

    assert.deepEqual(seenCases, requiredCaseIds);
    assert.equal(manifest.status, 'completed', manifest.issues.join('\n'));
    assert.equal(manifest.matrixPrecheck.status, 'passed', manifest.matrixPrecheck.issues.join('\n'));
    assert.equal(input.results.length, requiredCaseIds.length);
    assert.deepEqual(input.results.map((item) => item.caseId), requiredCaseIds);
    assert.equal(manifest.caseRuns.every((item) => item.status === 'collected'), true);
    assert.equal(manifest.caseRuns.every((item) => /^command:[a-f0-9]{16}$/u.test(item.commandRef)), true);
    assert.equal(manifest.outputs.matrixInputRef.startsWith('path:'), true);
    assert.doesNotMatch(JSON.stringify(manifest), forbiddenRunnerOutputPattern);
    assert.doesNotMatch(JSON.stringify(input), forbiddenRunnerOutputPattern);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance runner blocks malformed and mismatched child results', async () => {
  const manifest = await runModelRouterComputerUseLiveAcceptanceRunner({
    now: () => new Date('2026-06-05T03:04:05.000Z'),
    env: {
      SCIFORGE_REQUIRE_MODEL_ROUTER_CU_LIVE_ACCEPTANCE: '1',
    },
    plan: runnerPlan(),
    execFileImpl: async (_command, args) => {
      const caseId = String(args[1]);
      if (caseId === 'browser-research') {
        return { stdout: JSON.stringify({ result: { ...passingRunnerResult('docs-sheets-edit'), issues: ['Authorization: Bearer sk-secret'] } }), stderr: '' };
      }
      return { stdout: '{not json', stderr: 'provider failed at https://provider.example/v1 with sk-private-secret' };
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('case-result-mismatch:browser-research'));
  assert.ok(manifest.issues.some((issue) => issue.startsWith('case-result-parse-failed:docs-sheets-edit')));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRunnerOutputPattern);
});

test('Model Router Computer Use live acceptance runner CLI strict exits nonzero when blocked without leaking plan details', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-model-router-cu-runner-cli-'));
  const planPath = join(workspace, 'private-plan.json');
  try {
    await writeFile(planPath, JSON.stringify(runnerPlan({
      commandByCaseId: Object.fromEntries(requiredCaseIds.map((caseId) => [
        caseId,
        {
          command: '/Applications/private/run-live-case',
          args: ['--case', caseId, '--provider', 'https://provider.example/v1', '--key', 'sk-private-secret', '--model', 'deepseek-v4-flash'],
        },
      ])),
    })), 'utf8');

    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-computer-use-live-acceptance-runner.ts',
        '--plan',
        planPath,
        '--strict',
        '--json',
      ], {
        cwd: process.cwd(),
        env: { ...process.env, SCIFORGE_CU_LIVE_DRY_RUN: '1' },
      }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
        const manifest = JSON.parse(stdout) as Awaited<ReturnType<typeof runModelRouterComputerUseLiveAcceptanceRunner>>;
        assert.equal(stderr, '');
        assert.equal(manifest.status, 'blocked');
        assert.ok(manifest.issues.includes('missing-live-opt-in'));
        assert.ok(manifest.policyViolations.includes('dry-run-cannot-satisfy-live-acceptance'));
        assert.equal(stdout.includes(planPath), false);
        assert.doesNotMatch(stdout, forbiddenRunnerOutputPattern);
        assert.doesNotMatch(stderr, /Error:|at .*model-router-computer-use-live-acceptance-runner/);
        return true;
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function runnerPlan(input: {
  commandByCaseId?: Record<string, { command: string; args: string[] }>;
} = {}): ModelRouterComputerUseLiveAcceptanceRunnerPlan {
  return {
    schemaVersion: 'sciforge.model-router.computer-use.live-acceptance-runner-plan.v1',
    cases: requiredCaseIds.map((caseId) => ({
      caseId,
      command: input.commandByCaseId?.[caseId]?.command ?? 'node',
      args: input.commandByCaseId?.[caseId]?.args ?? ['--case', caseId],
    })),
  };
}

function passingRunnerResult(caseId: string): ModelRouterComputerUseLiveAcceptanceMatrixResult {
  const matrixCase = modelRouterComputerUseLiveAcceptanceCases.find((item) => item.id === caseId);
  assert.ok(matrixCase, `missing matrix case ${caseId}`);
  const root = `docs/test-artifacts/model-router-computer-use-live-matrix/runs/runner-test/${caseId}`;
  const evidenceRefs: NonNullable<ModelRouterComputerUseLiveAcceptanceMatrixResult['evidenceRefs']> = {
    screenshotRefs: [`${root}/screenshot.png`],
    verifierRefs: [`${root}/verifier.json`],
  };
  if (matrixCase.requiredEvidenceKinds.includes('file')) evidenceRefs.fileRefs = [`${root}/file-evidence.json`];
  if (matrixCase.requiredEvidenceKinds.includes('artifact')) evidenceRefs.artifactRefs = [`${root}/artifact.json`];
  if (matrixCase.requiredEvidenceKinds.includes('terminal')) evidenceRefs.terminalRefs = [`${root}/terminal.json`];
  return {
    caseId,
    status: 'passed',
    publicModelAlias: 'sciforge-router',
    routerProfile: 'sciforge-runtime-default',
    routerTraceRefs: [`.sciforge/model-router-traces/runner-test/${caseId}/trace.json`],
    capabilityIds: [...matrixCase.requiredCapabilityIds],
    executor: {
      kind: 'native-host',
      currentRunRef: `${root}/current-run.json`,
      executorRef: `${root}/executor.json`,
      sessionRef: `${root}/session.json`,
      nativeHostRef: `${root}/native-host.json`,
      refs: [`${root}/surface.json`],
    },
    evidenceRefs,
    gui: {
      presentRef: `${root}/gui-present.json`,
    },
  };
}
