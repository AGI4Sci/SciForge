import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import type { AgentServerGenerationResponse, GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeEvent } from '../runtime-types.js';
import {
  resolveGeneratedTaskGenerationRetryLifecycle,
  type AgentServerGenerationResult,
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

test('generation lifecycle strict-retries provider-first payload preflight violations', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-provider-first-preflight-retry-'));
  const events: WorkspaceRuntimeEvent[] = [];
  let strictTaskFilesReason = '';
  const retryGeneration: AgentServerGenerationResult = {
    ok: true,
    runId: 'retry-provider-first',
    response: validProviderFirstGeneration('.sciforge/tasks/provider-first.py'),
  };

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
    deps: depsWithRetry(async (params) => {
      strictTaskFilesReason = params.strictTaskFilesReason ?? '';
      return retryGeneration;
    }),
  });

  assert.equal(result.kind, 'task-files');
  assert.equal(result.generation.runId, 'retry-provider-first');
  assert.match(strictTaskFilesReason, /capabilityFirstPolicy/);
  assert.match(strictTaskFilesReason, /direct external network APIs/);
  assert.match(events.at(-1)?.detail ?? '', /ready SciForge provider routes/);
});

test('generation lifecycle returns repair payload when provider-first strict retry still bypasses providers', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-provider-first-preflight-still-blocked-'));
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
  });

  assert.equal(result.kind, 'payload');
  assert.match(result.payload.message, /Strict retry still bypassed ready provider routes/);
  assert.equal(result.payload.executionUnits?.[0]?.status, 'repair-needed');
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

function validProviderFirstGeneration(path: string): AgentServerGenerationResponse {
  return generation(path, [
    'import json, sys',
    'from sciforge_task import invoke_provider',
    'input_path = sys.argv[1]',
    'output_path = sys.argv[2]',
    'task_input = json.load(open(input_path, "r", encoding="utf-8"))',
    'provider_result = invoke_provider(task_input, "web_search", {"query": "CRISPR prime editing review"})',
    'payload = {"message": "ok", "confidence": 0.5, "claimType": "fact", "evidenceLevel": "runtime", "reasoningTrace": str(provider_result), "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": []}',
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
