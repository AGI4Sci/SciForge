import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computerUseActionProviderContractIds,
  computerUseHostAdapterForbiddenPorts,
  computerUseHostPortsContractViolations,
  computerUsePackageStdioHostPortNames,
  createComputerUseHostAdapter,
  createComputerUseHostPortsContract,
  isComputerUseForbiddenHostPortName,
  projectComputerUseHostOutputToWindowActionEvidenceRefs,
} from './host-adapter-contract.js';
import {
  computerUseHostPortLists,
  computerUseHostPortProviderIds,
  computerUseModelRouterCapabilityIds,
} from './provider-policy.js';

test('Computer Use host output projects to WindowActionEvidenceRef-style refs', () => {
  const projection = projectComputerUseHostOutputToWindowActionEvidenceRefs({
    currentObservation: {
      observationRef: 'observation:run-1/current.json',
      screenshotRef: 'image:run-1/current.png',
    },
    target: {
      targetRef: 'target:annotation/manual-bound-1',
      windowRef: 'window:macos/TextEdit/123',
      screenRef: 'screen:main',
    },
    session: {
      sessionRef: 'computer-use:session/run-1',
      windowActionSessionRef: 'window-action-session:agent-a/run-1',
      scopedInputAdapterRef: 'scoped-input-adapter:agent-a/window-123',
    },
    executorEvent: {
      executorEventRef: 'executor-event:run-1/step-001.json',
      actionRef: 'window-action:run-1/step-001',
    },
    beforeEvidenceRefs: ['image:run-1/before.png', 'observation:run-1/current.json'],
    afterEvidenceRefs: ['image:run-1/after.png'],
    verificationRefs: ['verification:run-1/step-001.json'],
    artifactRefs: ['artifact:run-1/output.md'],
    traceRefs: ['trace:run-1/vision-trace.json'],
    sideEffectFlags: {
      inputExecuted: true,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      rawPayloadWritten: false,
      inlineImageWritten: false,
    },
  });

  assert.deepEqual(projection, {
    schemaVersion: 'sciforge.computer-use.window-action-evidence-projection.v1',
    currentObservationRef: 'observation:run-1/current.json',
    currentObservationEvidenceRefs: ['observation:run-1/current.json', 'image:run-1/current.png'],
    targetRefs: {
      targetRef: 'target:annotation/manual-bound-1',
      windowRef: 'window:macos/TextEdit/123',
      screenRef: 'screen:main',
    },
    sessionRefs: {
      sessionRef: 'computer-use:session/run-1',
      windowActionSessionRef: 'window-action-session:agent-a/run-1',
      scopedInputAdapterRef: 'scoped-input-adapter:agent-a/window-123',
    },
    executorEventRef: 'executor-event:run-1/step-001.json',
    actionRef: 'window-action:run-1/step-001',
    beforeEvidenceRefs: ['image:run-1/before.png', 'observation:run-1/current.json'],
    afterEvidenceRefs: ['image:run-1/after.png'],
    verificationRefs: ['verification:run-1/step-001.json'],
    artifactRefs: ['artifact:run-1/output.md'],
    traceRefs: ['trace:run-1/vision-trace.json'],
    sideEffectFlags: {
      inputExecuted: true,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      rawPayloadWritten: false,
      inlineImageWritten: false,
    },
    allEvidenceRefs: [
      'observation:run-1/current.json',
      'image:run-1/current.png',
      'image:run-1/before.png',
      'image:run-1/after.png',
      'verification:run-1/step-001.json',
      'artifact:run-1/output.md',
      'trace:run-1/vision-trace.json',
      'executor-event:run-1/step-001.json',
    ],
  });
});

