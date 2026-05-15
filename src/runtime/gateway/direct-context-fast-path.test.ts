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
  assert.equal(payload.artifacts[0]?.type, 'runtime-context-summary');
  assert.match(payload.message, /research-report|report/i);
});

test('direct context fast path answers skill tool capability provider status queries from runtime registry', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '现在你有哪些 skill 和 web search provider 是被激活了？',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      metadata: { reportRef: '.sciforge/task-results/report.md' },
    }],
    uiState: {
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        executionModePlan: {
          executionMode: 'direct-context-answer',
          signals: ['context-summary'],
        },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
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
  assert.equal(payload.claimType, 'capability-provider-status');
  assert.match(payload.message, /Tool\/provider status answered from SciForge runtime registries/);
  assert.match(payload.message, /web_search|provider/i);
});

test('context follow-up protocol yields when AgentServer generation is explicitly forced', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Where did the generated files go?',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      metadata: { reportRef: '.sciforge/task-results/report.md' },
    }],
    uiState: {
      forceAgentServerGeneration: true,
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

  assert.equal(directContextFastPathPayload(request), undefined);
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

test('explicit no-execution context summary uses direct fast path from applied conversation policy', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '不要重跑、不要执行、不要调用 AgentServer。只基于当前会话 refs/digest 列出 3 条接受标准。',
    agentServerBaseUrl: 'http://agentserver.example.test',
    expectedArtifactTypes: ['evidence-matrix'],
    artifacts: [{
      id: 'runtime-diagnostic',
      type: 'runtime-diagnostic',
      data: { markdown: 'Prior run failed after preserving refs.' },
    }],
    uiState: {
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        executionModePlan: {
          executionMode: 'direct-context-answer',
          signals: ['context-summary', 'no-execution-directive'],
        },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
      turnExecutionConstraints: {
        schemaVersion: 'sciforge.turn-execution-constraints.v1',
        policyId: 'sciforge.current-turn-execution-constraints.v1',
        source: 'runtime-contract.turn-constraints',
        contextOnly: true,
        agentServerForbidden: true,
        workspaceExecutionForbidden: true,
        externalIoForbidden: true,
        codeExecutionForbidden: true,
        preferredCapabilityIds: ['runtime.direct-context-answer'],
        executionModeHint: 'direct-context-answer',
        initialResponseModeHint: 'direct-context-answer',
        reasons: ['current-context-only directive'],
        evidence: {
          hasPriorContext: true,
          referenceCount: 1,
          artifactCount: 1,
          executionRefCount: 1,
          runCount: 0,
        },
      },
      currentReferenceDigests: [{
        sourceRef: 'workspace/output-toolpayload.json',
        digestRef: '.sciforge/digests/output-toolpayload.md',
        digestText: 'Digest: prior run preserved failed output refs but did not produce acceptance evidence.',
      }],
      recentExecutionRefs: [{
        id: 'unit-failed',
        status: 'repair-needed',
        outputRef: '.sciforge/task-results/failed.json',
        stderrRef: '.sciforge/logs/failed.stderr.log',
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
  assert.equal(payload.executionUnits[0]?.status, 'done');
  assert.match(String(payload.executionUnits[0]?.params ?? ''), /directContextGate/);
  assert.match(JSON.stringify(payload.artifacts[0]?.metadata ?? {}), /directContextGate/);
  assert.match(payload.message, /Digest: prior run preserved failed output refs/);
  assert.match(payload.message, /failed\.json|failed\.stderr\.log/);
});

test('applied direct context policy does not answer from historical execution refs alone', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Use current refs only and do not dispatch AgentServer.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [],
    uiState: {
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        executionModePlan: {
          executionMode: 'direct-context-answer',
          signals: ['context-summary', 'no-execution-directive'],
        },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
      recentExecutionRefs: [{
        id: 'unit-old-failure',
        status: 'failed-with-reason',
        outputRef: '.sciforge/old/task-results/failed.json',
      }],
    },
  };

  assert.equal(directContextFastPathPayload(request), undefined);
});

test('local execution diagnostics do not authorize direct fast path without applied policy', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '不要重跑、不要执行、不要调用 AgentServer。只基于当前会话 refs/digest 列出 3 条接受标准。',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'runtime-diagnostic',
      type: 'runtime-diagnostic',
      data: { markdown: 'Prior run failed after preserving refs.' },
    }],
    uiState: {
      executionModeDiagnostics: {
        executionMode: 'direct-context-answer',
        signals: ['context-summary', 'no-execution-directive'],
      },
      recentExecutionRefs: [{
        id: 'unit-failed',
        status: 'repair-needed',
        outputRef: '.sciforge/task-results/failed.json',
      }],
    },
  };

  assert.equal(directContextFastPathPayload(request), undefined);
});

