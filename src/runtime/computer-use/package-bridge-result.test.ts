import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { promotePackageResultFinalArtifactRefs } from './package-bridge-final-artifacts.js';
import { materializePackageBridgeResult } from './package-bridge-result.js';
import type { GenericVisionAction, ScreenshotRef } from './types.js';
import type { VirtualRemoteVisibleArtifact } from './virtual-remote-session.js';

function screenshot(id: string): ScreenshotRef {
  return {
    id,
    path: `.sciforge/vision-runs/run-1/${id}.png`,
    absPath: `/tmp/sciforge-test/${id}.png`,
    bytes: 10,
    sha256: 'abc123',
    width: 800,
    height: 600,
    captureScope: 'display',
    displayId: 1,
  };
}

function visibleArtifact(
  ref: string,
  status: VirtualRemoteVisibleArtifact['status'] = 'visible-and-saved',
  kind: VirtualRemoteVisibleArtifact['kind'] = 'virtual-document',
  options: {
    sourceActionIds?: string[];
    artifactEvidence?: Record<string, unknown>;
  } = {},
): VirtualRemoteVisibleArtifact {
  const artifactEvidence = options.artifactEvidence ?? validatedArtifactEvidence(ref);
  return {
    schemaVersion: 'sciforge.computer-use.virtual-remote-artifact.v1',
    id: 'artifact-1',
    kind,
    title: 'report.md',
    artifactRef: ref,
    path: ref,
    dataRef: ref,
    appId: 'computer-use-package-bridge',
    delivery: 'virtual-remote-session-artifact',
    status,
    visibleTexts: ['Final report'],
    sourceActionIds: options.sourceActionIds ?? ['action-1'],
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
    ...(artifactEvidence ? artifactEvidence : {}),
  } as VirtualRemoteVisibleArtifact;
}

function validatedArtifactEvidence(ref: string): Record<string, unknown> {
  const runDir = ref.replace(/\/[^/]+$/, '');
  const artifactValidationRef = `${ref}.validation.json`;
  return {
    artifactRefs: [ref, artifactValidationRef],
    contentRefs: [ref],
    sourceRefs: [`${runDir}/source-facts.json`],
    artifactValidationRef,
    validator: 'sciforge-generic-markdown-artifact-contract-validator',
    format: 'markdown',
    sha256: 'a'.repeat(64),
    bytes: 128,
    savedByActionIndex: 0,
    savedByActionId: 'action-1',
    verifierVerdictRef: `${runDir}/verifier-verdict.json`,
    currentRunCausality: true,
    metadata: {
      artifactRefs: [ref, artifactValidationRef],
      artifactValidationRef,
      validator: 'sciforge-generic-markdown-artifact-contract-validator',
      format: 'markdown',
      sha256: 'a'.repeat(64),
      bytes: 128,
      sourceRefs: [`${runDir}/source-facts.json`],
      contentRefs: [ref],
      savedByActionIndex: 0,
      savedByActionId: 'action-1',
      verifierVerdictRef: `${runDir}/verifier-verdict.json`,
      currentRunCausality: true,
    },
  };
}

test('package bridge result materializer fail-closes completed visible-artifact tasks without final artifact refs', () => {
  const materialized = materializePackageBridgeResult({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      metrics: { actionCount: 1 },
    },
    task: 'Create a final report artifact for the visible results.',
    executedActions: [{ type: 'click', targetDescription: 'export report' }],
    visibleArtifacts: [],
    screenshotLedger: [screenshot('step-001-before'), screenshot('step-001-after')],
  });

  assert.equal(materialized.succeeded, false);
  assert.equal(materialized.payloadStatus, 'failed-with-reason');
  assert.equal(materialized.packageResult.status, 'failed-with-reason');
  assert.equal(
    (materialized.packageResult.failureDiagnostics as Record<string, unknown>).failedStage,
    'visible-artifact-final-guard',
  );
  assert.match(materialized.failureReason, /Visible artifact task did not satisfy completion acceptance/i);
  assert.equal(materialized.finalVisibleScreenshotRef, '.sciforge/vision-runs/run-1/step-001-after.png');
});

