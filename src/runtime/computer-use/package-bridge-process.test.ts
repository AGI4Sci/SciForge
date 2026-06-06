import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  runComputerUsePackageProcess,
} from './package-bridge-process.js';

function matchingApprovalProvenance(approvalRef: string, actionKind: string, targetDescription: string) {
  return {
    schemaVersion: 'sciforge.computer-use.approval-provenance.v1',
    source: 'workspace-approval-sidecar',
    approvalRef,
    approvalRequestId: `${approvalRef}:request`,
    riskActionHash: `${approvalRef}:risk-action`,
    sourceApprovalRequestRef: '.sciforge/vision-runs/source-run/approval-request.json',
    sourceGuiAskUserRecordRef: '.sciforge/vision-runs/source-run/gui-ask-user.json',
    sourceRiskAuditRef: '.sciforge/vision-runs/source-run/risk-audit.json',
    approvalRequest: {
      approvalRef,
      riskActionHash: `${approvalRef}:risk-action`,
      action_kind: actionKind,
    },
    highRiskAction: {
      actionKind,
      targetDescription,
    },
  };
}

function weakInlineApprovalProvenance(approvalRef: string, actionKind: string, targetDescription: string) {
  return {
    schemaVersion: 'sciforge.computer-use.approval-provenance.v1',
    source: 'inline-unbacked-approval-provenance',
    approvalRef,
    approvalRequest: {
      approvalRef,
      riskActionHash: `${approvalRef}:risk-action`,
      action_kind: actionKind,
    },
    highRiskAction: {
      actionKind,
      targetDescription,
    },
  };
}

test('package bridge process runner uses TS host ports by default instead of spawning Python', async () => {
  const calls: string[] = [];
  const result = await runComputerUsePackageProcess({
    actionProviderRequest: { task: 'create report', maxSteps: 3 },
    callbacks: {},
    handleHostPortCall: async (call) => {
      calls.push(call.port);
      if (call.port === 'capture') {
        return {
          ref: call.kwargs?.query === 'after-action' ? 'run/step-001-after.png' : 'run/step-001-before.png',
          metadata: { screenshotRefs: [] },
        };
      }
      if (call.port === 'plan') {
        return {
          kind: 'click',
          target: { description: 'Export report' },
        };
      }
      if (call.port === 'locate') {
        return {
          ok: true,
          x: 12,
          y: 34,
          metadata: { groundingRef: 'run/step-001-grounding.json' },
        };
      }
      if (call.port === 'execute') {
        return {
          ok: true,
          message: 'clicked export',
          metadata: { exitCode: 0 },
        };
      }
      if (call.port === 'verify') {
        return {
          ok: true,
          done: true,
          reason: 'report is visible',
          changed: true,
          metadata: {
            finalArtifactRefs: ['run/final-report.md'],
          },
        };
      }
      throw new Error(`unexpected port: ${call.port}`);
    },
    processEnv: {
      SCIFORGE_COMPUTER_USE_PACKAGE_PYTHON: '/definitely/missing/python',
      SCIFORGE_VISION_SENSE_PYTHON: '/also/missing/python',
    },
  });

  assert.equal(result.schemaVersion, 'sciforge.computer-use.result.v1');
  assert.equal(result.status, 'completed');
  assert.equal(result.reason, 'report is visible');
  assert.deepEqual(calls, ['capture', 'plan', 'locate', 'execute', 'capture', 'verify']);
  assert.deepEqual(result.finalArtifactRefs, ['run/final-report.md']);
  assert.deepEqual((result.metrics as Record<string, unknown>).actionCount, 1);
});

test('package bridge process runner fails closed when the TS planner emits no action', async () => {
  const calls: string[] = [];
  const result = await runComputerUsePackageProcess({
    actionProviderRequest: { task: 'read screen', maxSteps: 2 },
    callbacks: {},
    handleHostPortCall: async (call) => {
      calls.push(call.port);
      if (call.port === 'capture') return { ref: 'screen.png' };
      if (call.port === 'plan') return { done: false, reason: 'no visible action is safe' };
      throw new Error(`unexpected port: ${call.port}`);
    },
  });

  assert.equal(result.schemaVersion, 'sciforge.computer-use.result.v1');
  assert.equal(result.status, 'failed-with-reason');
  assert.equal(result.reason, 'no visible action is safe');
  assert.deepEqual(calls, ['capture', 'plan']);
  assert.equal((result.failureDiagnostics as Record<string, unknown>).failedStage, 'plan');
});

