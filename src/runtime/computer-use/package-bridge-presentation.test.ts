import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import type { ToolPayload, WorkspaceRuntimeEvent } from '../runtime-types.js';
import {
  attachPackageResultHostActions,
  packageBridgePresentationRefs,
} from './package-bridge-presentation.js';

function payload(): ToolPayload {
  return {
    message: 'Package bridge finished.',
    claimType: 'computer-use',
    evidenceLevel: 'runtime-trace',
    reasoningTrace: 'refs-first',
    claims: [],
    uiManifest: [],
    executionUnits: [{
      id: 'execution:computer-use-package',
      status: 'done',
      traceRef: '.sciforge/vision-runs/run-1/vision-trace.json',
    }],
    artifacts: [{
      id: 'artifact:report',
      ref: '.sciforge/vision-runs/run-1/report.md',
    }],
  };
}

test('package bridge presentation refs preserve completed run refs without repair sidecars', () => {
  const refs = packageBridgePresentationRefs('/workspace', {
    runDir: join('/workspace', '.sciforge/vision-runs/run-completed'),
  }, {
    status: 'completed',
  });

  assert.equal(refs.tuiHostRunTaskChainRef, '.sciforge/vision-runs/run-completed/tui-host-run-task-chain.json');
  assert.equal(refs.directoryListingRef, '.sciforge/vision-runs/run-completed/directory-listing.json');
  assert.equal(refs.blockedManifestRef, undefined);
  assert.equal(refs.repairHintRef, undefined);
  assert.equal(refs.continuationRequestRef, undefined);
});

test('package bridge presentation refs include blocked repair and continuation refs', () => {
  const refs = packageBridgePresentationRefs('/workspace', {
    runDir: join('/workspace', '.sciforge/vision-runs/run-blocked'),
  }, {
    status: 'needs-confirmation',
  });

  assert.equal(refs.tuiHostRunTaskChainRef, '.sciforge/vision-runs/run-blocked/tui-host-run-task-chain.json');
  assert.equal(refs.directoryListingRef, '.sciforge/vision-runs/run-blocked/directory-listing.json');
  assert.equal(refs.blockedManifestRef, '.sciforge/vision-runs/run-blocked/blocked-manifest.json');
  assert.equal(refs.repairHintRef, '.sciforge/vision-runs/run-blocked/repair-hint.json');
  assert.equal(refs.continuationRequestRef, '.sciforge/vision-runs/run-blocked/continuation-request.json');
});

test('attachPackageResultHostActions writes payload object references, logs, and runtime event', () => {
  const toolPayload = payload();
  toolPayload.message = 'Package bridge finished with sk-package-secret and /Users/alice/private.txt';
  const events: WorkspaceRuntimeEvent[] = [];
  const actions = attachPackageResultHostActions(toolPayload, {
    schemaVersion: 'sciforge.computer-use.result.v1',
    status: 'needs-confirmation',
    traceRefs: ['.sciforge/vision-runs/run-1/vision-trace.json'],
    approvalRequest: {
      id: 'approval-request:run-1',
      approvalRef: 'approval:computer-use:run-1',
      prompt: 'Allow Computer Use to click Submit with Bearer token?',
      confirmationText: 'Click Submit for /Users/alice/private.txt',
      rawProviderPayload: { token: 'Bearer rawProviderPayload-secret' },
      rawVisibleText: 'Raw visible text must remain in refs.',
      actionKind: 'click',
      riskLevel: 'high',
      actionRef: 'ref:planned-action:submit',
      evidenceRefs: ['evidence:computer-use:run-1'],
    },
  }, {
    onEvent: (event) => events.push(event),
  }, {
    workspace: '/workspace',
    state: { runDir: join('/workspace', '.sciforge/vision-runs/run-1') },
    toolName: 'local.vision-sense',
  });

  assert.equal(actions.length, 2);
  assert.equal(actions[0]?.port, 'gui.present');
  assert.equal(actions[1]?.port, 'gui.ask_user');

  const hostActionsRef = toolPayload.objectReferences?.find((ref) => ref.id === 'ref:computer-use-tui-host-actions');
  assert.ok(hostActionsRef);
  assert.equal(hostActionsRef.type, 'computer-use-tui-host-actions');
  assert.deepEqual((hostActionsRef.data as Record<string, unknown>).actions, actions);

  const auditLog = toolPayload.logs?.find((log) => log.kind === 'computer-use-tui-host-actions');
  assert.ok(auditLog);
  assert.deepEqual(auditLog.actions, actions);

  const presentPayload = actions[0]?.payload;
  assert.deepEqual(presentPayload.blockedManifestRefs, ['.sciforge/vision-runs/run-1/blocked-manifest.json']);
  assert.deepEqual(presentPayload.repairHintRefs, ['.sciforge/vision-runs/run-1/repair-hint.json']);
  assert.deepEqual(presentPayload.continuationRequestRefs, ['.sciforge/vision-runs/run-1/continuation-request.json']);
  assert.deepEqual(presentPayload.directoryListingRefs, ['.sciforge/vision-runs/run-1/directory-listing.json']);
  assert.deepEqual(presentPayload.runTaskChainRefs, ['.sciforge/vision-runs/run-1/tui-host-run-task-chain.json']);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'computer-use.tui-host-actions');
  assert.equal(events[0]?.source, 'computer-use-package-bridge');
  assert.equal(events[0]?.toolName, 'local.vision-sense');
  assert.match(String(events[0]?.detail), /gui\.present/);
  assert.match(String(events[0]?.detail), /gui\.ask_user/);

  const unsafePattern = /sk-package-secret|Bearer|rawProviderPayload|rawVisibleText|\/Users\/alice|confirmationText|click Submit/i;
  assert.doesNotMatch(JSON.stringify(hostActionsRef.data), unsafePattern);
  assert.doesNotMatch(JSON.stringify(auditLog), unsafePattern);
  assert.doesNotMatch(String(events[0]?.detail), unsafePattern);
});