test('package bridge result materializer preserves completed result with current final artifact refs', () => {
  const artifactRef = '.sciforge/vision-runs/run-1/report.md';
  const materialized = materializePackageBridgeResult({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      metrics: { actionCount: 1 },
    },
    task: 'Create a final report artifact for the visible results.',
    executedActions: [{ type: 'click', targetDescription: 'export report' }],
    visibleArtifacts: [visibleArtifact(artifactRef)],
    screenshotLedger: [screenshot('step-001-before'), screenshot('step-001-focus-after')],
  });

  assert.equal(materialized.succeeded, true);
  assert.equal(materialized.payloadStatus, 'done');
  assert.equal(materialized.packageResult.status, 'completed');
  assert.equal(materialized.failureReason, '');
  assert.equal(materialized.finalArtifactRef, artifactRef);
  assert.deepEqual(materialized.finalArtifactRefs, [artifactRef]);
  assert.equal(materialized.finalVisibleScreenshotRef, '.sciforge/vision-runs/run-1/step-001-before.png');
});

test('package bridge result materializer fail-closes final file artifacts without validation and causality evidence', () => {
  const artifactRef = '.sciforge/vision-runs/run-1/report.md';
  const materialized = materializePackageBridgeResult({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      metrics: { actionCount: 1 },
    },
    task: 'Create a final report artifact for the visible results.',
    executedActions: [{ type: 'click', targetDescription: 'export report' }],
    visibleArtifacts: [
      visibleArtifact(artifactRef, 'visible-and-saved', 'virtual-document', {
        sourceActionIds: [],
        artifactEvidence: {},
      }),
    ],
    screenshotLedger: [screenshot('step-001-before'), screenshot('step-001-after')],
  });

  assert.equal(materialized.succeeded, false);
  assert.equal(materialized.payloadStatus, 'failed-with-reason');
  assert.equal(materialized.packageResult.status, 'failed-with-reason');
  assert.equal(
    (materialized.packageResult.failureDiagnostics as Record<string, unknown>).failedStage,
    'completion-artifact-guard',
  );
  assert.match(materialized.failureReason, /artifact validation/i);
  assert.match(materialized.failureReason, /action causality/i);
});

test('package bridge result materializer requires saved-by-action index for final file artifacts', () => {
  const artifactRef = '.sciforge/vision-runs/run-1/report.md';
  const evidence = validatedArtifactEvidence(artifactRef);
  delete evidence.savedByActionIndex;
  delete (evidence.metadata as Record<string, unknown>).savedByActionIndex;
  const materialized = materializePackageBridgeResult({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      metrics: { actionCount: 1 },
    },
    task: 'Create a final report artifact for the visible results.',
    executedActions: [{ type: 'click', targetDescription: 'export report' }],
    visibleArtifacts: [visibleArtifact(artifactRef, 'visible-and-saved', 'virtual-document', {
      artifactEvidence: evidence,
    })],
    screenshotLedger: [screenshot('step-001-before'), screenshot('step-001-after')],
  });

  assert.equal(materialized.succeeded, false);
  assert.equal(materialized.payloadStatus, 'failed-with-reason');
  assert.equal(materialized.packageResult.status, 'failed-with-reason');
  assert.match(materialized.failureReason, /savedByActionIndex/i);
});

test('package bridge result materializer rejects verification-only package steps as save action causality', () => {
  const artifactRef = '.sciforge/vision-runs/run-1/report.md';
  const evidence = validatedArtifactEvidence(artifactRef);
  evidence.savedByActionIndex = 1;
  (evidence.metadata as Record<string, unknown>).savedByActionIndex = 1;

  const materialized = materializePackageBridgeResult({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      metrics: { actionCount: 1 },
      steps: [
        { status: 'done', action: { type: 'click', targetDescription: 'prepare report' } },
        {
          status: 'done',
          verification: {
            done: true,
            ok: true,
            ref: '.sciforge/vision-runs/run-1/verifier-verdict.json',
            finalArtifactRefs: [artifactRef],
          },
        },
      ],
    },
    task: 'Create a final report artifact for the visible results.',
    executedActions: [],
    visibleArtifacts: [visibleArtifact(artifactRef, 'visible-and-saved', 'virtual-document', {
      artifactEvidence: evidence,
    })],
    screenshotLedger: [screenshot('step-001-before'), screenshot('step-001-after')],
  });

  assert.equal(materialized.succeeded, false);
  assert.equal(materialized.payloadStatus, 'failed-with-reason');
  assert.match(materialized.failureReason, /savedByActionIndex/i);
});