test('package bridge process runner rejects planner-only done without execution evidence', async () => {
  const calls: string[] = [];
  const result = await runComputerUsePackageProcess({
    actionProviderRequest: { task: 'claim done', maxSteps: 1 },
    callbacks: {},
    handleHostPortCall: async (call) => {
      calls.push(call.port);
      if (call.port === 'capture') return { ref: 'screen.png' };
      if (call.port === 'plan') return { done: true, reason: 'all done' };
      throw new Error(`unexpected port: ${call.port}`);
    },
  });

  assert.equal(result.status, 'failed-with-reason');
  assert.match(String(result.reason), /without executing and verifying/);
  assert.deepEqual(calls, ['capture', 'plan']);
  assert.equal((result.failureDiagnostics as Record<string, unknown>).failedStage, 'plan');
});

test('package bridge process runner rejects contradictory verifier failure even when done is true', async () => {
  const result = await runComputerUsePackageProcess({
    actionProviderRequest: { task: 'verify contradiction', maxSteps: 1 },
    callbacks: {},
    handleHostPortCall: async (call) => {
      if (call.port === 'capture') return { ref: call.kwargs?.query === 'after-action' ? 'after.png' : 'before.png' };
      if (call.port === 'plan') return { kind: 'click', target: { description: 'visible button' } };
      if (call.port === 'locate') return { ok: true, x: 1, y: 2 };
      if (call.port === 'execute') return { ok: true };
      if (call.port === 'verify') return { ok: false, done: true, reason: 'contradictory verifier result' };
      throw new Error(`unexpected port: ${call.port}`);
    },
  });

  assert.equal(result.status, 'failed-with-reason');
  assert.equal(result.reason, 'contradictory verifier result');
  assert.equal((result.failureDiagnostics as Record<string, unknown>).failedStage, 'verify');
});

test('package bridge process runner rejects verifier-only done without explicit ok evidence', async () => {
  const result = await runComputerUsePackageProcess({
    actionProviderRequest: { task: 'verify missing ok', maxSteps: 1 },
    callbacks: {},
    handleHostPortCall: async (call) => {
      if (call.port === 'capture') return { ref: call.kwargs?.query === 'after-action' ? 'after.png' : 'before.png' };
      if (call.port === 'plan') return { kind: 'click', target: { description: 'visible button' } };
      if (call.port === 'locate') return { ok: true, x: 1, y: 2 };
      if (call.port === 'execute') return { ok: true };
      if (call.port === 'verify') {
        return {
          done: true,
          reason: 'verifier omitted ok',
          metadata: { finalArtifactRefs: ['run/unverified-report.md'] },
        };
      }
      throw new Error(`unexpected port: ${call.port}`);
    },
  });

  assert.equal(result.status, 'failed-with-reason');
  assert.match(String(result.reason), /requires explicit verifier ok=true/);
  assert.equal(result.finalArtifactRefs, undefined);
  assert.equal((result.failureDiagnostics as Record<string, unknown>).failedStage, 'verify');
});

test('package bridge process runner rejects artifact completion without final artifact evidence', async () => {
  const result = await runComputerUsePackageProcess({
    actionProviderRequest: { task: 'create a final report artifact', maxSteps: 1 },
    callbacks: {},
    handleHostPortCall: async (call) => {
      if (call.port === 'capture') return { ref: call.kwargs?.query === 'after-action' ? 'after.png' : 'before.png' };
      if (call.port === 'plan') return { kind: 'click', target: { description: 'export report' } };
      if (call.port === 'locate') return { ok: true, x: 1, y: 2 };
      if (call.port === 'execute') return { ok: true };
      if (call.port === 'verify') return { ok: true, done: true, reason: 'report is visible' };
      throw new Error(`unexpected port: ${call.port}`);
    },
  });

  assert.equal(result.status, 'failed-with-reason');
  assert.match(String(result.reason), /requires verified final artifact evidence/);
  assert.equal((result.failureDiagnostics as Record<string, unknown>).failedStage, 'verify');
});