test('ComputerUseHostAdapter contract is reusable and GUI-free at the package boundary', () => {
  const contract = createComputerUseHostPortsContract({
    owner: 'codex-cli-plugin-test-host',
    ports: {
      capture: { provider: computerUseHostPortProviderIds.displayCapture },
      plan: { provider: computerUseModelRouterCapabilityIds.computerUsePlanner },
      locate: { provider: computerUseHostPortProviderIds.focusRegionCrop },
      execute: { provider: 'test-window-scoped-executor' },
      verify: { provider: computerUseModelRouterCapabilityIds.verifierTranslator },
    },
  });

  assert.equal(computerUseActionProviderContractIds.requestSchema, 'sciforge.computer-use.request.v1');
  assert.equal(computerUseActionProviderContractIds.resultSchema, 'sciforge.computer-use.result.v1');
  assert.equal(contract.hostAdapterSchemaVersion, computerUseActionProviderContractIds.hostAdapterSchema);
  assert.equal(contract.actionProvider, computerUseActionProviderContractIds.actionProviderId);
  assert.deepEqual(contract.requiredPorts, computerUseHostPortLists.required);
  assert.deepEqual(contract.optionalPorts, computerUseHostPortLists.optional);
  assert.deepEqual(contract.forbiddenPorts, ['requestApproval', 'gui.present', 'gui.ask_user']);
  assert.equal(contract.ports.query.optional, true);
  assert.equal(contract.ports.crop.optional, true);
  assert.deepEqual(contract.adapterBoundary.reusableBy, ['codex-cli-plugin', 'sciforge-runtime']);
  assert.deepEqual(contract.adapterBoundary.hostInjects, [
    'workspace-context',
    'session-context',
    'callbacks',
    'presentation-events',
  ]);
  assert.deepEqual(contract.adapterBoundary.packageForbiddenImports, ['src/ui/**', 'runtime-gui/**']);

  const adapter = createComputerUseHostAdapter({
    hostPorts: contract,
    dispatchHostPort: (call) => ({ id: call.id, port: call.port }),
  });
  assert.equal(adapter.schemaVersion, computerUseActionProviderContractIds.hostAdapterSchema);
  assert.equal(adapter.hostPorts, contract);
});

test('ComputerUseHostAdapter contract fail-closes forbidden GUI and approval host ports', () => {
  const contract = createComputerUseHostPortsContract({
    owner: 'sciforge-runtime-test-host',
    ports: {
      capture: { provider: computerUseHostPortProviderIds.displayCapture },
      plan: { provider: computerUseModelRouterCapabilityIds.computerUsePlanner },
      locate: { provider: computerUseHostPortProviderIds.focusRegionCrop },
      execute: { provider: 'test-window-scoped-executor' },
      verify: { provider: computerUseModelRouterCapabilityIds.verifierTranslator },
    },
  });

  for (const forbidden of computerUseHostAdapterForbiddenPorts) {
    assert.equal(isComputerUseForbiddenHostPortName(forbidden), true);
    assert.equal(Object.hasOwn(contract.ports, forbidden), false);
  }
  assert.deepEqual(computerUseHostPortsContractViolations(contract), []);

  assert.deepEqual(
    computerUseHostPortsContractViolations({
      ...contract,
      ports: {
        ...contract.ports,
        requestApproval: { provider: 'bad-direct-approval-port' },
      },
    }),
    [
      'forbidden host port declared: requestApproval',
      'approval boundary leaks forbidden host port: requestApproval',
    ],
  );
});

test('high-risk policy only crosses the package boundary as approval refs and sidecars', () => {
  const contract = createComputerUseHostPortsContract({
    owner: 'codex-cli-plugin-test-host',
    ports: {
      capture: { provider: computerUseHostPortProviderIds.displayCapture },
      plan: { provider: computerUseModelRouterCapabilityIds.computerUsePlanner },
      locate: { provider: computerUseHostPortProviderIds.focusRegionCrop },
      execute: { provider: 'test-window-scoped-executor' },
      verify: { provider: computerUseModelRouterCapabilityIds.verifierTranslator },
    },
  });

  assert.equal(contract.approvalBoundary.policy, 'refs-first-approval-sidecars-only');
  assert.deepEqual(contract.approvalBoundary.forbiddenHostPorts, ['requestApproval', 'gui.present', 'gui.ask_user']);
  assert.deepEqual(contract.approvalBoundary.packageMayReturn, [
    'needs-confirmation',
    'approvalRequestRef',
    'draftRef',
    'auditRef',
    'riskAuditRef',
    'approvalRequestSidecarRef',
  ]);
  assert.deepEqual(contract.approvalBoundary.hostContinuationRequires, [
    'approvalRef',
    'approvalSidecarRefs',
    'riskActionHash',
  ]);
});

test('stdio bridge callable port list comes from the shared package contract', () => {
  assert.deepEqual(computerUsePackageStdioHostPortNames, [
    'capture',
    'plan',
    'locate',
    'execute',
    'verify',
    'writeTrace',
    'emitEvent',
  ]);
});

test('package host adapter contract does not import runtime or GUI implementations', async () => {
  const source = await readFile(new URL('./host-adapter-contract.ts', import.meta.url), 'utf8');
  const importTargets = Array.from(source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g), (match) => match[1]);

  assert.deepEqual(importTargets, ['./action-schema.js', './provider-policy.js']);
  assert.doesNotMatch(source, /from\s+['"][^'"]*(?:src\/ui|src\/runtime|gui-module|gui-mcp)[^'"]*['"]/);
});
