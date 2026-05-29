import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ComputerUseActionProviderRequest } from './host-adapter.js';
import { normalizePackageBridgeApprovalRequest } from './package-bridge-approval.js';

function requestWithApproval(approvalRef?: string): ComputerUseActionProviderRequest {
  return {
    schemaVersion: 'sciforge.computer-use.request.v1',
    task: 'click the submit button',
    maxSteps: 3,
    riskPolicy: approvalRef ? 'allow-confirmed' : 'fail-closed',
    approvalRef,
    providers: {
      action: 'action.sciforge.computer-use',
      executor: 'test-executor',
    },
    windowTarget: {
      enabled: false,
      required: false,
      mode: 'display',
      coordinateSpace: 'screen',
      inputIsolation: 'best-effort',
      windowId: undefined,
      processId: undefined,
      bundleId: undefined,
      appName: undefined,
      title: undefined,
      displayId: undefined,
      bounds: undefined,
      contentRect: undefined,
      devicePixelRatio: undefined,
      focused: undefined,
      minimized: undefined,
      occluded: undefined,
    },
    metadata: {
      workspace: '/tmp/sciforge-workspace',
      existing: true,
    },
  };
}

test('package bridge approval gate ignores vision-sense dry-run smoke approval ref', () => {
  const request = requestWithApproval('approval:vision-sense-dry-run-smoke');

  const normalized = normalizePackageBridgeApprovalRequest(request);

  assert.equal(normalized.riskPolicy, 'fail-closed');
  assert.equal(normalized.approvalRef, undefined);
  assert.equal(normalized.metadata.existing, true);
  assert.equal(normalized.metadata.ignoredApprovalRef, 'approval:vision-sense-dry-run-smoke');
  assert.match(String(normalized.metadata.ignoredApprovalReason), /does not authorize high-risk Computer Use actions/);
});

test('package bridge approval gate preserves ordinary approval refs', () => {
  const request = requestWithApproval('approval:computer-use:confirmed');

  assert.equal(normalizePackageBridgeApprovalRequest(request), request);
});