test('package bridge process runner maps executor confirmation blocks to needs-confirmation', async () => {
  const result = await runComputerUsePackageProcess({
    actionProviderRequest: {
      task: 'submit payment',
      maxSteps: 1,
      riskPolicy: 'allow-confirmed',
      approvalRef: 'approval:submit-payment',
      metadata: {
        approvalProvenance: matchingApprovalProvenance('approval:submit-payment', 'click', 'Submit payment'),
      },
    },
    callbacks: {},
    handleHostPortCall: async (call) => {
      if (call.port === 'capture') {
        return { ref: call.kwargs?.query === 'after-action' ? 'after.png' : 'before.png' };
      }
      if (call.port === 'plan') {
        return {
          kind: 'click',
          target: { description: 'Submit payment' },
          riskLevel: 'high',
          requiresConfirmation: true,
        };
      }
      if (call.port === 'locate') return { ok: true, x: 1, y: 2 };
      if (call.port === 'execute') {
        return {
          ok: false,
          blocked: true,
          message: 'approval-required: high-risk Computer Use action stopped before executor event creation',
          metadata: {
            schedulerDecision: {
              status: 'needs-confirmation',
              reason: 'approval-required',
              schedulerDecisionRefs: {
                approvalRequestRef: 'approval-request:submit-payment',
                riskActionHash: 'risk-action:submit-payment',
              },
            },
          },
        };
      }
      if (call.port === 'verify') {
        return { ok: false, done: false, reason: 'executor blocked' };
      }
      throw new Error(`unexpected port: ${call.port}`);
    },
  });

  assert.equal(result.schemaVersion, 'sciforge.computer-use.result.v1');
  assert.equal(result.status, 'needs-confirmation');
  assert.match(String(result.reason), /approval-required/);
  const approvalRequest = result.approvalRequest as Record<string, any>;
  assert.equal(approvalRequest.approvalRequestId, 'approval-request:submit-payment');
  assert.equal(approvalRequest.metadata.riskActionHash, 'risk-action:submit-payment');
  assert.equal((result.failureDiagnostics as Record<string, unknown>).failedStage, 'execute');
});

test('package bridge process runner does not treat approvalRef alone as confirmed approval', async () => {
  const calls: string[] = [];
  const result = await runComputerUsePackageProcess({
    actionProviderRequest: {
      task: 'submit payment',
      maxSteps: 1,
      riskPolicy: 'allow-confirmed',
      approvalRef: 'approval:submit-payment',
    },
    callbacks: {},
    handleHostPortCall: async (call) => {
      calls.push(call.port);
      if (call.port === 'capture') return { ref: 'before.png' };
      if (call.port === 'plan') {
        return {
          kind: 'click',
          target: { description: 'Submit payment' },
          riskLevel: 'high',
          requiresConfirmation: true,
        };
      }
      throw new Error(`unexpected port: ${call.port}`);
    },
  });

  assert.equal(result.status, 'needs-confirmation');
  assert.deepEqual(calls, ['capture', 'plan']);
  assert.equal((result.failureDiagnostics as Record<string, unknown>).failedStage, 'approval-gate');
});

test('package bridge process runner infers confirmation for unannotated high-risk plan targets', async () => {
  const calls: string[] = [];
  const result = await runComputerUsePackageProcess({
    actionProviderRequest: {
      task: 'submit payment',
      maxSteps: 1,
    },
    callbacks: {},
    handleHostPortCall: async (call) => {
      calls.push(call.port);
      if (call.port === 'capture') return { ref: 'before.png' };
      if (call.port === 'plan') {
        return {
          kind: 'click',
          target: { description: 'Submit payment' },
        };
      }
      throw new Error(`unexpected port: ${call.port}`);
    },
  });

  assert.equal(result.status, 'needs-confirmation');
  assert.deepEqual(calls, ['capture', 'plan']);
  assert.equal((result.failureDiagnostics as Record<string, unknown>).failedStage, 'approval-gate');
});

