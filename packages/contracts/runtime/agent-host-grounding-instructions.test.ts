import assert from 'node:assert/strict';
import test from 'node:test';

import { agentHostGroundingDeveloperInstructionLines } from './agent-host-grounding-instructions.js';

test('agent host grounding developer instructions stay bounded and redact private refs', () => {
  const lines = agentHostGroundingDeveloperInstructionLines({
    productCapabilities: {
      browser: 'supported',
      computerUse: 'supported',
    },
    runtimeReadiness: {
      browser: 'ready',
      computerUse: 'blocked',
    },
    blockers: ['window-action-session-unavailable'],
    authorizationProfile: {
      id: 'high-autonomy',
    },
    actionContext: {
      targetBound: false,
      freshObservation: false,
      permissionRefsPresent: false,
      stopCancelPath: false,
    },
    refs: ['runtime-health:workspace', 'https://private.example.invalid/token?secret=sk-private'],
  });
  const text = lines.join('\n');

  assert.match(text, /Browser=supported/);
  assert.match(text, /Computer Use=blocked/);
  assert.match(text, /window-action-session-unavailable/);
  assert.match(text, /runtime-health:workspace/);
  assert.doesNotMatch(text, /private\.example|sk-private|Applications\/workspace|raw JSONL/i);
});
