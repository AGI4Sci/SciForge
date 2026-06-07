import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { completeBackendGenerationFailureRepairPayload } from './generated-task-runner-generation-failure.js';

const request: GatewayRequest = {
  skillDomain: 'literature',
  prompt: 'Summarize recent agent computer use papers.',
  artifacts: [],
  uiState: { sessionId: 'generation-failure-helper' },
};

const skill = {
  id: 'literature-agentserver-generation',
  kind: 'package',
  available: true,
  reason: 'test',
  checkedAt: '2026-05-16T00:00:00.000Z',
  manifestPath: '/tmp/skill.json',
  manifest: {
    id: 'literature-agentserver-generation',
    kind: 'skill',
    label: 'Literature',
    description: 'test',
    entrypoint: { type: 'agentserver-generation' },
  },
} as unknown as SkillAvailability;

test('generation failure helper preserves side-effect candidates when repair is safer than provider recovery', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generation-failure-helper-'));
  const payload = await completeBackendGenerationFailureRepairPayload({
    workspace,
    request,
    skill,
    generation: {
      ok: false,
      error: 'AgentServer process exited after writing partial artifacts',
      diagnostics: {
        kind: 'agentserver',
        sideEffectWorkEvidence: [{
          kind: 'write',
          status: 'success',
          input: { path: join(workspace, 'partial_report.md') },
          evidenceRefs: [join(workspace, 'partial_report.md')],
          outputSummary: 'partial report',
          recoverActions: [],
        }],
      },
    },
    deps: {
      attemptPlanRefs: () => ({}),
      backendGenerationFailureReason: (error) => error,
      backendFailurePayloadRefs: () => ({}),
      repairNeededPayload: (_request, _skill, reason) => repairPayload(reason),
      validateAndNormalizePayload: async (value) => value,
    },
  });

  assert.equal(payload.claimType, 'runtime-diagnostic');
  assert.match(payload.message, /partial artifacts/);
  const completionCandidate = payload.displayIntent?.completionCandidate as { status?: string; auditRefs?: string[] } | undefined;
  assert.equal(completionCandidate?.status, 'unverified');
  assert.deepEqual(completionCandidate?.auditRefs, ['partial_report.md']);
  assert.equal(payload.artifacts.some((artifact) => artifact.id === 'agentserver-candidate-partial-report-md'), true);
  assert.equal(payload.budgetDebits?.some((debit) => debit.capabilityId === 'sciforge.backend.generation-failure'), true);
});

function repairPayload(reason: string): ToolPayload {
  return {
    message: reason,
    confidence: 0.2,
    claimType: 'runtime-diagnostic',
    evidenceLevel: 'runtime',
    reasoningTrace: reason,
    claims: [{ statement: reason, confidence: 0.2 }],
    uiManifest: [],
    executionUnits: [{
      id: 'generation-failure-helper-repair',
      status: 'repair-needed',
      tool: 'sciforge.generated-task-generation-failure',
      failureReason: reason,
    }],
    artifacts: [],
  };
}