test('package bridge process runner accepts snake_case confirmed approval with matching provenance', async () => {
  const calls: string[] = [];
  const approvalRef = 'approval:computer-use:process-snake-confirmed';
  const result = await runComputerUsePackageProcess({
    actionProviderRequest: {
      task: 'type guarded text',
      maxSteps: 1,
      risk_policy: 'allow-confirmed',
      approval_ref: approvalRef,
      metadata: {
        approvalProvenance: matchingApprovalProvenance(approvalRef, 'type_text', 'guarded editor field'),
      },
    },
    callbacks: {},
    handleHostPortCall: async (call) => {
      calls.push(call.port);
      if (call.port === 'capture') return { ref: call.kwargs?.query === 'after-action' ? 'after.png' : 'before.png' };
      if (call.port === 'plan') {
        return {
          kind: 'type_text',
          text: 'CONFIRMED',
          target: { description: 'guarded editor field' },
          riskLevel: 'high',
          requiresConfirmation: true,
        };
      }
      if (call.port === 'locate') return { ok: true, x: 1, y: 2 };
      if (call.port === 'execute') return { ok: true };
      if (call.port === 'verify') {
        return {
          ok: true,
          done: true,
          reason: 'guarded text visible',
          metadata: { finalArtifactRefs: ['run/guarded-text.md'] },
        };
      }
      throw new Error(`unexpected port: ${call.port}`);
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, ['capture', 'plan', 'locate', 'execute', 'capture', 'verify']);
});

test('package bridge process runner rejects weak inline approval provenance without source boundary refs', async () => {
  const calls: string[] = [];
  const approvalRef = 'approval:computer-use:process-weak-inline-confirmed';
  const result = await runComputerUsePackageProcess({
    actionProviderRequest: {
      task: 'submit payment',
      maxSteps: 1,
      riskPolicy: 'allow-confirmed',
      approvalRef,
      metadata: {
        approvalProvenance: weakInlineApprovalProvenance(approvalRef, 'click', 'Submit payment'),
      },
    },
    callbacks: {},
    handleHostPortCall: async (call) => {
      calls.push(call.port);
      if (call.port === 'capture') return { ref: 'before.png' };
      if (call.port === 'plan') {
        return {
          kind: 'click',
          target: { description: 'Submit payment' },
          riskLevel: 'high',
          requiresConfirmation: true,
        };
      }
      if (call.port === 'locate') return { ok: true, x: 1, y: 2 };
      if (call.port === 'execute') return { ok: true };
      if (call.port === 'verify') return { ok: true, done: true, reason: 'payment submitted' };
      throw new Error(`unexpected port: ${call.port}`);
    },
  });

  assert.equal(result.status, 'needs-confirmation');
  assert.deepEqual(calls, ['capture', 'plan']);
  assert.equal((result.failureDiagnostics as Record<string, unknown>).failedStage, 'approval-gate');
});

test('package bridge process runner blocks high-risk plans before grounding when request is unapproved', async () => {
  const calls: string[] = [];
  const result = await runComputerUsePackageProcess({
    actionProviderRequest: { task: 'submit payment', maxSteps: 1, riskPolicy: 'fail-closed' },
    callbacks: {},
    handleHostPortCall: async (call) => {
      calls.push(call.port);
      if (call.port === 'capture') return { ref: 'before.png' };
      if (call.port === 'plan') {
        return {
          kind: 'click',
          target: { description: 'Submit payment' },
          riskLevel: 'high',
          requiresConfirmation: true,
        };
      }
      throw new Error(`unexpected port: ${call.port}`);
    },
  });

  assert.equal(result.status, 'needs-confirmation');
  assert.deepEqual(calls, ['capture', 'plan']);
  assert.equal((result.approvalRequest as Record<string, unknown>).action_kind, 'click');
  assert.equal(((result.steps as Array<Record<string, unknown>>)[0]?.execution), null);
});

test('package bridge process runner records abort reason without launching an external process', async () => {
  const controller = new AbortController();
  controller.abort(new Error('test timeout before first action'));

  const result = await runComputerUsePackageProcess({
    actionProviderRequest: { task: 'abort me' },
    callbacks: { signal: controller.signal },
    handleHostPortCall: async () => ({ ok: true }),
  });

  assert.equal(result.status, 'failed-with-reason');
  assert.match(String(result.reason), /aborted by workspace runtime signal: test timeout before first action/);
  assert.equal((result.failureDiagnostics as Record<string, unknown>).failedStage, 'package-bridge-abort');
});
