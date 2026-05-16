import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types.js';
import { directContextFastPathPayload } from './direct-context-fast-path.js';

function directDecision(
  intent: 'context-summary' | 'run-diagnostic' | 'artifact-status' | 'capability-status' | 'fresh-execution' | 'unknown' = 'context-summary',
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 'sciforge.direct-context-decision.v1',
    decisionRef: `decision:test-${intent}`,
    decisionOwner: 'agentserver',
    intent,
    requiredTypedContext: intent === 'capability-status'
      ? ['capability-registry', 'provider-registry']
      : ['current-session-context'],
    usedRefs: ['artifact:research-report'],
    sufficiency: 'sufficient',
    allowDirectContext: true,
    ...overrides,
  };
}

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
      directContextDecision: directDecision(),
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        directContextDecision: directDecision(),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
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

test('context follow-up summarizes risk claims from current context instead of dumping refs', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Continue from the current memo artifact only. Summarize the two risks in one short Chinese paragraph. No web or external provider.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'current-memo',
      type: 'research-report',
      data: {
        markdown: '风险 1：上下文窗口膨胀可能导致投影漂移。风险 2：多阶段状态恢复不一致可能导致重复 repair。',
      },
      metadata: { reportRef: '.sciforge/task-results/current-memo.md' },
    }],
    uiState: {
      directContextDecision: directDecision(),
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        directContextDecision: directDecision(),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
      },
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.match(payload.message, /上下文窗口膨胀/);
  assert.match(payload.message, /状态恢复不一致/);
  assert.doesNotMatch(payload.message, /^1\./m);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
});