test('package bridge result materializer requires artifact validation sidecar refs to be bound', () => {
  const artifactRef = '.sciforge/vision-runs/run-1/report.md';
  const evidence = validatedArtifactEvidence(artifactRef);
  evidence.artifactRefs = [artifactRef];
  (evidence.metadata as Record<string, unknown>).artifactRefs = [artifactRef];

  const materialized = materializePackageBridgeResult({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      metrics: { actionCount: 1 },
    },
    task: 'Create a final report artifact for the visible results.',
    executedActions: [{ type: 'click', targetDescription: 'export report' }],
    visibleArtifacts: [visibleArtifact(artifactRef, 'visible-and-saved', 'virtual-document', {
      artifactEvidence: evidence,
    })],
    screenshotLedger: [screenshot('step-001-before'), screenshot('step-001-after')],
  });

  assert.equal(materialized.succeeded, false);
  assert.equal(materialized.payloadStatus, 'failed-with-reason');
  assert.match(materialized.failureReason, /artifactValidationRef/i);
});

test('package bridge result materializer requires explicit verifier refs for package step validation', () => {
  const artifactRef = '.sciforge/vision-runs/run-1/report.md';
  const evidence = validatedArtifactEvidence(artifactRef);
  const metadata = evidence.metadata as Record<string, unknown>;
  delete evidence.verifierVerdictRef;
  delete metadata.verifierVerdictRef;

  const materialized = materializePackageBridgeResult({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      metrics: { actionCount: 1 },
      steps: [{
        status: 'done',
        verification: {
          done: true,
          ok: true,
          finalArtifactRefs: [artifactRef],
          metadata: {
            finalArtifactRefs: [artifactRef],
            method: 'visual-check',
          },
        },
      }],
    },
    task: 'Create a final report artifact for the visible results.',
    executedActions: [{ type: 'click', targetDescription: 'export report' }],
    visibleArtifacts: [visibleArtifact(artifactRef, 'visible-and-saved', 'virtual-document', {
      artifactEvidence: evidence,
    })],
    screenshotLedger: [screenshot('step-001-before'), screenshot('step-001-after')],
  });

  assert.equal(materialized.succeeded, false);
  assert.equal(materialized.payloadStatus, 'failed-with-reason');
  assert.match(materialized.failureReason, /verifier support/i);
});

test('package bridge result materializer accepts draft-visible report artifact refs', () => {
  const artifactRef = '.sciforge/vision-runs/run-1/report.md';
  const materialized = materializePackageBridgeResult({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      metrics: { actionCount: 1 },
    },
    task: 'Create a short local visible report artifact in the editor body.',
    executedActions: [{ type: 'type_text', text: 'Visible report body' }],
    visibleArtifacts: [
      visibleArtifact('.sciforge/vision-runs/run-1/visible-file-index.md', 'visible-and-saved', 'virtual-file-index'),
      visibleArtifact(artifactRef, 'draft-visible'),
    ],
    screenshotLedger: [screenshot('step-001-before'), screenshot('step-001-after')],
  });

  assert.equal(materialized.succeeded, true);
  assert.equal(materialized.payloadStatus, 'done');
  assert.equal(materialized.finalArtifactRef, artifactRef);
  assert.deepEqual(materialized.finalArtifactRefs, [artifactRef]);
});

