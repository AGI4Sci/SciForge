import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  modelRouterComputerUseLiveAcceptanceCases,
} from '../../tools/model-router-computer-use-live-acceptance-cases.js';
import {
  MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_CU_BUNDLE_ADAPTER_INPUT_SCHEMA_VERSION,
  MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_CU_BUNDLE_ADAPTER_SCHEMA_VERSION,
  runModelRouterComputerUseLiveAcceptanceCuBundleAdapter,
  type ModelRouterComputerUseLiveAcceptanceCuBundleAdapterInput,
} from '../../tools/model-router-computer-use-live-acceptance-cu-bundle-adapter.js';
import {
  runModelRouterComputerUseLiveAcceptanceMaterializer,
  type ModelRouterComputerUseLiveAcceptanceMaterializerInput,
} from '../../tools/model-router-computer-use-live-acceptance-materializer.js';

const execFileAsync = promisify(execFile);
const requiredCaseIds = modelRouterComputerUseLiveAcceptanceCases.map((item) => item.id);

const forbiddenAdapterOutputPattern =
  /data:image|;base64,|[A-Za-z0-9+/]{120,}={0,2}|rawProviderPayload|providerPayload|Authorization|Bearer|sk-[A-Za-z0-9_-]+|https?:\/\/provider\.example|(?:^|[\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)|qwen3\.7-plus|deepseek-v4-flash|raw-private-model/i;

test('CU bundle adapter writes materializer input from explicit five-case mapping without granting release acceptance', async () => {
  const workspace = await mkWorkspace('cu-bundle-adapter-pass-');
  const outMaterializerInput = join(workspace, 'materializer-input.json');
  const materializedInput = await adapterInput(workspace, 'cu-bundle-adapter-live-run');
  try {
    const manifest = await runModelRouterComputerUseLiveAcceptanceCuBundleAdapter({
      input: materializedInput,
      outMaterializerInputPath: outMaterializerInput,
      now: () => new Date('2026-06-05T06:00:00.000Z'),
    });
    const output = JSON.parse(await readFile(outMaterializerInput, 'utf8')) as ModelRouterComputerUseLiveAcceptanceMaterializerInput;
    const materializer = await runModelRouterComputerUseLiveAcceptanceMaterializer({
      input: output,
      outInputPath: join(workspace, 'matrix-input.json'),
      runRootPath: join(workspace, 'materialized-runs'),
      now: () => new Date('2026-06-05T06:00:01.000Z'),
    });

    assert.equal(manifest.schemaVersion, MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_CU_BUNDLE_ADAPTER_SCHEMA_VERSION);
    assert.equal(manifest.status, 'completed', manifest.issues.join('\n'));
    assert.equal(manifest.releaseAcceptance, 'not-evaluated');
    assert.equal(manifest.evidenceMode, 'cu-bundle-explicit-mapping-to-materializer-input-only');
    assert.equal(manifest.outputs.materializerInputWritten, true);
    assert.equal(manifest.outputs.materializerInputRef, workspaceRefFor(outMaterializerInput));
    assert.equal(output.schemaVersion, 'sciforge.model-router.computer-use.live-acceptance-materializer-input.v1');
    assert.equal(output.runId, 'cu-bundle-adapter-live-run');
    assert.deepEqual(output.cases.map((item) => item.caseId), requiredCaseIds);
    assert.equal(output.cases.every((item) => item.liveAttestation.realDesktopRun === true), true);
    assert.equal(output.cases.every((item) => item.liveAttestation.mutatingActionExecuted === true), true);
    assert.equal(materializer.status, 'completed', materializer.issues.join('\n'));
    assert.doesNotMatch(JSON.stringify(manifest), forbiddenAdapterOutputPattern);
    assert.doesNotMatch(JSON.stringify(output), forbiddenAdapterOutputPattern);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU bundle adapter blocks missing explicit five-case mappings and does not write materializer input', async () => {
  const workspace = await mkWorkspace('cu-bundle-adapter-missing-case-');
  const outMaterializerInput = join(workspace, 'materializer-input.json');
  const input = await adapterInput(workspace, 'missing-case-run');
  input.cases = input.cases.filter((item) => item.caseId !== 'ide-terminal');
  try {
    const manifest = await runModelRouterComputerUseLiveAcceptanceCuBundleAdapter({
      input,
      outMaterializerInputPath: outMaterializerInput,
      now: () => new Date('2026-06-05T06:00:00.000Z'),
    });

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.outputs.materializerInputWritten, false);
    assert.ok(manifest.issues.includes('missing-case:ide-terminal'), manifest.issues.join('\n'));
    await assert.rejects(access(outMaterializerInput));
    assert.doesNotMatch(JSON.stringify(manifest), forbiddenAdapterOutputPattern);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU bundle adapter blocks unsafe bundle refs and non-live attestations without leaking values', async () => {
  const workspace = await mkWorkspace('cu-bundle-adapter-unsafe-');
  const input = await adapterInput(workspace, 'unsafe-run');
  input.sourceBundle.traceRef = 'https://provider.example/v1/raw-trace.json';
  input.sourceBundle.acceptanceManifestRef = '/Users/alice/private/cu-user-acceptance-manifest.json';
  input.cases[0].liveAttestation.fixtureMode = true;
  input.cases[0].sourceRefs = ['Authorization: Bearer sk-private-secret', 'qwen3.7-plus'];
  try {
    const manifest = await runModelRouterComputerUseLiveAcceptanceCuBundleAdapter({
      input,
      outMaterializerInputPath: join(workspace, 'materializer-input.json'),
      now: () => new Date('2026-06-05T06:00:00.000Z'),
    });

    assert.equal(manifest.status, 'blocked');
    assert.ok(manifest.issues.includes('source-bundle-ref-unsafe'), manifest.issues.join('\n'));
    assert.ok(manifest.issues.includes('browser-research:live-attestation-fixture-mode'), manifest.issues.join('\n'));
    assert.ok(manifest.issues.includes('browser-research:unsafe-source-ref'), manifest.issues.join('\n'));
    assert.doesNotMatch(JSON.stringify(manifest), forbiddenAdapterOutputPattern);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU bundle adapter CLI strict fail-closes blocked inputs without stack traces or private paths', async () => {
  const workspace = await mkWorkspace('cu-bundle-adapter-cli-');
  const inputPath = join(workspace, 'private-adapter-input.json');
  const outMaterializerInput = join(workspace, 'materializer-input.json');
  const input = await adapterInput(workspace, 'cli-blocked-run');
  input.sourceBundle.traceRef = '/Applications/private/vision-trace.json';
  input.modelRouter.publicModelAlias = 'raw-private-model-qwen3.7-plus';
  try {
    await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8');
    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-computer-use-live-acceptance-cu-bundle-adapter.ts',
        '--input',
        inputPath,
        '--out-materializer-input',
        outMaterializerInput,
        '--strict',
        '--json',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
        const manifest = JSON.parse(stdout) as Awaited<ReturnType<typeof runModelRouterComputerUseLiveAcceptanceCuBundleAdapter>>;
        assert.equal(stderr, '');
        assert.equal(manifest.status, 'blocked');
        assert.equal(stdout.includes(inputPath), false);
        assert.equal(stdout.includes(outMaterializerInput), false);
        assert.doesNotMatch(stdout, forbiddenAdapterOutputPattern);
        assert.doesNotMatch(stderr, /Error:|at .*model-router-computer-use-live-acceptance-cu-bundle-adapter/);
        return true;
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

async function adapterInput(workspace: string, runId: string): Promise<ModelRouterComputerUseLiveAcceptanceCuBundleAdapterInput> {
  const workspaceRef = workspaceRefFor(workspace);
  const sourceRoot = `${workspaceRef}/source-bundle`;
  const traceRef = `${sourceRoot}/vision-trace.json`;
  const acceptanceManifestRef = `${sourceRoot}/cu-user-acceptance-manifest.json`;
  const completionEvidenceRef = `${sourceRoot}/isolated-desktop-l3-workflow-evidence.json`;
  await writeJsonRef(traceRef, {
    schemaVersion: 'sciforge.computer-use-long.vision-trace.v1',
    taskId: 'CU-NEXT-07',
    scenarioId: 'CU-LONG-007',
    config: {
      dryRun: false,
      testActionFixtureMode: false,
      allowSharedSystemInput: false,
    },
  });
  await writeJsonRef(acceptanceManifestRef, {
    schemaVersion: 'sciforge.computer-use.user-acceptance-manifest.v1',
    taskId: 'CU-NEXT-07',
    scenarioId: 'CU-LONG-007',
    status: 'passed',
    level: 'L3',
    completionEvidenceRef,
  });
  await writeJsonRef(completionEvidenceRef, {
    schemaVersion: 'sciforge.computer-use.completion-evidence.v1',
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
    errors: [],
  });

  return {
    schemaVersion: MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_CU_BUNDLE_ADAPTER_INPUT_SCHEMA_VERSION,
    runId,
    startedAt: '2026-06-05T06:00:00.000Z',
    completedAt: '2026-06-05T06:00:10.000Z',
    sourceBundle: {
      kind: 'cu-next-current-run-bundle',
      traceRef,
      acceptanceManifestRef,
      completionEvidenceRef,
      taskId: 'CU-NEXT-07',
      scenarioId: 'CU-LONG-007',
    },
    modelRouter: {
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
      capabilityIds: [
        'model-router.capability.computer-use.planner',
        'model-router.capability.computer-use.screenshot-translator',
        'model-router.capability.computer-use.grounding-translator',
        'model-router.capability.computer-use.verifier-translator',
      ],
    },
    cases: await Promise.all(modelRouterComputerUseLiveAcceptanceCases.map(async (matrixCase) => {
      const caseRoot = `${workspaceRef}/cases/${matrixCase.id}`;
      const routerTraceRef = `${caseRoot}/trace.json`;
      const screenshotRef = `${caseRoot}/screenshot.json`;
      const verifierRef = `${caseRoot}/verifier-source.json`;
      await writeJsonRef(routerTraceRef, {
        schemaVersion: 'sciforge.model-router.trace.v1',
        profileId: 'sciforge-runtime-default',
        publicModelAlias: 'sciforge-router',
        calls: [
          { role: 'visionTranslator', status: 'ok' },
          { role: 'textReasoner', status: 'ok' },
        ],
      });
      await writeJsonRef(screenshotRef, { kind: 'screenshot', caseId: matrixCase.id });
      await writeJsonRef(verifierRef, { kind: 'verifier-source', caseId: matrixCase.id, status: 'passed' });
      const evidenceRefs: ModelRouterComputerUseLiveAcceptanceCuBundleAdapterInput['cases'][number]['evidenceRefs'] = {
        screenshotRefs: [screenshotRef],
        verifierSourceRefs: [verifierRef],
      };
      if (matrixCase.requiredEvidenceKinds.includes('file')) {
        evidenceRefs.fileRefs = [`${caseRoot}/file-evidence.json`];
        await writeJsonRef(evidenceRefs.fileRefs[0], { kind: 'file', caseId: matrixCase.id });
      }
      if (matrixCase.requiredEvidenceKinds.includes('artifact')) {
        evidenceRefs.artifactRefs = [`${caseRoot}/artifact.json`];
        await writeJsonRef(evidenceRefs.artifactRefs[0], { kind: 'artifact', caseId: matrixCase.id });
      }
      if (matrixCase.requiredEvidenceKinds.includes('terminal')) {
        evidenceRefs.terminalRefs = [`${caseRoot}/terminal.json`];
        await writeJsonRef(evidenceRefs.terminalRefs[0], { kind: 'terminal', caseId: matrixCase.id });
      }
      return {
        caseId: matrixCase.id,
        executorKind: 'native-host' as const,
        routerTraceRefs: [routerTraceRef],
        sourceRefs: [
          traceRef,
          acceptanceManifestRef,
          completionEvidenceRef,
          `computer-use:native-host/events/${runId}/${matrixCase.id}.json`,
        ],
        executorSourceRefs: {
          sessionRef: `computer-use-session:${runId}-${matrixCase.id}`,
          nativeHostRef: `computer-use:native-host/provider-sessions/${runId}/${matrixCase.id}.json`,
          refs: [`computer-use:native-host/windows/${runId}/${matrixCase.id}.json`],
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
      };
    })),
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

async function writeJsonRef(ref: string, value: unknown) {
  const path = join(process.cwd(), ref);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
