import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { runSelectedRuntimeVerifiers } from '../../src/runtime/gateway/runtime-verifier-registry.js';
import { applyRuntimeVerificationPolicy } from '../../src/runtime/gateway/verification-policy.js';
import type { GatewayRequest, ToolPayload, VerificationPolicy } from '../../src/runtime/runtime-types.js';

const verifierId = 'verifier.scientific-reproduction';
const verificationPolicy: VerificationPolicy = {
  required: true,
  mode: 'automatic',
  riskLevel: 'medium',
  reason: 'Scientific reproduction claims require verifier feedback.',
  selectedVerifierIds: [verifierId],
  humanApprovalPolicy: 'optional',
};

const incompletePayload: ToolPayload = {
  message: 'Draft paper reproduction result.',
  confidence: 0.8,
  claimType: 'scientific-reproduction',
  evidenceLevel: 'runtime',
  reasoningTrace: 'Smoke test payload.',
  claims: [],
  uiManifest: [],
  executionUnits: [{
    id: 'unit-1',
    status: 'done',
    tool: 'local-runtime',
    codeRef: '.sciforge/tasks/unit-1.ts',
    stdoutRef: '.sciforge/logs/unit-1.stdout.log',
    stderrRef: '.sciforge/logs/unit-1.stderr.log',
    outputRef: '.sciforge/task-results/unit-1.json',
  }],
  artifacts: [{
    id: 'claim-graph-1',
    type: 'paper-claim-graph',
    dataRef: '.sciforge/artifacts/claim-graph-1.json',
    data: {
      claims: [{
        id: 'claim-1',
        text: 'A checkable scientific claim without evidence refs.',
        verdict: 'reproduced',
      }],
    },
  }],
};

const request: GatewayRequest = {
  skillDomain: 'literature',
  prompt: 'Verify this scientific reproduction output.',
  workspacePath: '',
  artifacts: [],
  selectedVerifierIds: [verifierId],
  verificationPolicy,
};

const directResults = await runSelectedRuntimeVerifiers({
  payload: incompletePayload,
  request,
  policy: verificationPolicy,
});
assert.equal(directResults.length, 1);
assert.equal(directResults[0]?.id, 'verifier.scientific-reproduction.generic');
assert.equal(directResults[0]?.verdict, 'fail');
assert.ok(directResults[0]?.repairHints.some((hint) => hint.includes('evidenceRefs')));

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-verifier-pipeline-'));
try {
  const gated = await applyRuntimeVerificationPolicy(incompletePayload, {
    ...request,
    workspacePath: workspace,
  });
  assert.equal(gated.verificationResults?.[0]?.verdict, 'fail');
  assert.equal(gated.executionUnits[0]?.status, 'failed-with-reason');
  assert.ok(gated.budgetDebits?.some((debit) => debit.capabilityId === 'sciforge.runtime-verification-gate'));
  const refs = (gated as ToolPayload & { refs?: Record<string, unknown> }).refs;
  assert.ok(refs?.validationRepairAudit, 'failed verifier should attach validation/repair/audit refs');
  const audit = refs.validationRepairAudit as {
    validationDecision?: { status?: string; findings?: Array<{ kind?: string }> };
    repairDecision?: { action?: string };
    auditRecord?: { outcome?: string };
  };
  assert.equal(audit.validationDecision?.status, 'failed');
  assert.ok(audit.validationDecision?.findings?.some((finding) => finding.kind === 'runtime-verification'));
  assert.equal(audit.repairDecision?.action, 'repair-rerun');
  assert.equal(audit.auditRecord?.outcome, 'repair-requested');
  const verificationRef = gated.verificationResults?.[0]?.id
    ? `.sciforge/verifications/${gated.verificationResults[0].id}.json`
    : undefined;
  assert.ok(verificationRef);
  const persisted = JSON.parse(await readFile(join(workspace, verificationRef), 'utf8')) as { result?: { verdict?: string } };
  assert.equal(persisted.result?.verdict, 'fail');
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log('[ok] scientific reproduction verifier is wired into runtime verification and validation/repair/audit pipeline.');
