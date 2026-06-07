import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { GatewayRequest, SkillAvailability } from '../runtime-types.js';
import { recordCapabilityEvolutionRuntimeEvent } from './capability-evolution-events.js';
import { GATEWAY_PROVIDER_RUNTIME_REGISTRY } from './provider-runtime-registry.js';

test('capability evolution runtime events use the gateway provider registry for workspace runtime refs', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-gateway-provider-registry-'));
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Generate a compact report.',
    workspacePath,
    artifacts: [],
  };
  const skill: SkillAvailability = {
    id: 'generated-task.generate.literature',
    kind: 'installed',
    available: true,
    reason: 'registry test',
    checkedAt: '2026-05-10T00:00:00.000Z',
    manifestPath: 'agentserver://generate-literature',
    manifest: {
      id: 'generated-task.generate.literature',
      kind: 'installed',
      description: 'registry test',
      skillDomains: ['literature'],
      inputContract: {},
      outputArtifactSchema: {},
      entrypoint: { type: 'agentserver-generation' },
      environment: {},
      validationSmoke: {},
      examplePrompts: [],
      promotionHistory: [],
    },
  };

  const result = await recordCapabilityEvolutionRuntimeEvent({
    workspacePath,
    request,
    skill,
    taskId: 'registry-event',
    failureReason: 'schema validation failed',
    outputRel: '.sciforge/task-results/registry-event.json',
    now: () => new Date('2026-05-10T00:00:00.000Z'),
  });

  const workspaceProvider = GATEWAY_PROVIDER_RUNTIME_REGISTRY.workspaceRuntime;
  assert.deepEqual(result.record.providers[0], {
    id: workspaceProvider.providerId,
    kind: workspaceProvider.providerKind,
  });
  assert.equal(
    result.record.selectedCapabilities.find((capability) => capability.role === 'validator')?.providerId,
    workspaceProvider.providerId,
  );
  assert.equal(
    result.record.fallbackPolicy?.atomicCapabilities.find((capability) => capability.id === 'sciforge.generated-task-runner')?.providerId,
    workspaceProvider.providerId,
  );
});
