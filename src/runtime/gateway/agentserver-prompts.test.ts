import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAgentServerGenerationPrompt } from './agentserver-prompts.js';

test('AgentServer generation prompt projects core snapshot as turn refs without recentTurns or raw bodies', () => {
  const prompt = buildAgentServerGenerationPrompt({
    prompt: 'Continue from the supplied refs.',
    skillDomain: 'literature',
    contextEnvelope: {
      agentServerCoreSnapshot: {
        source: 'AgentServer Core /context',
        session: { id: 'session-1', status: 'active' },
        recentTurnRefs: [{
          turnNumber: 3,
          role: 'assistant',
          runId: 'run-3',
          contentRef: '.sciforge/refs/turn-3.md',
          contentDigest: 'sha1:turn-3',
          contentChars: 2048,
          contentOmitted: true,
        }],
        recentTurns: [{
          role: 'assistant',
          content: 'RAW_AGENTSERVER_TURN_BODY_SHOULD_NOT_LEAK',
        }],
        currentWork: {
          entryCount: 1,
          rawTurnCount: 1,
          compactionTags: [{
            kind: 'compaction',
            id: 'compact-1',
            summary: ['RAW_COMPACTION_SUMMARY_SHOULD_NOT_LEAK'],
          }],
        },
      },
    },
    workspaceTreeSummary: [],
    availableSkills: [],
    artifactSchema: {},
    uiManifestContract: {},
    priorAttempts: [],
  });

  assert.match(prompt, /recentTurnRefs/);
  assert.match(prompt, /\.sciforge\/refs\/turn-3\.md/);
  assert.match(prompt, /sha1:turn-3/);
  assert.doesNotMatch(prompt, /recentTurns|RAW_AGENTSERVER_TURN_BODY_SHOULD_NOT_LEAK|RAW_COMPACTION_SUMMARY_SHOULD_NOT_LEAK/);
});