test('direct context fast path answers skill tool capability provider status queries from runtime registry', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '现在你有哪些 skill 和 web search provider 是被激活了？',
    agentServerBaseUrl: 'http://agentserver.example.test',
    selectedToolIds: ['web_search'],
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      metadata: { reportRef: '.sciforge/task-results/report.md' },
    }],
    uiState: {
      directContextDecision: directDecision('capability-status'),
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        directContextDecision: directDecision(),
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

test('agent harness audit hints do not generate direct context strategy without DirectContextDecision', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'What did the previous result use?',
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
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
      agentHarness: {
        contract: {
          schemaVersion: 'sciforge.agent-harness-contract.v1',
          intentMode: 'audit',
          capabilityPolicy: { preferredCapabilityIds: ['runtime.direct-context-answer'] },
        },
      },
      turnExecutionConstraints: {
        contextOnly: true,
        preferredCapabilityIds: ['runtime.direct-context-answer'],
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
        directContextDecision: directDecision(),
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

test('run-diagnostic direct context can answer from selected execution-unit refs only', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'No rerun, no tools. Use the selected ref only to summarize blocker and recover actions.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [],
    references: [{ ref: 'execution-unit:EU-literature-failed', title: 'Failed execution unit' }],
    uiState: {
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        directContextDecision: directDecision('run-diagnostic', {
          requiredTypedContext: ['execution-units', 'failure-evidence'],
          usedRefs: ['execution-unit:EU-literature-failed'],
        }),
        executionModePlan: {
          executionMode: 'direct-context-answer',
          signals: ['run-diagnostic', 'no-execution-directive'],
        },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
      currentReferences: [{ ref: 'execution-unit:EU-literature-failed', title: 'Failed execution unit', kind: 'execution-unit' }],
      recentExecutionRefs: [{
        id: 'EU-literature-failed',
        status: 'repair-needed',
        outputRef: '.sciforge/task-results/failed.json',
        stderrRef: '.sciforge/logs/failed.stderr.log',
        failureReason: 'AgentServer generation stopped by convergence guard.',
        recoverActions: ['Retry with selected refs only.'],
        nextStep: 'Use currentReferenceDigests instead of broad history.',
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
  assert.equal(payload.executionUnits[0]?.status, 'done');
  assert.match(payload.message, /EU-literature-failed|failed\.json|failed\.stderr\.log/);
  assert.doesNotMatch(payload.message, /AgentServer generation request registered/);
});

test('applied context-only constraints do not synthesize direct context without DirectContextDecision', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'No rerun, no tools. Summarize blocker and recover actions from current refs.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [],
    uiState: {
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        executionModePlan: {
          executionMode: 'direct-context-answer',
          signals: ['run-diagnostic', 'no-execution-directive'],
        },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
      turnExecutionConstraints: {
        schemaVersion: 'sciforge.turn-execution-constraints.v1',
        policyId: 'sciforge.current-turn-execution-constraints.v1',
        source: 'runtime-contract.turn-constraints',
        contextOnly: true,
        workspaceExecutionForbidden: true,
        externalIoForbidden: true,
        codeExecutionForbidden: true,
        preferredCapabilityIds: ['runtime.direct-context-answer'],
        executionModeHint: 'direct-context-answer',
        initialResponseModeHint: 'direct-context-answer',
        reasons: ['current turn requested context-only or no-execution handling'],
        evidence: {
          hasPriorContext: true,
          referenceCount: 0,
          artifactCount: 1,
          executionRefCount: 1,
          runCount: 0,
        },
      },
      recentExecutionRefs: [{
        id: 'EU-literature-failed',
        status: 'repair-needed',
        outputRef: '.sciforge/task-results/failed.json',
        failureReason: 'Prior run exceeded a bounded generation guard.',
        recoverActions: ['Continue with selected refs only.'],
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.equal(payload, undefined);
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
      directContextDecision: directDecision(),
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        directContextDecision: directDecision(),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
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
      directContextDecision: directDecision('capability-status', { usedRefs: ['artifact:fetch-example-com'] }),
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
  assert.doesNotMatch(payload.message, /worker=/);
  assert.doesNotMatch(JSON.stringify(payload), /(?:\\")?(workerId|runtimeLocation|endpoint|baseUrl|invokeUrl|invokePath)(?:\\")?\s*:/);
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

test('provider availability fallback wording does not steal English fresh search requests', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'search recent papers about agent workflow reliability and return a Chinese evidence summary. if web_search provider is unavailable, explain missing provider route and recoverable next step. do not fabricate results.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'prior-note',
      type: 'runtime-context-summary',
      data: { markdown: 'Prior demo context exists but does not answer the fresh retrieval request.' },
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

test('provider status fast path yields for bounded repair prompt that asks for adapter task or failed-with-reason payload', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'continue from the last bounded stop. do not start long generation. produce one minimal single stage result only. if web search or web fetch provider routes are usable then create a minimal adapter task that uses those provider routes. if this cannot be determined in this turn then return a valid failed with reason tool payload with failure reason recover actions next step and refs. do not ask agentserver for another long loop.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'bounded-stop-diagnostic',
      type: 'runtime-diagnostic',
      data: { markdown: 'Prior run stopped at bounded repair guard with reusable refs.' },
    }],
    uiState: {
      recentExecutionRefs: [{
        id: 'bounded-stop-unit',
        status: 'repair-needed',
        outputRef: '.sciforge/task-results/bounded-stop.json',
        stderrRef: '.sciforge/logs/bounded-stop.stderr.log',
      }],
      capabilityProviderAvailability: [{
        id: 'sciforge.web-worker.web_search',
        providerId: 'sciforge.web-worker.web_search',
        capabilityId: 'web_search',
        workerId: 'sciforge.web-worker',
        available: true,
        status: 'available',
      }, {
        id: 'sciforge.web-worker.web_fetch',
        providerId: 'sciforge.web-worker.web_fetch',
        capabilityId: 'web_fetch',
        workerId: 'sciforge.web-worker',
        available: true,
        status: 'available',
      }],
    },
  };

  assert.equal(directContextFastPathPayload(request), undefined);
});

test('scoped no-rerun repair prompt still yields to backend when it asks to generate a minimal task', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '请复用这次失败诊断继续，不要重跑无关步骤；修正生成任务，必须使用 SciForge 已解析的 web_search/web_fetch provider route 或输出合法失败 payload，然后继续完成中文证据摘要。',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'provider-first-diagnostic',
      type: 'runtime-diagnostic',
      data: { markdown: 'Generated task used direct external network APIs despite ready provider routes.' },
    }],
    uiState: {
      recentExecutionRefs: [{
        id: 'provider-first-unit',
        status: 'repair-needed',
        outputRef: '.sciforge/task-results/provider-first.json',
      }],
      capabilityProviderAvailability: [{
        id: 'sciforge.web-worker.web_search',
        providerId: 'sciforge.web-worker.web_search',
        capabilityId: 'web_search',
        workerId: 'sciforge.web-worker',
        available: true,
        status: 'available',
      }, {
        id: 'sciforge.web-worker.web_fetch',
        providerId: 'sciforge.web-worker.web_fetch',
        capabilityId: 'web_fetch',
        workerId: 'sciforge.web-worker',
        available: true,
        status: 'available',
      }],
    },
  };

  assert.equal(directContextFastPathPayload(request), undefined);
});
