import assert from 'node:assert/strict';

import { applyBackgroundCompletionEventToSession, requestPayloadForTurn } from '../../src/ui/src/app/chat/sessionTransforms';
import type { SciForgeMessage, SciForgeSession } from '../../src/ui/src/domain';

function session(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-background-smoke',
    scenarioId: 'literature-evidence-review',
    title: 'Background completion smoke',
    createdAt: '2026-05-08T02:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
    updatedAt: '2026-05-08T02:00:00.000Z',
  };
}

function userMessage(id: string, content: string, createdAt: string): SciForgeMessage {
  return { id, role: 'user', content, createdAt, status: 'completed' };
}

const started = applyBackgroundCompletionEventToSession(session(), {
  contract: 'sciforge.background-completion.v1',
  type: 'background-initial-response',
  runId: 'run-long-task',
  stageId: 'stage-initial',
  ref: 'run:run-long-task#stage-initial',
  status: 'running',
  prompt: 'Run a generic long task and provide a quick visible response first.',
  message: '已收到。我先返回可读状态，后台继续补全结果、artifact 和验证。',
  createdAt: '2026-05-08T02:00:05.000Z',
});

assert.equal(started.runs[0].status, 'running');
assert.equal(started.messages[0].content.includes('后台继续补全'), true);

const withArtifact = applyBackgroundCompletionEventToSession(started, {
  contract: 'sciforge.background-completion.v1',
  type: 'background-stage-update',
  runId: 'run-long-task',
  stageId: 'stage-artifact',
  ref: 'run:run-long-task#stage-artifact',
  status: 'running',
  message: 'long task artifact 已生成，等待最终验证。',
  artifacts: [{
    id: 'artifact-long-task-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Long task report\n\nResult is ready.' },
  }],
  workEvidence: [{ id: 'we-long-task-artifact', ref: 'artifact:artifact-long-task-report' }],
  updatedAt: '2026-05-08T02:01:00.000Z',
});

const completed = applyBackgroundCompletionEventToSession(withArtifact, {
  contract: 'sciforge.background-completion.v1',
  type: 'background-finalization',
  runId: 'run-long-task',
  stageId: 'stage-final',
  ref: 'run:run-long-task#stage-final',
  status: 'completed',
  finalResponse: '后台补全完成：报告 artifact 已生成，验证通过，可在下一轮继续引用。',
  verificationResults: [{
    id: 'verify-long-task',
    verdict: 'pass',
    confidence: 0.92,
    evidenceRefs: ['artifact:artifact-long-task-report'],
  }],
  completedAt: '2026-05-08T02:02:00.000Z',
});

const nextUser = userMessage('msg-next', '继续使用刚才后台完成的报告', '2026-05-08T02:03:00.000Z');
const nextPayload = requestPayloadForTurn({ ...completed, messages: [...completed.messages, nextUser] }, nextUser, []);

assert.equal(completed.runs[0].status, 'completed');
assert.equal(completed.messages.length, 1);
assert.equal(completed.messages[0].content.includes('后台补全完成'), true);
assert.equal(completed.artifacts[0].metadata?.runId, 'run-long-task');
assert.match(JSON.stringify(nextPayload), /artifact-long-task-report/);
assert.match(JSON.stringify(nextPayload), /verify-long-task/);

console.log('[ok] background completion protocol supports quick initial response followed by artifact, verification, evidence, and finalization updates');
