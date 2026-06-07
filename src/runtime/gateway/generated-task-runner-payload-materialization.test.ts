import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { sha1 } from '../workspace-task-runner.js';
import {
  backendPayloadRefs,
  materializeBackendGenerationLifecyclePayload,
  stableGeneratedTaskPayloadTaskId,
} from './generated-task-runner-payload-materialization.js';

const request: GatewayRequest = {
  skillDomain: 'knowledge',
  prompt: 'repair an backend generation failure and return a bounded ToolPayload',
  artifacts: [],
  uiState: {
    sessionId: 'generation-payload-materialization',
    sessionCreatedAt: '2026-05-12T00:00:00.000Z',
  },
};

const skill = {
  id: 'knowledge-agentserver-generation',
  kind: 'package',
  available: true,
  reason: 'test',
  checkedAt: '2026-05-16T00:00:00.000Z',
  manifestPath: '/tmp/skill.json',
  manifest: {
    id: 'knowledge-agentserver-generation',
    kind: 'skill',
    label: 'Knowledge',
    description: 'test',
    entrypoint: { type: 'agentserver-generation' },
  },
} as unknown as SkillAvailability;

const payload: ToolPayload = {
  message: 'Repair payload ready.',
  confidence: 0,
  claimType: 'failed-with-reason',
  evidenceLevel: 'runtime',
  reasoningTrace: 'generation lifecycle materialization test',
  claims: [],
  uiManifest: [],
  executionUnits: [{ id: 'repair', status: 'failed-with-reason', tool: 'agentserver.generation-repair' }],
  artifacts: [],
};

test('generation lifecycle payload materializer scopes refs and writes audit logs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generation-payload-materialization-'));
  const reason = 'backend generation returned malformed taskFiles.';
  const kind = 'generation-retry-repair';
  const taskRel = 'backend-generation://generation-retry-repair';
  try {
    const materialized = await materializeBackendGenerationLifecyclePayload({
      workspace,
      request,
      skill,
      payload,
      reason,
      kind,
      taskRel,
    });

    const taskId = stableGeneratedTaskPayloadTaskId(kind, request, skill, sha1(reason).slice(0, 8));
    const refs = backendPayloadRefs(
      taskId,
      taskRel,
      '.sciforge/sessions/2026-05-12_knowledge_generation-payload-materialization',
    );
    assert.equal(materialized.message, payload.message);
    assert.equal(await readFile(join(workspace, refs.stdoutRel), 'utf8'), `${kind}: ${reason}\n`);
    assert.equal(await readFile(join(workspace, refs.stderrRel), 'utf8'), '');
    assert.match(await readFile(join(workspace, refs.outputRel), 'utf8'), /Repair payload ready/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
