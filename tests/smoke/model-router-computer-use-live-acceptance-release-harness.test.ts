import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join, relative } from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  modelRouterComputerUseLiveAcceptanceCases,
} from '../../tools/model-router-computer-use-live-acceptance-cases.js';
import {
  MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RELEASE_HARNESS_SCHEMA_VERSION,
  runModelRouterComputerUseLiveAcceptanceReleaseHarness,
} from '../../tools/model-router-computer-use-live-acceptance-release-harness.js';
import type {
  ModelRouterComputerUseLiveAcceptanceMatrixResult,
} from '../../tools/model-router-computer-use-live-acceptance-matrix.js';

const execFileAsync = promisify(execFile);
const requiredCaseIds = modelRouterComputerUseLiveAcceptanceCases.map((item) => item.id);

const forbiddenHarnessOutputPattern =
  /data:image|;base64,|[A-Za-z0-9+/]{120,}={0,2}|rawProviderPayload|providerPayload|Authorization|Bearer|sk-[A-Za-z0-9_-]+|https?:\/\/provider\.example|(?:^|[\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)|qwen3\.7-plus|deepseek-v4-flash|raw-private-model/i;

test('Model Router Computer Use live acceptance release harness passes only with preflight ready and matrix live-current-run', async () => {
  const server = await startRouterFixtureServer();
  const workspace = await mkWorkspace('cu-live-release-harness-pass-');
  const workspaceRef = workspaceRefFor(workspace);
  const matrixInputPath = join(workspace, 'input.json');
  const traceAuditReportPath = join(workspace, 'trace-audit-report.json');
  const results = requiredCaseIds.map((caseId) => fileBackedResult(caseId, `${workspaceRef}/runs/current/${caseId}`));
  try {
    await writeEvidenceFilesForResults(results);
    await writeFile(matrixInputPath, `${JSON.stringify({ checkedAt: '2026-06-05T05:00:00.000Z', results }, null, 2)}\n`, 'utf8');
    await writeFile(traceAuditReportPath, `${JSON.stringify(traceAuditForResults(results), null, 2)}\n`, 'utf8');

    const manifest = await runModelRouterComputerUseLiveAcceptanceReleaseHarness({
      now: () => new Date('2026-06-05T05:01:00.000Z'),
      routerUrl: server.url,
      requestDisallowSharedSystemInput: true,
      matrixInputPath,
      traceAuditReportPath,
      expectedKnownSecretsChecked: 2,
      env: {
        SCIFORGE_REQUIRE_MODEL_ROUTER_CU_LIVE_ACCEPTANCE: '1',
        SCIFORGE_CU_LIVE_EXECUTOR_KIND: 'native-host',
        SCIFORGE_CU_LIVE_ACCEPTANCE_RUNNER: '/Users/alice/bin/run-live-cu --model qwen3.7-plus',
        SCIFORGE_TEXT_API_KEY: 'sk-text-secret-value',
        SCIFORGE_VISION_API_KEY: 'sk-vision-secret-value',
      },
    });

    assert.equal(manifest.schemaVersion, MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RELEASE_HARNESS_SCHEMA_VERSION);
    assert.equal(manifest.status, 'completed', manifest.issues.join('\n'));
    assert.equal(manifest.releaseAcceptance, 'live-current-run');
    assert.equal(manifest.evidenceMode, 'release-harness-external-artifact-gate');
    assert.equal(manifest.stages.preflight.status, 'ready');
    assert.equal(manifest.stages.matrix.status, 'passed');
    assert.equal(manifest.stages.matrix.releaseAcceptance, 'live-current-run');
    assert.equal(manifest.outputs.matrixInputRef, workspaceRefFor(matrixInputPath));
    assert.equal(manifest.outputs.traceAuditReportRef, workspaceRefFor(traceAuditReportPath));
    assert.deepEqual(manifest.issues, []);
    assert.doesNotMatch(JSON.stringify(manifest), forbiddenHarnessOutputPattern);
  } finally {
    await server.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance release harness blocks before matrix when preflight is not ready', async () => {
  const workspace = await mkWorkspace('cu-live-release-harness-preflight-blocked-');
  const matrixInputPath = join(workspace, 'private-input.json');
  const traceAuditReportPath = join(workspace, 'trace-audit-report.json');
  try {
    const manifest = await runModelRouterComputerUseLiveAcceptanceReleaseHarness({
      now: () => new Date('2026-06-05T05:01:00.000Z'),
      routerUrl: 'https://provider.example/v1',
      matrixInputPath,
      traceAuditReportPath,
      expectedKnownSecretsChecked: 2,
      env: {
        SCIFORGE_CU_LIVE_DRY_RUN: '1',
        SCIFORGE_CU_LIVE_ACCEPTANCE_RUNNER: '/Applications/private/run-live --key sk-private-secret --model deepseek-v4-flash',
      },
    });

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.releaseAcceptance, 'not-evaluated');
    assert.equal(manifest.stages.preflight.status, 'blocked');
    assert.equal(manifest.stages.matrix.status, 'not-run');
    assert.ok(manifest.issues.includes('preflight-blocked'), manifest.issues.join('\n'));
    assert.doesNotMatch(JSON.stringify(manifest), forbiddenHarnessOutputPattern);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance release harness CLI strict fail-closes missing trace audit reports without leaking paths', async () => {
  const server = await startRouterFixtureServer();
  const workspace = await mkWorkspace('cu-live-release-harness-cli-');
  const matrixInputPath = join(workspace, 'input.json');
  const missingTraceAuditReportPath = join(workspace, 'private-missing-trace-audit-report.json');
  const results = requiredCaseIds.map((caseId) => fileBackedResult(caseId, `${workspaceRefFor(workspace)}/runs/current/${caseId}`));
  try {
    await writeEvidenceFilesForResults(results);
    await writeFile(matrixInputPath, `${JSON.stringify({ results }, null, 2)}\n`, 'utf8');

    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-computer-use-live-acceptance-release-harness.ts',
        '--router-url',
        server.url,
        '--request-disallow-shared-system-input',
        '--matrix-input',
        matrixInputPath,
        '--trace-audit-report',
        missingTraceAuditReportPath,
        '--expected-known-secrets-checked',
        '2',
        '--strict',
        '--json',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SCIFORGE_REQUIRE_MODEL_ROUTER_CU_LIVE_ACCEPTANCE: '1',
          SCIFORGE_CU_LIVE_EXECUTOR_KIND: 'desktop-native-host',
          SCIFORGE_CU_LIVE_ACCEPTANCE_RUNNER: '/Users/alice/bin/run-live-cu --provider https://provider.example/v1 --key sk-private-secret',
          SCIFORGE_TEXT_API_KEY: 'sk-text-secret-value',
          SCIFORGE_VISION_API_KEY: 'sk-vision-secret-value',
        },
      }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
        const manifest = JSON.parse(stdout) as Awaited<ReturnType<typeof runModelRouterComputerUseLiveAcceptanceReleaseHarness>>;
        assert.equal(stderr, '');
        assert.equal(manifest.status, 'blocked');
        assert.equal(manifest.stages.matrix.status, 'blocked');
        assert.ok(manifest.issues.includes('matrix-blocked'), manifest.issues.join('\n'));
        assert.equal(stdout.includes(missingTraceAuditReportPath), false);
        assert.doesNotMatch(stdout, forbiddenHarnessOutputPattern);
        assert.doesNotMatch(stderr, /Error:|at .*model-router-computer-use-live-acceptance-release-harness/);
        return true;
      },
    );
  } finally {
    await server.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

async function mkWorkspace(prefix: string) {
  const artifactsRoot = join(process.cwd(), 'artifacts', 'test-artifacts');
  await mkdir(artifactsRoot, { recursive: true });
  return mkdtemp(join(artifactsRoot, prefix));
}

function workspaceRefFor(path: string) {
  return relative(process.cwd(), path).replace(/\\/g, '/');
}

function fileBackedResult(caseId: string, baseRef: string): ModelRouterComputerUseLiveAcceptanceMatrixResult {
  const matrixCase = modelRouterComputerUseLiveAcceptanceCases.find((item) => item.id === caseId);
  assert.ok(matrixCase, `missing case ${caseId}`);
  const evidenceRefs: NonNullable<ModelRouterComputerUseLiveAcceptanceMatrixResult['evidenceRefs']> = {
    screenshotRefs: [`${baseRef}/screenshots/before.png`, `${baseRef}/screenshots/after.png`],
    verifierRefs: [`${baseRef}/verifier.json`],
  };
  if (matrixCase.requiredEvidenceKinds.includes('file')) evidenceRefs.fileRefs = [`${baseRef}/file-evidence.json`];
  if (matrixCase.requiredEvidenceKinds.includes('artifact')) evidenceRefs.artifactRefs = [`${baseRef}/artifact.json`];
  if (matrixCase.requiredEvidenceKinds.includes('terminal')) evidenceRefs.terminalRefs = [`${baseRef}/terminal.json`];
  return {
    caseId,
    status: 'passed',
    publicModelAlias: 'sciforge-router',
    routerProfile: 'sciforge-runtime-default',
    routerTraceRefs: [`${baseRef}/trace.json`],
    capabilityIds: [...matrixCase.requiredCapabilityIds],
    executor: {
      kind: 'native-host',
      currentRunRef: `${baseRef}/current-run.json`,
      executorRef: `${baseRef}/executor.json`,
      sessionRef: `${baseRef}/session.json`,
      nativeHostRef: `${baseRef}/native-host.json`,
      refs: [`${baseRef}/surface.json`],
    },
    evidenceRefs,
    gui: {
      presentRef: `${baseRef}/gui-present.json`,
    },
  };
}

async function writeEvidenceFilesForResults(results: ModelRouterComputerUseLiveAcceptanceMatrixResult[]) {
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const completedAt = new Date(Date.now() + 1000).toISOString();
  for (const result of results) {
    const currentRunRef = result.executor?.currentRunRef;
    assert.ok(currentRunRef);
    const runId = testRunIdForCurrentRunRef(currentRunRef);
    await writeJsonRef(currentRunRef, {
      schemaVersion: 'sciforge.model-router.computer-use.current-run.v1',
      runId,
      startedAt,
      completedAt,
    });
    const refs = [
      ...(result.routerTraceRefs ?? []),
      result.executor?.executorRef,
      result.executor?.sessionRef,
      result.executor?.nativeHostRef,
      ...(result.executor?.refs ?? []),
      ...(result.evidenceRefs?.screenshotRefs ?? []),
      ...(result.evidenceRefs?.fileRefs ?? []),
      ...(result.evidenceRefs?.artifactRefs ?? []),
      ...(result.evidenceRefs?.terminalRefs ?? []),
    ].filter((ref): ref is string => Boolean(ref));
    for (const ref of refs) {
      await writeJsonRef(ref, result.routerTraceRefs?.includes(ref) ? routerTraceForResult(result) : { ref, caseId: result.caseId });
    }
    assert.ok(result.gui?.presentRef);
    await writeJsonRef(result.gui.presentRef, {
      schemaVersion: 'sciforge.model-router.computer-use.evidence.v1',
      kind: 'gui.present',
      status: 'present',
      caseId: result.caseId,
      runId,
    });
    for (const verifierRef of result.evidenceRefs?.verifierRefs ?? []) {
      await writeJsonRef(verifierRef, {
        schemaVersion: 'sciforge.model-router.computer-use.evidence.v1',
        kind: 'verifier',
        status: 'passed',
        caseId: result.caseId,
        runId,
      });
    }
  }
}

function routerTraceForResult(result: ModelRouterComputerUseLiveAcceptanceMatrixResult) {
  return {
    schemaVersion: 'sciforge.model-router.trace.v1',
    profileId: result.routerProfile,
    publicModelAlias: result.publicModelAlias,
    calls: [
      { role: 'visionTranslator', status: 'ok' },
      { role: 'textReasoner', status: 'ok' },
    ],
  };
}

function traceAuditForResults(results: readonly ModelRouterComputerUseLiveAcceptanceMatrixResult[]) {
  return {
    schemaVersion: 'sciforge.model-router.trace-audit.v1',
    status: 'pass',
    traceRootSha256: '0'.repeat(64),
    reportRef: 'docs/test-artifacts/model-router-computer-use-live-matrix/trace-audit.json',
    scannedFiles: results.length,
    scannedBytes: results.length * 128,
    scannedFileRefs: results.flatMap((result) => result.routerTraceRefs ?? []),
    findings: [],
    policy: {
      knownSecretsChecked: 2,
      forbidsRawProviderPayload: true,
      forbidsRawPrivateUrls: true,
      forbidsLocalAbsolutePaths: true,
      forbidsInlineImageData: true,
    },
  };
}

function testRunIdForCurrentRunRef(ref: string) {
  return `test-run-${createHash('sha256').update(ref).digest('hex').slice(0, 12)}`;
}

async function writeJsonRef(ref: string, value: unknown) {
  const path = join(process.cwd(), ref);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function routerFixtureFor(path: string) {
  if (path === '/health') return { ok: true, service: 'sciforge.model-router' };
  if (path === '/manifest') {
    return {
      workerId: 'sciforge.model-router',
      capabilities: ['model_router_responses', 'text_reasoning', 'vision_translation', 'refs_first_trace'],
    };
  }
  if (path === '/v1/models') {
    return {
      object: 'list',
      data: [
        { id: 'qwen3.7-plus', object: 'model', owned_by: 'provider-private' },
        { id: 'deepseek-v4-flash', object: 'model', owned_by: 'provider-private' },
      ],
    };
  }
  return { error: { message: 'not found' } };
}

async function startRouterFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ? new URL(request.url, 'http://127.0.0.1').pathname : '/';
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(routerFixtureFor(path)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
