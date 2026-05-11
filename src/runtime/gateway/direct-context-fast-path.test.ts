import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types.js';
import { directContextFastPathPayload } from './direct-context-fast-path.js';

test('context follow-up protocol enables direct context answer even when AgentServer is configured', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'What tools and refs were used for the previous result?',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      metadata: { reportRef: '.sciforge/task-results/report.md' },
    }],
    uiState: {
      agentHarness: {
        contract: {
          schemaVersion: 'sciforge.agent-harness-contract.v1',
          intentMode: 'audit',
          capabilityPolicy: { preferredCapabilityIds: ['runtime.direct-context-answer'] },
        },
      },
      recentExecutionRefs: [{
        id: 'unit-report',
        tool: 'capability.report.generate',
        outputRef: '.sciforge/task-results/report.json',
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
  assert.equal(payload.artifacts[0]?.type, 'research-report');
  assert.match(payload.message, /research-report|report/i);
});

test('context follow-up protocol does not direct-answer fresh work requests', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Please rerun the search and download the latest papers',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{ id: 'research-report', type: 'research-report' }],
    uiState: {
      agentHarness: {
        contract: {
          schemaVersion: 'sciforge.agent-harness-contract.v1',
          intentMode: 'fresh',
          capabilityPolicy: { preferredCapabilityIds: [] },
        },
      },
    },
  };

  assert.equal(directContextFastPathPayload(request), undefined);
});
