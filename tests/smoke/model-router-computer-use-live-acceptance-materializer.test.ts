import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  modelRouterComputerUseLiveAcceptanceCases,
} from '../../tools/model-router-computer-use-live-acceptance-cases.js';
import {
  MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_INPUT_SCHEMA_VERSION,
  MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_SCHEMA_VERSION,
  runModelRouterComputerUseLiveAcceptanceMaterializer,
  type ModelRouterComputerUseLiveAcceptanceMaterializerInput,
} from '../../tools/model-router-computer-use-live-acceptance-materializer.js';
import type {
  ModelRouterComputerUseLiveAcceptanceMatrixResult,
} from '../../tools/model-router-computer-use-live-acceptance-matrix.js';

const execFileAsync = promisify(execFile);
const requiredCaseIds = modelRouterComputerUseLiveAcceptanceCases.map((item) => item.id);

const forbiddenMaterializerOutputPattern =
  /data:image|;base64,|[A-Za-z0-9+/]{120,}={0,2}|rawProviderPayload|providerPayload|Authorization|Bearer|sk-[A-Za-z0-9_-]+|https?:\/\/provider\.example|(?:^|[\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)|qwen3\.7-plus|deepseek-v4-flash|raw-private-model/i;

test('Model Router Computer Use live acceptance materializer writes current-run envelopes and matrix input from five live refs-first cases', async () => {
  const workspace = await mkWorkspace('cu-live-materializer-pass-');
  const workspaceRef = workspaceRefFor(workspace);
  const outInput = join(workspace, 'matrix-input.json');
  const runRoot = join(workspace, 'materialized-runs');
  const runRootRef = workspaceRefFor(runRoot);
  const input = await materializerInput(workspace, 'materializer-live-run');
  try {
    const manifest = await runModelRouterComputerUseLiveAcceptanceMaterializer({
      input,
      outInputPath: outInput,
      runRootPath: runRoot,
      now: () => new Date('2026-06-05T04:05:06.000Z'),
    });
    const matrixInput = JSON.parse(await readFile(outInput, 'utf8')) as { results: ModelRouterComputerUseLiveAcceptanceMatrixResult[] };

    assert.equal(manifest.schemaVersion, MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_SCHEMA_VERSION);
    assert.equal(manifest.status, 'completed', manifest.issues.join('\n'));
    assert.equal(manifest.releaseAcceptance, 'not-evaluated');
    assert.equal(manifest.evidenceMode, 'materialized-current-run-input-only');
    assert.equal(manifest.outputs.matrixInputWritten, true);
    assert.equal(manifest.outputs.matrixInputRef, workspaceRefFor(outInput));
    assert.equal(manifest.matrixPrecheck.status, 'passed', manifest.matrixPrecheck.issues.join('\n'));
    assert.deepEqual(matrixInput.results.map((item) => item.caseId), requiredCaseIds);
    assert.equal(JSON.stringify(matrixInput).includes('computer-use:'), false);
    assert.doesNotMatch(JSON.stringify(manifest), forbiddenMaterializerOutputPattern);
    assert.doesNotMatch(JSON.stringify(matrixInput), forbiddenMaterializerOutputPattern);

    for (const result of matrixInput.results) {
      const currentRunRef = `${runRootRef}/materializer-live-run/${result.caseId}/current-run.json`;
      assert.equal(result.executor?.currentRunRef, currentRunRef);
      assert.equal(result.gui?.presentRef, `${runRootRef}/materializer-live-run/${result.caseId}/gui-present.json`);
      assert.deepEqual(result.evidenceRefs?.verifierRefs, [
        `${runRootRef}/materializer-live-run/${result.caseId}/verifier.json`,
      ]);
      const currentRun = JSON.parse(await readFile(result.executor.currentRunRef, 'utf8')) as Record<string, unknown>;
      const gui = JSON.parse(await readFile(result.gui.presentRef!, 'utf8')) as Record<string, unknown>;
      const verifier = JSON.parse(await readFile(result.evidenceRefs!.verifierRefs![0], 'utf8')) as Record<string, unknown>;
      const executor = JSON.parse(await readFile(result.executor.executorRef!, 'utf8')) as Record<string, unknown>;
      assert.equal(currentRun.schemaVersion, 'sciforge.model-router.computer-use.current-run.v1');
      assert.equal(currentRun.runId, 'materializer-live-run');
      assert.equal(gui.schemaVersion, 'sciforge.model-router.computer-use.evidence.v1');
      assert.equal(gui.kind, 'gui.present');
      assert.equal(gui.status, 'present');
      assert.equal(gui.caseId, result.caseId);
      assert.equal(gui.runId, 'materializer-live-run');
      assert.equal(verifier.kind, 'verifier');
      assert.equal(verifier.status, 'passed');
      assert.equal(verifier.caseId, result.caseId);
      assert.equal(verifier.runId, 'materializer-live-run');
      assert.ok(JSON.stringify(executor).includes('computer-use:'), 'logical source refs stay inside materialized envelopes');
    }

    assert.ok(workspaceRef.length > 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance materializer blocks unsafe source refs without writing matrix input or leaking values', async () => {
  const workspace = await mkWorkspace('cu-live-materializer-unsafe-');
  const outInput = join(workspace, 'matrix-input.json');
  const input = await materializerInput(workspace, 'unsafe-run');
  input.cases[0].evidenceRefs.screenshotRefs = ['gui.present:unsafe-run/browser-research'];
  input.cases[0].evidenceRefs.fileRefs = ['/Users/alice/private/raw-observation.json'];
  input.cases[0].sourceRefs = [
    'https://provider.example/v1',
    'Authorization: Bearer sk-private-secret',
    'qwen3.7-plus',
  ];
  try {
    const manifest = await runModelRouterComputerUseLiveAcceptanceMaterializer({
      input,
      outInputPath: outInput,
      runRootPath: join(workspace, 'materialized-runs'),
      now: () => new Date('2026-06-05T04:05:06.000Z'),
    });

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.outputs.matrixInputWritten, false);
    assert.ok(manifest.issues.includes('browser-research:unsafe-source-or-evidence-ref'), manifest.issues.join('\n'));
    assert.ok(manifest.issues.includes('browser-research:forbidden-diagnostic-payload'), manifest.issues.join('\n'));
    await assert.rejects(access(outInput));
    assert.doesNotMatch(JSON.stringify(manifest), forbiddenMaterializerOutputPattern);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance materializer blocks GUI projection refs as action-runner sources', async () => {
  const workspace = await mkWorkspace('cu-live-materializer-ui-projection-');
  const outInput = join(workspace, 'matrix-input.json');
  const input = await materializerInput(workspace, 'ui-projection-run');
  input.cases[0].sourceRefs = ['gui.present:ui-projection-run/browser-research'];
  input.cases[0].executorSourceRefs = {
    ...input.cases[0].executorSourceRefs,
    refs: ['gui.present:ui-projection-run/browser-research/executor'],
  };
  try {
    const manifest = await runModelRouterComputerUseLiveAcceptanceMaterializer({
      input,
      outInputPath: outInput,
      runRootPath: join(workspace, 'materialized-runs'),
      now: () => new Date('2026-06-05T04:05:06.000Z'),
    });

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.outputs.matrixInputWritten, false);
    assert.ok(manifest.issues.includes('browser-research:ui-projection-source-not-action-runner'), manifest.issues.join('\n'));
    await assert.rejects(access(outInput));
    assert.doesNotMatch(JSON.stringify(manifest), forbiddenMaterializerOutputPattern);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance materializer blocks non-mutating or diagnostic-only live attestations', async () => {
  const workspace = await mkWorkspace('cu-live-materializer-attestation-');
  const outInput = join(workspace, 'matrix-input.json');
  const input = await materializerInput(workspace, 'attestation-run');
  input.cases[0].liveAttestation.mutatingActionExecuted = false;
  input.cases[1].liveAttestation.diagnosticOnly = true;
  input.cases[2].liveAttestation.sharedSystemInputUsed = true;
  try {
    const manifest = await runModelRouterComputerUseLiveAcceptanceMaterializer({
      input,
      outInputPath: outInput,
      runRootPath: join(workspace, 'materialized-runs'),
      now: () => new Date('2026-06-05T04:05:06.000Z'),
    });

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.releaseAcceptance, 'not-evaluated');
    assert.equal(manifest.outputs.matrixInputWritten, false);
    assert.ok(manifest.issues.includes('browser-research:live-attestation-mutating-action-missing'), manifest.issues.join('\n'));
    assert.ok(manifest.issues.includes('docs-sheets-edit:live-attestation-diagnostic-only'), manifest.issues.join('\n'));
    assert.ok(manifest.issues.includes('file-management:live-attestation-shared-system-input'), manifest.issues.join('\n'));
    await assert.rejects(access(outInput));
    assert.doesNotMatch(JSON.stringify(manifest), forbiddenMaterializerOutputPattern);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance materializer CLI strict fail-closes blocked input without stack traces or sensitive values', async () => {
  const workspace = await mkWorkspace('cu-live-materializer-cli-');
  const inputPath = join(workspace, 'private-materializer-input.json');
  const outInput = join(workspace, 'matrix-input.json');
  const input = await materializerInput(workspace, 'cli-blocked-run');
  input.cases[0].liveAttestation.fixtureMode = true;
  input.cases[0].sourceRefs = [
    'https://provider.example/v1',
    'Authorization: Bearer sk-private-secret',
    '/Applications/private/raw-live-run.json',
    'deepseek-v4-flash',
  ];
  try {
    await writeFile(inputPath, JSON.stringify(input, null, 2), 'utf8');
    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-computer-use-live-acceptance-materializer.ts',
        '--input',
        inputPath,
        '--out-input',
        outInput,
        '--run-root',
        join(workspace, 'materialized-runs'),
        '--strict',
        '--json',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
        const manifest = JSON.parse(stdout) as Awaited<ReturnType<typeof runModelRouterComputerUseLiveAcceptanceMaterializer>>;
        assert.equal(stderr, '');
        assert.equal(manifest.status, 'blocked');
        assert.equal(manifest.source.kind, 'input-file');
        assert.equal(stdout.includes(inputPath), false);
        assert.equal(stdout.includes(outInput), false);
        assert.doesNotMatch(stdout, forbiddenMaterializerOutputPattern);
        assert.doesNotMatch(stderr, /Error:|at .*model-router-computer-use-live-acceptance-materializer/);
        return true;
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

async function materializerInput(workspace: string, runId: string): Promise<ModelRouterComputerUseLiveAcceptanceMaterializerInput> {
  const workspaceRef = workspaceRefFor(workspace);
  const cases = [];
  for (const matrixCase of modelRouterComputerUseLiveAcceptanceCases) {
    const caseRootRef = `${workspaceRef}/source/${matrixCase.id}`;
    const traceRef = `${workspaceRef}/traces/${matrixCase.id}/trace.json`;
    const screenshotRef = `${caseRootRef}/screenshot.png`;
    const verifierSourceRef = `${caseRootRef}/verifier-source.json`;
    await writeJsonRef(traceRef, {
      schemaVersion: 'sciforge.model-router.trace.v1',
      profileId: 'sciforge-runtime-default',
      publicModelAlias: 'sciforge-router',
      calls: [
        { role: 'visionTranslator', status: 'ok' },
        { role: 'textReasoner', status: 'ok' },
      ],
    });
    await writeFileRef(screenshotRef, 'png-bytes-placeholder\n');
    await writeJsonRef(verifierSourceRef, { status: 'passed', caseId: matrixCase.id });

    const evidenceRefs: ModelRouterComputerUseLiveAcceptanceMaterializerInput['cases'][number]['evidenceRefs'] = {
      screenshotRefs: [screenshotRef],
      verifierSourceRefs: [verifierSourceRef],
    };
    if (matrixCase.requiredEvidenceKinds.includes('file')) {
      evidenceRefs.fileRefs = [`${caseRootRef}/file-evidence.json`];
      await writeJsonRef(evidenceRefs.fileRefs[0], { kind: 'file', caseId: matrixCase.id });
    }
    if (matrixCase.requiredEvidenceKinds.includes('artifact')) {
      evidenceRefs.artifactRefs = [`${caseRootRef}/artifact.json`];
      await writeJsonRef(evidenceRefs.artifactRefs[0], { kind: 'artifact', caseId: matrixCase.id });
    }
    if (matrixCase.requiredEvidenceKinds.includes('terminal')) {
      evidenceRefs.terminalRefs = [`${caseRootRef}/terminal.json`];
      await writeJsonRef(evidenceRefs.terminalRefs[0], { kind: 'terminal', caseId: matrixCase.id });
    }

    cases.push({
      caseId: matrixCase.id,
      status: 'passed' as const,
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
      routerTraceRefs: [traceRef],
      capabilityIds: [...matrixCase.requiredCapabilityIds],
      executorKind: 'native-host' as const,
      sourceRefs: [
        `computer-use:native-host/events/${runId}/${matrixCase.id}/action-ledger.json`,
      ],
      executorSourceRefs: {
        sessionRef: `computer-use-session:${runId}-${matrixCase.id}`,
        nativeHostRef: `computer-use:native-host/provider-sessions/${runId}/${matrixCase.id}.json`,
        refs: [
          `computer-use:native-host/windows/${runId}/${matrixCase.id}.json`,
        ],
      },
      liveAttestation: {
        realDesktopRun: true,
        mutatingActionExecuted: true,
        diagnosticOnly: false,
        dryRun: false,
        fixtureMode: false,
        sharedSystemInputUsed: false,
      },
      evidenceRefs,
    });
  }
  return {
    schemaVersion: MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_INPUT_SCHEMA_VERSION,
    runId,
    startedAt: '2026-06-05T04:05:00.000Z',
    completedAt: '2026-06-05T04:05:06.000Z',
    publicModelAlias: 'sciforge-router',
    routerProfile: 'sciforge-runtime-default',
    cases,
  };
}

async function mkWorkspace(prefix: string) {
  const artifactsRoot = join(process.cwd(), 'artifacts', 'test-artifacts');
  await mkdir(artifactsRoot, { recursive: true });
  return mkdtemp(join(artifactsRoot, prefix));
}

function workspaceRefFor(path: string) {
  return relative(process.cwd(), path).replace(/\\/g, '/');
}

async function writeFileRef(ref: string, value: string) {
  const path = join(process.cwd(), ref);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, value, 'utf8');
}

async function writeJsonRef(ref: string, value: unknown) {
  await writeFileRef(ref, `${JSON.stringify(value, null, 2)}\n`);
}