test('package bridge final artifact promotion writes generic validation sidecars for common file formats', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-final-artifacts-'));
  try {
    const runDirRef = '.sciforge/vision-runs/generic-artifacts';
    const runDir = join(workspace, runDirRef);
    await mkdir(runDir, { recursive: true });
    const artifacts = [
      ['briefing.pptx', Buffer.from('PK\x03\x04pptx contract bytes')],
      ['summary.docx', Buffer.from('PK\x03\x04docx contract bytes')],
      ['data.csv', Buffer.from('a,b\n1,2\n')],
      ['report.md', Buffer.from('# Report\n\nCurrent result.\n')],
      ['research-report.pdf', Buffer.from('%PDF-1.7\ncontract report\n')],
      ['figure.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])],
    ] as const;
    await Promise.all(artifacts.map(([name, bytes]) => writeFile(join(runDir, name), bytes)));

    const finalArtifactRefs = artifacts.map(([name], savedByActionIndex) => ({
      artifactRef: `${runDirRef}/${name}`,
      sourceRefs: [`${runDirRef}/source-${savedByActionIndex}.json`],
      contentRefs: [`${runDirRef}/${name}`],
      savedByActionIndex,
      savedByActionId: `action-${savedByActionIndex}`,
    }));
    const state = { runDir, visibleArtifacts: [] as VirtualRemoteVisibleArtifact[] };
    promotePackageResultFinalArtifactRefs({
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      steps: [{
        status: 'done',
        verification: {
          ok: true,
          done: true,
          metadata: { finalArtifactRefs },
        },
      }],
    }, workspace, state);

    assert.equal(state.visibleArtifacts.length, artifacts.length);
    for (const artifact of state.visibleArtifacts as Array<VirtualRemoteVisibleArtifact & Record<string, unknown>>) {
      const validationRef = String(artifact.artifactValidationRef);
      assert.equal(validationRef, `${artifact.artifactRef}.validation.json`);
      assert.deepEqual(artifact.artifactRefs, [artifact.artifactRef, validationRef]);
      assert.deepEqual((artifact.metadata as Record<string, unknown>).artifactRefs, [artifact.artifactRef, validationRef]);
      assert.match(String(artifact.sha256), /^[a-f0-9]{64}$/);
      assert.equal(typeof artifact.bytes, 'number');
      assert.equal(typeof artifact.format, 'string');
      assert.match(String(artifact.validator), /^sciforge-generic-.+-artifact-contract-validator$/);
      assert.equal(typeof artifact.savedByActionIndex, 'number');
      const validation = JSON.parse(await readFile(join(workspace, validationRef), 'utf8')) as Record<string, unknown>;
      assert.equal(validation.schemaVersion, 'sciforge.computer-use.generic-artifact-validation.v1');
      assert.equal(validation.status, 'passed');
      assert.equal(validation.diagnosticOnly, true);
      assert.equal(validation.productAcceptanceEvidence, false);
      assert.equal(validation.finalArtifactRef, artifact.artifactRef);
      assert.equal(validation.artifactValidationRef, validationRef);
      assert.equal(validation.sha256, artifact.sha256);
      assert.deepEqual(validation.contentRefs, [artifact.artifactRef]);
      assert.ok(Array.isArray(validation.sourceRefs));
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge final artifact promotion materializes verifier verdict refs for package step validations', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-final-verifier-'));
  try {
    const runDirRef = '.sciforge/vision-runs/verifier-artifact';
    const runDir = join(workspace, runDirRef);
    await mkdir(runDir, { recursive: true });
    const artifactRef = `${runDirRef}/report.md`;
    await writeFile(join(workspace, artifactRef), '# Report\n\nCurrent result.\n', 'utf8');
    const state = { runDir, visibleArtifacts: [] as VirtualRemoteVisibleArtifact[] };

    promotePackageResultFinalArtifactRefs({
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      steps: [{
        status: 'done',
        beforeRef: `${runDirRef}/before.png`,
        afterRef: `${runDirRef}/after.png`,
        verification: {
          ok: true,
          done: true,
          reason: 'current package verifier accepted report',
          metadata: {
            finalArtifactRefs: [artifactRef],
            evidenceRefs: [`${runDirRef}/after.png`],
          },
        },
      }],
    }, workspace, state);

    const artifact = state.visibleArtifacts[0] as VirtualRemoteVisibleArtifact & Record<string, unknown>;
    const verifierVerdictRef = `${artifactRef}.verifier-verdict.json`;
    assert.equal(artifact.verifierVerdictRef, verifierVerdictRef);
    assert.equal((artifact.metadata as Record<string, unknown>).verifierVerdictRef, verifierVerdictRef);
    assert.equal(artifact.currentRunCausality, true);
    const verifierVerdict = JSON.parse(await readFile(join(workspace, verifierVerdictRef), 'utf8')) as Record<string, unknown>;
    assert.equal(verifierVerdict.schemaVersion, 'sciforge.computer-use.package-artifact-verifier-verdict.v1');
    assert.equal(verifierVerdict.status, 'passed');
    assert.equal(verifierVerdict.diagnosticOnly, true);
    assert.equal(verifierVerdict.productAcceptanceEvidence, false);
    assert.equal(verifierVerdict.finalArtifactRef, artifactRef);
    assert.deepEqual(verifierVerdict.contentRefs, [artifactRef]);
    assert.deepEqual(verifierVerdict.sourceRefs, [`${runDirRef}/before.png`, `${runDirRef}/after.png`]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge final artifact promotion does not self-validate oversized artifacts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-large-final-artifact-'));
  try {
    const runDirRef = '.sciforge/vision-runs/large-artifact';
    const runDir = join(workspace, runDirRef);
    await mkdir(runDir, { recursive: true });
    const artifactRef = `${runDirRef}/large-report.md`;
    const file = await open(join(workspace, artifactRef), 'w');
    try {
      await file.truncate(17 * 1024 * 1024);
    } finally {
      await file.close();
    }
    const state = { runDir, visibleArtifacts: [] as VirtualRemoteVisibleArtifact[] };

    promotePackageResultFinalArtifactRefs({
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      steps: [{
        status: 'done',
        beforeRef: `${runDirRef}/before.png`,
        afterRef: `${runDirRef}/after.png`,
        verification: {
          ok: true,
          done: true,
          metadata: {
            finalArtifactRefs: [{
              artifactRef,
              sourceRefs: [`${runDirRef}/before.png`, `${runDirRef}/after.png`],
              contentRefs: [artifactRef],
              savedByActionIndex: 0,
              savedByActionId: 'action-1',
            }],
          },
        },
      }],
    }, workspace, state);

    assert.equal(state.visibleArtifacts.length, 1);
    const artifact = state.visibleArtifacts[0] as VirtualRemoteVisibleArtifact & Record<string, unknown>;
    assert.equal(artifact.artifactRef, artifactRef);
    assert.equal(artifact.artifactValidationRef, undefined);
    await assert.rejects(readFile(join(workspace, `${artifactRef}.validation.json`)), /ENOENT/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge final artifact promotion enriches existing visible artifacts with validation evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-existing-final-artifact-'));
  try {
    const runDirRef = '.sciforge/vision-runs/existing-artifact';
    const runDir = join(workspace, runDirRef);
    await mkdir(runDir, { recursive: true });
    const artifactRef = `${runDirRef}/report.md`;
    await writeFile(join(workspace, artifactRef), '# Report\n\nCurrent result.\n', 'utf8');
    const state = {
      runDir,
      visibleArtifacts: [
        visibleArtifact(artifactRef, 'visible-and-saved', 'virtual-document', {
          artifactEvidence: {},
          sourceActionIds: ['step-002-type_text'],
        }),
      ],
    };

    promotePackageResultFinalArtifactRefs({
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      steps: [{
        status: 'done',
        beforeRef: `${runDirRef}/before.png`,
        afterRef: `${runDirRef}/after.png`,
        verification: {
          ok: true,
          done: true,
          metadata: { finalArtifactRefs: [artifactRef] },
        },
      }],
    }, workspace, state);

    assert.equal(state.visibleArtifacts.length, 1);
    const artifact = state.visibleArtifacts[0] as VirtualRemoteVisibleArtifact & Record<string, unknown>;
    assert.equal(artifact.artifactRef, artifactRef);
    assert.deepEqual(artifact.sourceActionIds, ['step-002-type_text', 'package-result-final-artifact']);
    assert.deepEqual(artifact.visibleTexts, ['Final report']);
    assert.equal(artifact.artifactValidationRef, `${artifactRef}.validation.json`);
    assert.match(String(artifact.sha256), /^[a-f0-9]{64}$/);
    assert.equal(artifact.format, 'markdown');
    assert.deepEqual(artifact.artifactRefs, [artifactRef, `${artifactRef}.validation.json`]);
    assert.deepEqual(artifact.contentRefs, [artifactRef]);
    assert.deepEqual(artifact.sourceRefs, [`${runDirRef}/before.png`, `${runDirRef}/after.png`]);
    const validation = JSON.parse(await readFile(join(workspace, `${artifactRef}.validation.json`), 'utf8')) as Record<string, unknown>;
    assert.equal(validation.status, 'passed');
    assert.equal(validation.diagnosticOnly, true);
    assert.equal(validation.productAcceptanceEvidence, false);
    assert.equal(validation.finalArtifactRef, artifactRef);
    assert.deepEqual(validation.sourceRefs, [`${runDirRef}/before.png`, `${runDirRef}/after.png`]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge final artifact promotion rejects stale source refs and overwrites stale validation metadata', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-stale-final-artifact-'));
  try {
    const runId = 'stale-artifact';
    const runDirRef = `.sciforge/vision-runs/${runId}`;
    const runDir = join(workspace, runDirRef);
    await mkdir(runDir, { recursive: true });
    const artifactRef = `${runDirRef}/report.md`;
    await writeFile(join(workspace, artifactRef), '# Report\n\nCurrent result.\n', 'utf8');
    const state = {
      runDir,
      visibleArtifacts: [
        visibleArtifact(artifactRef, 'visible-and-saved', 'virtual-document', {
          sourceActionIds: ['step-002-type_text'],
          artifactEvidence: {
            artifactValidationRef: `${runDirRef}/old.validation.json`,
            validator: 'stale-validator',
            format: 'text',
            sha256: '0'.repeat(64),
            artifactRefs: ['.sciforge/vision-runs/old-run/report.md'],
            sourceRefs: ['.sciforge/vision-runs/old-run/source.json'],
            contentRefs: ['.sciforge/vision-runs/old-run/report.md'],
            metadata: {
              artifactValidationRef: `${runDirRef}/old.validation.json`,
              validator: 'stale-validator',
              format: 'text',
              sha256: '0'.repeat(64),
              artifactRefs: ['.sciforge/vision-runs/old-run/report.md'],
              sourceRefs: ['.sciforge/vision-runs/old-run/source.json'],
              contentRefs: ['.sciforge/vision-runs/old-run/report.md'],
            },
          },
        }),
      ],
    };

    promotePackageResultFinalArtifactRefs({
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      steps: [{
        status: 'done',
        beforeRef: `${runDirRef}/before.png`,
        afterRef: `${runDirRef}/after.png`,
        verification: {
          ok: true,
          done: true,
          metadata: {
            finalArtifactRefs: [{
              artifactRef,
              sourceRefs: ['.sciforge/vision-runs/old-run/source.json'],
            }],
          },
        },
      }],
    }, workspace, state);

    const artifact = state.visibleArtifacts[0] as VirtualRemoteVisibleArtifact & Record<string, unknown>;
    assert.equal(artifact.artifactValidationRef, `${artifactRef}.validation.json`);
    assert.notEqual(artifact.validator, 'stale-validator');
    assert.notEqual(artifact.sha256, '0'.repeat(64));
    assert.deepEqual(artifact.artifactRefs, [artifactRef, `${artifactRef}.validation.json`]);
    assert.deepEqual(artifact.sourceRefs, [`${runDirRef}/before.png`, `${runDirRef}/after.png`]);
    assert.deepEqual(artifact.contentRefs, [artifactRef]);
    assert.deepEqual((artifact.metadata as Record<string, unknown>).artifactRefs, [artifactRef, `${artifactRef}.validation.json`]);
    assert.deepEqual((artifact.metadata as Record<string, unknown>).sourceRefs, [`${runDirRef}/before.png`, `${runDirRef}/after.png`]);
    assert.deepEqual((artifact.metadata as Record<string, unknown>).contentRefs, [artifactRef]);
    const validation = JSON.parse(await readFile(join(workspace, `${artifactRef}.validation.json`), 'utf8')) as Record<string, unknown>;
    assert.deepEqual(validation.sourceRefs, [`${runDirRef}/before.png`, `${runDirRef}/after.png`]);
    assert.deepEqual(validation.contentRefs, [artifactRef]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge result materializer normalizes package diagnostic failure reasons', () => {
  const maxSteps = materializePackageBridgeResult({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'max-steps',
      reason: 'Stopped after max_steps=3 before completion.',
    },
    task: 'Click the visible button.',
    executedActions: [],
    visibleArtifacts: [],
    screenshotLedger: [],
  });
  assert.equal(maxSteps.failureReason, 'Stopped after maxSteps=3 before completion.');

  const highRisk = materializePackageBridgeResult({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'needs-confirmation',
      reason: 'high-risk confirmation is required',
    },
    task: 'Submit the form.',
    executedActions: [],
    visibleArtifacts: [],
    screenshotLedger: [],
  });
  assert.equal(highRisk.failureReason, 'High-risk Computer Use action blocked: high-risk confirmation is required');
});
