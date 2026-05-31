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
} from './host-adapter-contract.js';
import {
  computerUseHostPortLists,
  computerUseHostPortProviderIds,
} from './provider-policy.js';

test('ComputerUseHostAdapter contract is reusable and GUI-free at the package boundary', () => {
  const contract = createComputerUseHostPortsContract({
    owner: 'codex-cli-plugin-test-host',
    ports: {
      capture: { provider: computerUseHostPortProviderIds.displayCapture },
      plan: { provider: computerUseHostPortProviderIds.runtimeCodexTuiTextPlanner },
      locate: { provider: computerUseHostPortProviderIds.focusRegionCrop },
      execute: { provider: 'test-window-scoped-executor' },
      verify: { provider: computerUseHostPortProviderIds.layeredVerifier },
    },
  });

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
      plan: { provider: computerUseHostPortProviderIds.runtimeCodexTuiTextPlanner },
      locate: { provider: computerUseHostPortProviderIds.focusRegionCrop },
      execute: { provider: 'test-window-scoped-executor' },
      verify: { provider: computerUseHostPortProviderIds.layeredVerifier },
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
      plan: { provider: computerUseHostPortProviderIds.runtimeCodexTuiTextPlanner },
      locate: { provider: computerUseHostPortProviderIds.focusRegionCrop },
      execute: { provider: 'test-window-scoped-executor' },
      verify: { provider: computerUseHostPortProviderIds.layeredVerifier },
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

  assert.deepEqual(importTargets, ['./provider-policy.js']);
  assert.doesNotMatch(source, /from\s+['"][^'"]*(?:src\/ui|src\/runtime|gui-module|gui-mcp)[^'"]*['"]/);
});