test('prompt-only no-execution text does not authorize direct fast path without structured execution decision', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '不要重跑、不要执行、不要调用 AgentServer。只基于当前会话 refs/digest 列出 3 条接受标准。',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'runtime-diagnostic',
      type: 'runtime-diagnostic',
      data: { markdown: 'Prior run failed after preserving refs.' },
    }],
    uiState: {
      recentExecutionRefs: [{
        id: 'unit-failed',
        status: 'repair-needed',
        outputRef: '.sciforge/task-results/failed.json',
      }],
    },
  };

  assert.equal(directContextFastPathPayload(request), undefined);
});

test('structured turn constraints alone do not authorize direct context when policy times out', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '不要重跑、不要执行、不要调用 AgentServer。只基于当前会话 refs/digest 列出 3 条接受标准。',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'runtime-diagnostic',
      type: 'runtime-diagnostic',
      metadata: { outputRef: '.sciforge/task-results/failed.json' },
    }],
    uiState: {
      turnExecutionConstraints: {
        schemaVersion: 'sciforge.turn-execution-constraints.v1',
        policyId: 'sciforge.current-turn-execution-constraints.v1',
        source: 'runtime-contract.turn-constraints',
        contextOnly: true,
        agentServerForbidden: true,
        workspaceExecutionForbidden: true,
        externalIoForbidden: true,
        codeExecutionForbidden: true,
        preferredCapabilityIds: ['runtime.direct-context-answer'],
        executionModeHint: 'direct-context-answer',
        initialResponseModeHint: 'direct-context-answer',
        reasons: ['current-context-only directive'],
        evidence: {
          hasPriorContext: true,
          referenceCount: 0,
          artifactCount: 1,
          executionRefCount: 1,
          runCount: 0,
        },
      },
      recentExecutionRefs: [{
        id: 'unit-failed',
        status: 'repair-needed',
        outputRef: '.sciforge/task-results/failed.json',
      }],
    },
  };

  assert.equal(directContextFastPathPayload(request), undefined);
});

test('explicit no-read old context does not direct-answer fresh lookup requests', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '不要读取旧日志，但请搜索最新来源并总结。',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      metadata: { reportRef: '.sciforge/task-results/report.md' },
    }],
    uiState: {
      recentExecutionRefs: [{
        id: 'unit-report',
        tool: 'capability.report.generate',
        outputRef: '.sciforge/task-results/report.json',
      }],
    },
  };

  assert.equal(directContextFastPathPayload(request), undefined);
});

test('context follow-up protocol returns needs-work when expected artifacts are missing', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '基于上一轮结果继续重排并导出审计',
    agentServerBaseUrl: 'http://agentserver.example.test',
    expectedArtifactTypes: ['paper-list', 'research-report'],
    artifacts: [{
      id: 'runtime-diagnostic',
      type: 'runtime-diagnostic',
      data: { markdown: 'Prior run failed before writing paper-list/report.' },
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
        id: 'unit-failed',
        status: 'repair-needed',
        outputRef: '.sciforge/task-results/failed.json',
        stderrRef: '.sciforge/logs/failed.stderr.log',
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.status, 'repair-needed');
  assert.equal(payload.artifacts[0]?.type, 'runtime-diagnostic');
  assert.match(payload.message, /缺失产物：paper-list, research-report/);
  assert.match(String(payload.executionUnits[0]?.failureReason ?? ''), /cannot satisfy follow-up/);
});

test('provider status follow-up reuses current context without AgentServer generation', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Round 2 continue from Round 1. Reuse the Example Domain result and fetch https://example.com again only if needed. Say whether tool providers are still available.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    selectedToolIds: ['web_fetch'],
    artifacts: [{
      id: 'fetch-example-com',
      type: 'runtime-context-summary',
      data: { markdown: 'Round 1 fetched https://example.com. Title: Example Domain.' },
    }],
    uiState: {
      currentReferences: [{
        id: 'ref-fetch',
        kind: 'artifact',
        ref: 'artifact:fetch-example-com',
        title: 'Example Domain fetch result',
        summary: 'Title: Example Domain',
      }],
      capabilityProviderAvailability: [{
        id: 'sciforge.web-worker.web_fetch',
        providerId: 'sciforge.web-worker.web_fetch',
        workerId: 'sciforge.web-worker',
        capabilityId: 'web_fetch',
        available: true,
        status: 'available',
        health: 'online',
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.equal(payload.claimType, 'capability-provider-status');
  assert.equal(payload.executionUnits[0]?.status, 'done');
  assert.match(payload.message, /sciforge\.web-worker\.web_fetch/);
  assert.match(payload.message, /Example Domain/);
});

test('provider wording does not steal fresh retrieval requests from AgentServer dispatch', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '启用 AgentServer server-side web_search 后，用同一个窄日期 query 再检索；如果为空请说明 empty result 并给恢复建议。',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'runtime-diagnostic',
      type: 'runtime-diagnostic',
      data: { markdown: 'Prior provider route was missing.' },
    }],
    uiState: {
      capabilityProviderAvailability: [{
        id: 'sciforge.web-worker.web_search',
        providerId: 'sciforge.web-worker.web_search',
        capabilityId: 'web_search',
        workerId: 'sciforge.web-worker',
        available: true,
        status: 'available',
      }],
    },
  };

  assert.equal(directContextFastPathPayload(request), undefined);
});
