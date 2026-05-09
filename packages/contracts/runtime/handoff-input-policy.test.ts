import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBackendInputTextAnchors } from './handoff-input-policy';

test('backend input anchors preserve current turn snapshot and output contract', () => {
  const anchors = buildBackendInputTextAnchors([
    'System prefix',
    JSON.stringify({
      prompt: '检索最近一周的论文并写报告',
      skillDomain: 'literature',
      expectedArtifactTypes: ['paper-list', 'research-report'],
      selectedComponentIds: ['paper-card-list', 'report-viewer'],
      taskContract: {
        outputPayloadKeys: ['artifacts', 'answer'],
      },
      contextEnvelope: {
        version: 'sciforge.context-envelope.v1',
        sessionFacts: {
          currentUserRequest: '检索最近一周的论文并写报告',
          recentConversation: ['user: 检索最近一周的论文并写报告'],
        },
        longTermRefs: {
          priorAttempts: [{ id: 'attempt-1', failureReason: 'old failure' }],
        },
      },
    }, null, 2),
    'Final output must be only compact JSON matching AgentServerGenerationResponse or SciForge ToolPayload.',
  ].join('\n'), { maxInlineStringChars: 2500 });

  const text = anchors.join('\n');
  assert.match(text, /CURRENT TURN SNAPSHOT/);
  assert.match(text, /检索最近一周的论文并写报告/);
  assert.match(text, /paper-list/);
  assert.match(text, /OUTPUT CONTRACT EXCERPT/);
  assert.match(text, /AgentServerGenerationResponse|SciForge ToolPayload/);
});

test('backend input anchors fall back to current turn and recovery excerpts', () => {
  const anchors = buildBackendInputTextAnchors([
    'prefix '.repeat(120),
    'Current user request: 继续上一轮失败任务',
    'middle '.repeat(120),
    '"failureReason": "timed out or was cancelled"',
    'suffix '.repeat(120),
  ].join('\n'), { maxInlineStringChars: 1600 });

  const text = anchors.join('\n');
  assert.match(text, /CURRENT TURN EXCERPT/);
  assert.match(text, /继续上一轮失败任务/);
  assert.match(text, /RECOVERY CONTEXT EXCERPT/);
  assert.match(text, /failureReason/);
});
