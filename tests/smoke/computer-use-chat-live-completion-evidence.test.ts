import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  collectComputerUseChatLivePackageBridgeCompletionGradeEvidence,
} from '../../tools/computer-use-chat-live-completion-evidence.js';

test('Computer Use chat live completion evidence only attaches current-run completion refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-completion-evidence-'));
  try {
    const currentRunDir = '.sciforge/vision-runs/current-run';
    const staleRunDir = '.sciforge/vision-runs/previous-run';
    const traceRef = `${currentRunDir}/vision-trace.json`;
    const runTaskChainRef = `${currentRunDir}/tui-host-run-task-chain.json`;
    const directoryListingRef = `${currentRunDir}/directory-listing.json`;
    const staleDiagnosticRef = `${staleRunDir}/completion-grade-diagnostics.json`;
    const staleManifestRef = `${staleRunDir}/cu-user-acceptance-manifest.json`;
    const staleEvidenceRef = `${staleRunDir}/isolated-desktop-l3-workflow-evidence.json`;

    await writeJson(join(workspace, traceRef), {
      schemaVersion: 'sciforge.computer-use.package-bridge-trace.v1',
      status: 'done',
    });
    await writeJson(join(workspace, runTaskChainRef), {
      schemaVersion: 'sciforge.computer-use.tui-host-run-task-chain.v1',
      refs: {
        traceRef,
        directoryListingRef,
      },
    });
    await writeJson(join(workspace, directoryListingRef), {
      schemaVersion: 'sciforge.computer-use.directory-listing.v1',
      fileRefs: [
        traceRef,
        runTaskChainRef,
        staleDiagnosticRef,
        staleManifestRef,
        staleEvidenceRef,
      ],
    });
    await writeJson(join(workspace, staleDiagnosticRef), {
      schemaVersion: 'sciforge.computer-use.completion-grade-diagnostic.v1',
      status: 'blocked',
      reason: 'stale prior run diagnostic must not gate this run',
    });
    await writeJson(join(workspace, staleManifestRef), {
      schemaVersion: 'sciforge.computer-use.user-acceptance-manifest.v1',
      level: 'L3',
    });
    await writeJson(join(workspace, staleEvidenceRef), {
      schemaVersion: 'sciforge.computer-use.isolated-desktop-l3-workflow-evidence.v1',
    });

    const grade = await collectComputerUseChatLivePackageBridgeCompletionGradeEvidence({
      workspacePath: workspace,
      refs: [traceRef, runTaskChainRef],
    });

    assert.equal(grade.status, 'missing');
    assert.deepEqual(grade.diagnosticRefs, []);
    assert.deepEqual(grade.acceptanceManifestRefs, []);
    assert.deepEqual(grade.completionEvidenceRefs, []);
    assert.ok(grade.issues.some((issue) => issue.includes('ignored non-current-run completion evidence ref')));
    assert.doesNotMatch(JSON.stringify(grade), /previous-run\/cu-user-acceptance-manifest\.json".*"acceptanceManifestRefs/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live completion evidence scopes bundle-local canonical refs to anchored current-run bundle', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-completion-bundle-local-'));
  try {
    const runDir = '.sciforge/vision-runs/current-run';
    const traceRef = `${runDir}/vision-trace.json`;
    const runTaskChainRef = `${runDir}/tui-host-run-task-chain.json`;
    const directoryListingRef = `${runDir}/directory-listing.json`;
    const acceptanceManifestRef = `${runDir}/cu-user-acceptance-manifest.json`;
    const completionEvidenceBundleRef = `${runDir}/isolated-desktop-l3-workflow-evidence.json`;

    await writeJson(join(workspace, traceRef), {
      schemaVersion: 'sciforge.computer-use.package-bridge-trace.v1',
      status: 'done',
    });
    await writeJson(join(workspace, runTaskChainRef), {
      schemaVersion: 'sciforge.computer-use.tui-host-run-task-chain.v1',
      refs: {
        traceRef,
        directoryListingRef,
      },
      completionGrade: {
        status: 'attached',
        acceptanceManifestRef,
        completionEvidenceRef: 'isolated-desktop-l3-workflow-evidence.json',
        completionEvidenceBundleRef,
      },
    });
    await writeJson(join(workspace, directoryListingRef), {
      schemaVersion: 'sciforge.computer-use.directory-listing.v1',
      fileRefs: [
        traceRef,
        runTaskChainRef,
        acceptanceManifestRef,
        completionEvidenceBundleRef,
      ],
    });
    await writeJson(join(workspace, acceptanceManifestRef), {
      schemaVersion: 'sciforge.computer-use.user-acceptance-manifest.v1',
      level: 'L3',
      completionEvidenceRef: 'isolated-desktop-l3-workflow-evidence.json',
    });
    await writeJson(join(workspace, completionEvidenceBundleRef), {
      schemaVersion: 'sciforge.computer-use.isolated-desktop-l3-workflow-evidence.v1',
    });

    const grade = await collectComputerUseChatLivePackageBridgeCompletionGradeEvidence({
      workspacePath: workspace,
      refs: [traceRef, runTaskChainRef],
    });

    assert.equal(grade.status, 'attached');
    assert.deepEqual(grade.acceptanceManifestRefs, [acceptanceManifestRef]);
    assert.deepEqual(grade.completionEvidenceRefs, [completionEvidenceBundleRef]);
    assert.equal(grade.issues.some((issue) => issue.includes('ignored non-current-run completion evidence ref')), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live completion evidence redacts producer process diagnostics', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-completion-redaction-'));
  try {
    const runDir = '.sciforge/vision-runs/current-run';
    const traceRef = `${runDir}/vision-trace.json`;
    const runTaskChainRef = `${runDir}/tui-host-run-task-chain.json`;
    const directoryListingRef = `${runDir}/directory-listing.json`;
    const producerDiagnosticRef = `${runDir}/embedded-l3-completion-producer-diagnostics.json`;

    await writeJson(join(workspace, traceRef), {
      schemaVersion: 'sciforge.computer-use.package-bridge-trace.v1',
      status: 'done',
    });
    await writeJson(join(workspace, runTaskChainRef), {
      schemaVersion: 'sciforge.computer-use.tui-host-run-task-chain.v1',
      refs: {
        traceRef,
        directoryListingRef,
      },
    });
    await writeJson(join(workspace, directoryListingRef), {
      schemaVersion: 'sciforge.computer-use.directory-listing.v1',
      fileRefs: [traceRef, runTaskChainRef, producerDiagnosticRef],
    });
    await writeJson(join(workspace, producerDiagnosticRef), {
      schemaVersion: 'sciforge.computer-use.embedded-l3-completion-producer-diagnostic.v1',
      status: 'blocked',
      reason: 'producer exited after provider_url=https://provider.example/v1 token=producer-token',
      process: {
        command: 'python',
        args: [
          '-m',
          'sciforge_l3',
          '--provider-url=https://provider.example/v1',
          '--api-key',
          'sk-secret',
          '--model=secret-model',
          '--token',
          'producer-token',
        ],
        code: 1,
        stdout: 'stdout Authorization: Bearer producer-auth-token',
        stderr: 'stderr api_key=sk-secret model=secret-model',
      },
    });

    const grade = await collectComputerUseChatLivePackageBridgeCompletionGradeEvidence({
      workspacePath: workspace,
      refs: [traceRef, runTaskChainRef],
    });

    const serialized = JSON.stringify(grade);
    assert.equal(grade.producerDiagnosticRefs[0], producerDiagnosticRef);
    assert.match(serialized, /\[redacted-url\]|\[redacted-secret\]|Bearer \[redacted\]/);
    assert.doesNotMatch(serialized, /provider\.example|producer-token|producer-auth-token|sk-secret|secret-model/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

async function writeJson(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
}
