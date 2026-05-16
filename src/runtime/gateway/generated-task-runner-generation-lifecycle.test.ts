import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import type { AgentServerGenerationResponse, GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeEvent } from '../runtime-types.js';
import {
  resolveGeneratedTaskGenerationRetryLifecycle,
  type GeneratedTaskGenerationLifecycleDeps,
} from './generated-task-runner-generation-lifecycle.js';

const readyWebProviderRequest: GatewayRequest = {
  skillDomain: 'literature',
  prompt: 'fresh literature run: search recent papers and summarize evidence.',
  selectedToolIds: ['web_search'],
  artifacts: [],
  uiState: {
    sessionId: 'fresh-literature-provider-first-retry',
    capabilityProviderAvailability: [{
      id: 'sciforge.web-worker.web_search',
      available: true,
      status: 'available',
    }],
  },
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

test('generation lifecycle routes provider-first payload preflight violations to recovery adapter', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-provider-first-preflight-recovery-'));
  const events: WorkspaceRuntimeEvent[] = [];

  const result = await resolveGeneratedTaskGenerationRetryLifecycle({
    baseUrl: 'http://127.0.0.1:18080',
    request: readyWebProviderRequest,
    skill,
    skills: [skill],
    workspace,
    generation: {
      ok: true,
      runId: 'initial-direct-network',
      response: directNetworkGeneration('.sciforge/tasks/direct-network.py'),
    },
    callbacks: {
      onEvent: (event) => events.push(event),
    },
    deps: depsWithRetry(async () => {
      throw new Error('provider-first recovery should not require an AgentServer strict retry');
    }),
  });

  assert.equal(result.kind, 'task-files');
  assert.equal(result.generation.runId, 'initial-direct-network');
  assert.match(result.generation.response.patchSummary ?? '', /provider-first contract violation/i);
  const source = result.generation.response.taskFiles[0]?.content ?? '';
  assert.match(source, /invoke_capability/);
  assert.match(source, /_search_query/);
  assert.match(source, /arxiv_ids = re\.findall/);
  assert.match(source, /do\\s\+not\|don/);
  assert.match(source, /provider metadata is not full-text verified evidence/);
  assert.match(source, /"status": "failed-with-reason"/);
  assert.doesNotMatch(source, /"status": "done", "tool": "invoke_capability"/);
  assert.doesNotMatch(source, /import\s+requests|import\s+urllib|requests\.|urllib\.request/);
  assert.equal(events.some((event) => /direct provider bypass/.test(event.message ?? '')), true);
});

test('generation lifecycle provider-first adapter is deterministic for repeated bypasses', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-provider-first-preflight-still-blocked-'));
  const events: WorkspaceRuntimeEvent[] = [];
  const result = await resolveGeneratedTaskGenerationRetryLifecycle({
    baseUrl: 'http://127.0.0.1:18080',
    request: readyWebProviderRequest,
    skill,
    skills: [skill],
    workspace,
    generation: {
      ok: true,
      runId: 'initial-direct-network',
      response: directNetworkGeneration('.sciforge/tasks/direct-network.py'),
    },
    deps: depsWithRetry(async () => ({
      ok: true,
      runId: 'retry-still-direct-network',
      response: directNetworkGeneration('.sciforge/tasks/direct-network-retry.py'),
    })),
    callbacks: {
      onEvent: (event) => events.push(event),
    },
  });

  assert.equal(result.kind, 'task-files');
  assert.equal(result.generation.runId, 'initial-direct-network');
  assert.match(result.generation.response.patchSummary ?? '', /provider-first contract violation/i);
  const source = result.generation.response.taskFiles[0]?.content ?? '';
  assert.match(source, /invoke_capability/);
  assert.match(source, /provider_result_is_empty/);
  assert.match(source, /full-text\/PDF retrieval, citation verification, and task-specific evidence grounding were not completed/i);
  assert.match(source, /"claimType": "failed-with-reason"/);
  assert.doesNotMatch(source, /import\s+requests|import\s+urllib|requests\.|urllib\.request/);
  assert.equal(events.some((event) => /deterministic provider-first recovery adapter/.test(event.message ?? '')), true);
});

function depsWithRetry(
  requestAgentServerGeneration: GeneratedTaskGenerationLifecycleDeps['requestAgentServerGeneration'],
): GeneratedTaskGenerationLifecycleDeps {
  return {
    requestAgentServerGeneration,
    attemptPlanRefs: () => ({}),
    repairNeededPayload: (_request, _skill, reason) => repairPayload(reason),
    ensureDirectAnswerReportArtifact: (payload) => payload,
    mergeReusableContextArtifactsForDirectPayload: async (payload) => payload,
    validateAndNormalizePayload: async (payload) => payload,
    firstPayloadFailureReason: () => undefined,
    payloadHasFailureStatus: () => false,
  };
}

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
      id: 'provider-first-preflight-repair',
      status: 'repair-needed',
      tool: 'sciforge.generated-task-generation-lifecycle',
      failureReason: reason,
    }],
    artifacts: [],
  };
}

function directNetworkGeneration(path: string): AgentServerGenerationResponse {
  return generation(path, [
    'import json, sys, urllib.request',
    'input_path = sys.argv[1]',
    'output_path = sys.argv[2]',
    'urllib.request.urlopen("https://example.com", timeout=5)',
    'payload = {"message": "ok", "confidence": 0.5, "claimType": "fact", "evidenceLevel": "runtime", "reasoningTrace": input_path, "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": []}',
    'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
  ].join('\n'));
}

function generation(path: string, content: string): AgentServerGenerationResponse {
  return {
    taskFiles: [{ path, language: 'python', content }],
    entrypoint: { language: 'python', path },
    environmentRequirements: {},
    validationCommand: '',
    expectedArtifacts: [],
    patchSummary: 'test generation',
  };
}
