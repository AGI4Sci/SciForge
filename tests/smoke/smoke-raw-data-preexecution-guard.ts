import assert from 'node:assert/strict';
import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { evaluateRawDataPreExecutionGuard } from '@sciforge-ui/runtime-contract/raw-data-execution-guard';
import { normalizeGatewayRequest } from '../../src/runtime/gateway/gateway-request.js';
import { runAgentServerGeneratedTask } from '../../src/runtime/gateway/generated-task-runner.js';
import { makeGeneratedTaskRunnerDeps, runtimeGatewaySkill } from './runtime-gateway-runner-fixtures.js';

const readyDossier = {
  id: 'n4-ready',
  type: 'raw-data-readiness-dossier',
  data: {
    schemaVersion: 'sciforge.scientific-reproduction.v1',
    artifactType: 'raw-data-readiness-dossier',
    sourceRefs: [{ ref: 'artifact:n4-source' }],
    claimIds: ['claim-n4'],
    rawExecutionStatus: 'ready',
    approvalStatus: 'approved',
    datasets: [{
      id: 'n4-dataset',
      accession: 'GSE242515',
      database: 'GEO',
      sourceRefs: [{ ref: 'artifact:n4-accession-check' }],
      dataLevel: 'raw',
      availability: 'available',
      licenseStatus: 'verified',
      estimatedDownloadBytes: 520_000,
      estimatedStorageBytes: 1_100_000,
      checksumRefs: [{ ref: 'artifact:n4-checksums' }],
    }],
    computeBudget: {
      maxDownloadBytes: 2_000_000,
      maxStorageBytes: 5_000_000,
      maxCpuHours: 1,
      maxMemoryGb: 2,
      maxWallHours: 1,
      budgetRef: { ref: 'artifact:n4-budget-approval' },
    },
    environment: {
      toolVersionRefs: [{ ref: 'artifact:n4-tool-lock' }],
      environmentLockRefs: [{ ref: 'artifact:n4-env-lock' }],
      genomeCacheRefs: [{ ref: 'artifact:n4-genome-cache' }],
    },
    readinessChecks: [{
      id: 'approval-license-budget-checksum-environment',
      status: 'pass',
      reason: 'Approval, license, budgets, checksums, and environment refs are ready.',
      evidenceRefs: [{ ref: 'artifact:n4-budget-approval' }],
    }],
    degradationStrategy: 'Stop before raw execution if any gate regresses.',
    rawExecutionGate: {
      allowed: true,
      reason: 'All raw-data readiness checks passed.',
      requiredBeforeExecution: ['approval', 'license', 'download-budget', 'storage-budget', 'checksum', 'environment'],
      refs: [{ ref: 'artifact:n4-budget-approval' }],
    },
  },
};

const rawTaskFile = {
  path: '.sciforge/tasks/raw-download.py',
  language: 'python',
  content: [
    'import json, sys, urllib.request',
    'urllib.request.urlretrieve("https://ftp.ncbi.nlm.nih.gov/geo/series/GSE242nnn/GSE242515/suppl/GSE242515_H3K4me3_RS4_WT_peaks.bed.gz", "raw-side-effect-marker.bed.gz")',
    'open(sys.argv[2], "w", encoding="utf-8").write(json.dumps({"message":"should not run","claims":[],"uiManifest":[],"executionUnits":[],"artifacts":[]}))',
  ].join('\n'),
};

const blocked = evaluateRawDataPreExecutionGuard({ taskFiles: [rawTaskFile] });
assert.equal(blocked.blocked, true);
assert.equal(blocked.rawIntentDetected, true);

for (const taskFile of [
  {
    path: '.sciforge/tasks/prefetch-sra.sh',
    language: 'bash',
    content: 'prefetch SRR000001 && fasterq-dump SRR000001 --outdir raw_fastq',
  },
  {
    path: '.sciforge/tasks/download-bam.sh',
    language: 'bash',
    content: 'wget https://example.invalid/sample.bam -O sample.bam',
  },
  {
    path: '.sciforge/tasks/download-fastq.py',
    language: 'python',
    content: 'import requests\nrequests.get("https://example.invalid/sample.fastq.gz")',
  },
]) {
  const result = evaluateRawDataPreExecutionGuard({ taskFiles: [taskFile] });
  assert.equal(result.blocked, true, `${taskFile.path} should be blocked before readiness`);
  assert.equal(result.rawIntentDetected, true, `${taskFile.path} should be detected as raw reanalysis intent`);
}

const ready = evaluateRawDataPreExecutionGuard({ taskFiles: [rawTaskFile], artifacts: [readyDossier] });
assert.equal(ready.blocked, false);
assert.equal(ready.rawIntentDetected, true);
assert.equal(ready.scopeBound, true);
assert.ok(ready.taskScopeSignals.includes('gse242515'));
assert.ok(ready.approvedScopeSignals.includes('gse242515'));
assert.ok(ready.readinessRefs.includes('artifact:n4-budget-approval'));

const mismatchedScope = evaluateRawDataPreExecutionGuard({
  taskFiles: [{
    path: '.sciforge/tasks/mismatched-sra.sh',
    language: 'bash',
    content: 'prefetch SRR000001 && fasterq-dump SRR000001 --outdir raw_fastq',
  }],
  artifacts: [readyDossier],
});
assert.equal(mismatchedScope.blocked, true);
assert.equal(mismatchedScope.rawIntentDetected, true);
assert.equal(mismatchedScope.scopeBound, false);
assert.match(mismatchedScope.reason ?? '', /not bound to the approved/);
assert.ok(mismatchedScope.readyDossierRefs.includes('artifact:n4-budget-approval'));
assert.ok(mismatchedScope.taskScopeSignals.includes('srr000001'));
assert.ok(!mismatchedScope.approvedScopeSignals.includes('srr000001'));

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-raw-preexec-'));
const request = normalizeGatewayRequest({
  skillDomain: 'literature',
  prompt: 'Run a generated raw-data download task without readiness.',
  workspacePath: workspace,
  agentServerBaseUrl: 'http://agentserver.local',
  artifacts: [],
});
const skill = runtimeGatewaySkill();
const payload = await runAgentServerGeneratedTask(request, skill, [skill], {}, makeGeneratedTaskRunnerDeps({
  request,
  requestAgentServerGeneration: async () => ({
    ok: true,
    runId: 'raw-guard-run',
    response: {
      taskFiles: [rawTaskFile],
      entrypoint: { language: 'python', path: rawTaskFile.path },
      environmentRequirements: {},
      validationCommand: '',
      expectedArtifacts: ['raw-data-readiness-dossier'],
    },
  }),
}));

assert.equal(payload?.executionUnits[0]?.status, 'repair-needed');
assert.match(payload?.message ?? '', /Raw-data execution was detected/);
await assert.rejects(access(join(workspace, 'raw-side-effect-marker.bed.gz')));

console.log('[ok] raw-data pre-execution guard blocks generated raw downloads until a ready dossier is attached');
