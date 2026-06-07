import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types.js';
import { directContextFastPathPayload, requestWithDirectContextReadableArtifactData } from './direct-context-fast-path.js';
import { appliedDirectContextPolicy, canonicalDirectDecision, directDecision } from './direct-context-fast-path.helpers.test.js';

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
        ...canonicalDirectDecision('capability-status'),
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

test('context follow-up protocol yields when backend generation is explicitly forced', () => {
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

test('direct context fast path reads only canonical harness contract decision', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Use current refs only and summarize.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      data: { markdown: 'Canonical current artifact has enough evidence.' },
    }],
    uiState: {
      directContextDecision: directDecision('context-summary', { decisionRef: 'decision:legacy-ui' }),
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        directContextDecision: directDecision('context-summary', { decisionRef: 'decision:legacy-policy' }),
        executionModePlan: {
          executionMode: 'direct-context-answer',
          directContextDecision: directDecision('context-summary', { decisionRef: 'decision:legacy-execution' }),
        },
        harnessContract: {
          directContextDecision: directDecision('context-summary', { decisionRef: 'decision:canonical' }),
        },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.match(String(payload.executionUnits[0]?.params ?? ''), /decision:canonical/);
  assert.doesNotMatch(String(payload.executionUnits[0]?.params ?? ''), /legacy-ui|legacy-policy|legacy-execution/);
});

test('legacy direct context decision paths do not authorize fast path without canonical harness contract', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Use current refs only and summarize.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      data: { markdown: 'Legacy artifact should not authorize this path.' },
    }],
    uiState: {
      directContextDecision: directDecision('context-summary', { decisionRef: 'decision:legacy-ui' }),
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        directContextDecision: directDecision('context-summary', { decisionRef: 'decision:legacy-policy' }),
        executionModePlan: {
          executionMode: 'direct-context-answer',
          directContextDecision: directDecision('context-summary', { decisionRef: 'decision:legacy-execution' }),
        },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
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
        ...canonicalDirectDecision(),
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
        ...canonicalDirectDecision('run-diagnostic', {
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
        failureReason: 'backend generation stopped by convergence guard.',
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
  assert.doesNotMatch(payload.message, /backend generation request registered/);
});

test('selected-reference direct context can produce a bounded planning register without AgentServer', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Answer-only from the selected ref: budget, timeline, and risk register. Do not run tools.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [],
    references: [{ ref: 'artifact:project-brief', title: 'Project brief' }],
    uiState: {
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary', {
          usedRefs: ['artifact:project-brief'],
          transformMode: 'answer-only-planning-register',
        }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
      currentReferenceDigests: [{
        sourceRef: 'artifact:project-brief',
        digestRef: '.sciforge/digests/project-brief.md',
        digestText: [
          '# Project Brief',
          '**Duration:** 12 months',
          '**Funding Request:** $250,000 direct costs',
          '## Deliverables',
          'D1 Curated dataset by month 6.',
          'D2 Adaptive marker ranking algorithm by month 8.',
          'D3 Validated marker panel by month 11.',
          'D4 Final report and repository by month 12.',
          '## Hard Constraints',
          'Budget cap: $250,000 total direct costs.',
          'Platform lock-in: Visium HD and Xenium for discovery; GeoMx DSP for validation.',
          'Timeline: 12 months fixed.',
          'Data sharing: raw sequencing data must be deposited in GEO.',
          '## Evidence Gaps',
          'RNA quality may fail in archival FFPE blocks.',
          'Validation cohort effect size may miss AUC acceptance criteria.',
        ].join('\n'),
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
  assert.equal(payload.executionUnits[0]?.status, 'done');
  assert.match(payload.message, /## Budget/);
  assert.match(payload.message, /\$72,000-\$98,000/);
  assert.match(payload.message, /## Timeline/);
  assert.match(payload.message, /Month 12/);
  assert.match(payload.message, /## Risk Register/);
  assert.match(payload.message, /Platform lock-in/);
});

test('selected-reference planning register applies current-turn constraint overrides', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Answer-only from the existing selected ref: change the hard constraint from 12 months / $250k to 9 months / $180k and assume no Xenium access. Update budget, timeline, risk register, and invalidated assumptions. Do not run tools.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [],
    references: [{ ref: 'artifact:project-brief', title: 'Project brief' }],
    uiState: {
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary', {
          usedRefs: ['artifact:project-brief'],
          transformMode: 'answer-only-planning-register',
        }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
      },
      currentReferenceDigests: [{
        sourceRef: 'artifact:project-brief',
        digestText: [
          '**Duration:** 12 months',
          '**Funding Request:** $250,000 direct costs',
          '## Deliverables',
          'D1 Visium HD and Xenium discovery dataset by month 6.',
          'D2 Adaptive marker ranking algorithm by month 8.',
          'D3 Validated marker panel by month 11.',
          '## Hard Constraints',
          'Budget cap: $250,000 total direct costs.',
          'Platform lock-in: Visium HD and Xenium for discovery; GeoMx DSP for validation.',
          'Timeline: 12 months fixed.',
        ].join('\n'),
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
  assert.match(payload.message, /Updated hard timeline: 9 months/);
  assert.match(payload.message, /Updated hard budget cap: \$180,000/);
  assert.match(payload.message, /no Xenium access/i);
  assert.match(payload.message, /Month 9/);
  assert.match(payload.message, /Original 12-month schedule is invalidated/);
  assert.match(payload.message, /Original \$250,000 funding assumption is invalidated/);
});

test('selected-reference artifact mutation with updated file paths routes to backend', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: [
      '基于我刚才选中的交付物继续，不要重新发散。',
      '现在关键约束改变：总预算从 120k USD 降到 80k USD，项目周期从 12 个月缩到 9 个月，仍然不能使用真实 patient data，团队人数不变。',
      '请更新所有受影响结论：brief 的 scope/success metrics、decision log、risk register 的 likelihood/impact/mitigation、timeline/budget。',
      '请明确列出哪些旧结论被替换，哪些保持不变，并给出更新后的 artifact/file 路径。',
    ].join(' '),
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'project-brief',
      type: 'research-report',
      metadata: { reportRef: '.sciforge/task-results/project-brief.md' },
    }],
    references: [{ ref: 'artifact:project-brief', title: 'Project brief' }],
    uiState: {
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary', {
          usedRefs: ['artifact:project-brief'],
          transformMode: 'answer-only-planning-register',
        }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
      },
      currentReferenceDigests: [{
        sourceRef: 'artifact:project-brief',
        digestText: [
          '**Duration:** 12 months',
          '**Funding Request:** $120,000 direct costs',
          'Budget cap: $120,000 total direct costs.',
          'Timeline: 12 months fixed.',
        ].join('\n'),
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.equal(payload, undefined);
});

test('reload selected-reference risk follow-up keeps unresolved risks without explicit transform mode', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'After reload, give the final version with unresolved risks from the selected ref. Do not run tools.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [],
    references: [{ ref: 'artifact:project-brief', title: 'Project brief' }],
    uiState: {
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary', {
          usedRefs: ['artifact:project-brief'],
        }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
      },
      currentReferenceDigests: [{
        sourceRef: 'artifact:project-brief',
        digestText: [
          '# Project Brief',
          '**Duration:** 9 months',
          '**Funding Request:** $180,000 direct costs',
          '## Deliverables',
          'D1 Visium HD discovery dataset by month 3.',
          'D2 Adaptive marker ranking algorithm by month 6.',
          'D3 Validated marker panel and final report by month 9.',
          '## Hard Constraints',
          'Budget cap: $180,000 total direct costs.',
          'Platform lock-in: Visium HD for discovery; no Xenium access; GeoMx DSP for validation.',
          'Timeline: 9 months fixed.',
          '## Evidence Gaps',
          'RNA quality may fail in archival FFPE blocks.',
          'Validation cohort effect size may miss AUC acceptance criteria.',
          'Xenium access removed; platform-dependent aims must be redesigned.',
        ].join('\n'),
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
  assert.equal(payload.executionUnits[0]?.status, 'done');
  assert.match(payload.message, /## Risk Register/);
  assert.match(payload.message, /R1:/);
  assert.match(payload.message, /R2:/);
  assert.match(payload.message, /R3:/);
  assert.match(payload.message, /RNA quality|Validation cohort|Xenium/i);
});

test('selected-reference direct context can draft a main document artifact without AgentServer', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Answer-only from the existing selected project brief: create the main grant proposal document artifact. Do not run tools.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [],
    references: [{ ref: 'artifact:project-brief', title: 'Project brief' }],
    uiState: {
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary', {
          usedRefs: ['artifact:project-brief'],
          transformMode: 'answer-only-document',
        }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
      },
      currentReferenceDigests: [{
        sourceRef: 'artifact:project-brief',
        digestText: [
          '# Project Brief: Adaptive Spatial Transcriptomics Markers for Early Pancreatic Cancer Detection',
          '**Duration:** 12 months',
          '**Funding Request:** $250,000 direct costs',
          'Specific Aim 1: identify spatially resolved transcriptomic signatures in PanIN lesions.',
          'Specific Aim 2: develop an adaptive marker selection algorithm.',
          'D1 Curated dataset by month 6.',
          'D2 Adaptive marker ranking algorithm by month 8.',
          'Budget cap: $250,000 total direct costs.',
          'Timeline: 12 months fixed.',
          'Evidence gap: RNA quality may fail in archival FFPE blocks.',
          'Acceptance criteria: final report and repository by month 12.',
        ].join('\n'),
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
  assert.equal(payload.executionUnits[0]?.status, 'done');
  assert.equal(payload.artifacts[0]?.type, 'research-report');
  assert.match(payload.message, /# Proposal: Adaptive Spatial Transcriptomics/);
  assert.match(payload.message, /## Specific Aims/);
  assert.match(payload.message, /## Evidence Gaps and Risks/);
  assert.doesNotMatch(payload.message, /backend generation request registered/);
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
        ...canonicalDirectDecision(),
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

test('provider status follow-up reuses current context without backend generation', () => {
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
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('capability-status', { usedRefs: ['artifact:fetch-example-com'] }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
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

test('referenced literature report follow-up summarizes flow matching conclusions from session artifact without AgentServer', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'sciforge-direct-context-literature-root-'));
  const workspaceRel = 'workspace/parallel/integration';
  const workspace = join(projectRoot, workspaceRel);
  const bundle = join(workspace, '.sciforge', 'sessions', '2026-05-17_literature_session-literature-report-followup');
  const artifactDir = join(bundle, 'artifacts');
  const taskResults = join(bundle, 'task-results', 'literature-metadata-recovery');
  await mkdir(artifactDir, { recursive: true });
  await mkdir(taskResults, { recursive: true });
  const reportRel = join(taskResults, 'research-report.md');
  const reportMarkdown = [
    '# 中文文献调研报告（provider recovery）',
    '',
    '## 候选论文与全文/PDF状态',
    '',
    '| title | year | venue | url | fullTextStatus | summary | limitations |',
    '|---|---|---|---|---|---|---|',
    '| FLUX: Geometry-Aware Longitudinal Flow Matching with Mixture of Experts | 2026-05-09T03:36:00Z |  | https://arxiv.org/abs/2605.08648v1 | PDF/full-text candidate link found via browser_fetch: https://arxiv.org/pdf/2605.08648v1 | Many biological systems evolve through continuous local dynamics while switching between latent regimes; unpaired longitudinal snapshots need geometry-aware flow matching. | Provider-grounded metadata package; citation/full-text verification should be run before strong scientific claims. |',
    '| PRiMeFlow: Capturing Complex Expression Heterogeneity in Perturbation Response Modelling | 2026-04-15T15:33:07Z |  | https://arxiv.org/abs/2604.13986v2 | PDF/full-text likely reachable from provider URL; not downloaded in this bounded run. | Predicting the effects of perturbations in-silico on cell state can identify drivers of cell behavior at scale; PRiMeFlow directly models genetic and small molecule perturbations in gene expression space. | Provider-grounded metadata package; citation/full-text verification should be run before strong scientific claims. |',
    '| Flow Matching for Count Data | 2026-05-08T13:53:37Z |  | https://arxiv.org/abs/2605.07746v1 | PDF/full-text candidate link found via browser_fetch: https://arxiv.org/pdf/2605.07746v1 | High-dimensional count data arise in single-cell RNA sequencing and neural spike trains; flow matching for count data extends generative modeling to discrete expression observations. | Provider-grounded metadata package; citation/full-text verification should be run before strong scientific claims. |',
  ].join('\n');
  await writeFile(reportRel, reportMarkdown);
  await writeFile(join(artifactDir, 'research-report.json'), JSON.stringify({
    id: 'research-report',
    type: 'research-report',
    path: reportRel,
    dataRef: reportRel,
    data: { markdown: reportMarkdown },
  }, null, 2));
  const previousEnv = process.env.SCIFORGE_WORKSPACE_PATH;
  process.env.SCIFORGE_WORKSPACE_PATH = workspaceRel;
  try {
    const request: GatewayRequest = {
      skillDomain: 'literature',
      workspacePath: projectRoot,
      prompt: '请基于我刚刚引用的 report artifact，用中文用三条 bullet 总结最相关的 flow matching / perturbation prediction 结论，并指出 PDF/full-text 状态。',
      artifacts: [],
      references: [],
      uiState: { sessionId: 'session-literature-report-followup' },
    };

    const enriched = await requestWithDirectContextReadableArtifactData(request);
    const payload = directContextFastPathPayload(enriched);

    assert.equal(enriched.artifacts[0]?.id, 'research-report');
    assert.ok(payload);
    assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
    assert.match(payload.message, /基于当前 report artifact 直接回答/);
    assert.match(payload.message, /FLUX/);
    assert.match(payload.message, /PRiMeFlow/);
    assert.match(payload.message, /Flow Matching for Count Data/);
    assert.match(payload.message, /PDF\/full-text 状态/);
    assert.doesNotMatch(payload.message, /AgentServer|workspace task was started/i);
  } finally {
    if (previousEnv === undefined) delete process.env.SCIFORGE_WORKSPACE_PATH;
    else process.env.SCIFORGE_WORKSPACE_PATH = previousEnv;
  }
});

test('selected literature report read-first follow-up is answered from report rows, not chart sufficiency template', () => {
  const reportMarkdown = [
    '# 中文文献调研报告（provider recovery）',
    '',
    'The report mentions chart review as a future visualization task, but the selected artifact is a markdown research report.',
    '',
    '## 候选论文与全文/PDF状态',
    '',
    '| title | year | venue | url | fullTextStatus | summary | limitations |',
    '|---|---|---|---|---|---|---|',
    '| FLUX: Geometry-Aware Longitudinal Flow Matching with Mixture of Experts | 2026-05-09T03:36:00Z | arXiv | https://arxiv.org/abs/2605.08648v1 | PDF/full-text candidate link found via browser_fetch: https://arxiv.org/pdf/2605.08648v1 | Many biological systems evolve through continuous local dynamics while switching between latent regimes; unpaired longitudinal snapshots need geometry-aware flow matching. | Provider-grounded metadata package; citation/full-text verification should be run before strong scientific claims. |',
    '| PRiMeFlow: Capturing Complex Expression Heterogeneity in Perturbation Response Modelling | 2026-04-15T15:33:07Z | arXiv | https://arxiv.org/abs/2604.13986v2 | PDF/full-text likely reachable from provider URL; not downloaded in this bounded run. | Predicting the effects of perturbations in-silico on cell state can identify drivers of cell behavior at scale; PRiMeFlow directly models genetic and small molecule perturbations in gene expression space. | Provider-grounded metadata package; citation/full-text verification should be run before strong scientific claims. |',
    '| Flow Matching for Count Data | 2026-05-08T13:53:37Z | arXiv | https://arxiv.org/abs/2605.07746v1 | PDF/full-text candidate link found via browser_fetch: https://arxiv.org/pdf/2605.07746v1 | High-dimensional count data arise in single-cell RNA sequencing and neural spike trains; flow matching for count data extends generative modeling to discrete expression observations. | Provider-grounded metadata package; citation/full-text verification should be run before strong scientific claims. |',
  ].join('\n');
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Use the selected research-report only; do not run a new search. Answer in Chinese: pick the 3 highest-priority papers to read first, with reason, evidence location, PDF/full-text status, and one limitation. Keep refs usable for another follow-up.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    expectedArtifactTypes: ['paper-list', 'evidence-matrix', 'research-report'],
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      data: { markdown: reportMarkdown },
    }],
    references: [{
      kind: 'artifact',
      ref: 'artifact:research-report',
      title: 'research-report',
    }],
    uiState: {
      conversationPolicy: appliedDirectContextPolicy(directDecision('context-summary', { usedRefs: ['artifact:research-report'] })),
      currentReferences: [{
        kind: 'artifact',
        ref: 'artifact:research-report',
        title: 'research-report',
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
  assert.match(payload.message, /优先阅读 1/);
  assert.match(payload.message, /FLUX/);
  assert.match(payload.message, /PRiMeFlow/);
  assert.match(payload.message, /Flow Matching for Count Data/);
  assert.match(payload.message, /证据位置：选中 report 的候选论文表/);
  assert.match(payload.message, /PDF\/full-text 状态/);
  assert.match(payload.message, /局限性/);
  assert.doesNotMatch(payload.message, /selected chart|single chart|A single chart|cannot by itself establish statistical significance/i);
  assert.deepEqual(payload.objectReferences?.map((reference) => reference.ref), ['artifact:research-report']);
});

test('selected literature report read-first follow-up can recover paper rows from json-like report context', () => {
  const reportText = JSON.stringify({
    papers: [{
      title: 'Provider search',
      summary: 'Called web_search; normalized 8 candidate records.',
    }, {
      title: 'PRiMeFlow: Capturing Complex Expression Heterogeneity in Perturbation Response Modelling',
      published: '2026-04-15T15:33:07Z',
      url: 'https://arxiv.org/abs/2604.13986v2',
      fullTextStatus: 'PDF/full-text likely reachable from provider URL; not downloaded in this bounded run.',
      summary: 'PRiMeFlow directly models genetic and small molecule perturbations in gene expression space using flow matching.',
      limitations: 'Provider-grounded metadata package; citation/full-text verification should be run before strong scientific claims.',
    }, {
      title: 'Flow Matching for Count Data',
      published: '2026-05-08T13:53:37Z',
      url: 'https://arxiv.org/abs/2605.07746v1',
      fullTextStatus: 'PDF/full-text candidate link found via browser_fetch: https://arxiv.org/pdf/2605.07746v1',
      summary: 'Flow matching for count data extends generative modeling to discrete single-cell expression observations.',
      limitations: 'Provider-grounded metadata package; citation/full-text verification should be run before strong scientific claims.',
    }, {
      title: 'MIOFlow 2.0: A unified framework for inferring cellular stochastic dynamics',
      published: '2026-03-23T20:49:45Z',
      url: 'https://arxiv.org/abs/2603.22564v2',
      fullTextStatus: 'PDF/full-text likely reachable from provider URL; not downloaded in this bounded run.',
      summary: 'MIOFlow 2.0 infers continuous cellular trajectories from single-cell and spatial transcriptomics snapshots.',
      limitations: 'Provider-grounded metadata package; citation/full-text verification should be run before strong scientific claims.',
    }],
  });
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'use research report only. no new search. answer in chinese. pick 3 priority papers to read first with reason, evidence location, pdf status, full text status, and one limitation.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      data: { markdown: reportText },
    }],
    references: [{
      kind: 'artifact',
      ref: 'artifact:research-report',
      title: 'research-report',
    }],
    uiState: {
      conversationPolicy: appliedDirectContextPolicy(directDecision('context-summary', { usedRefs: ['artifact:research-report'] })),
      currentReferences: [{
        kind: 'artifact',
        ref: 'artifact:research-report',
        title: 'research-report',
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.match(payload.message, /优先阅读 1/);
  assert.match(payload.message, /PRiMeFlow/);
  assert.match(payload.message, /Flow Matching for Count Data/);
  assert.match(payload.message, /证据位置/);
  assert.doesNotMatch(payload.message, /Provider search|Called web_search/);
  assert.doesNotMatch(payload.message, /Completion verdict|selected chart|single chart/i);
});

test('selected literature report read-first follow-up prioritizes extracted PDF rows with evidence pages', () => {
  const reportMarkdown = [
    '# 中文文献调研报告',
    '## 候选论文与全文/PDF状态',
    '| title | year | venue | url | fullTextStatus | evidenceLocation | summary | limitations |',
    '|---|---|---|---|---|---|---|---|',
    '| ShopGym: An Integrated Framework for Realistic Simulation and Scalable Benchmarking of E-Commerce Web Agents | 2026-05-15 |  | https://arxiv.org/abs/2605.16116 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.16116 | https://arxiv.org/pdf/2605.16116#page=1 | Developing and evaluating e-commerce web agents requires environments that preserve meaningful task structure while enabling controllable, reproducible, and scalable scientific comparison. | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
    '| ScreenSearch: Uncertainty-Aware OS Exploration | 2026-05-15 |  | https://arxiv.org/abs/2605.16024 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.16024 | https://arxiv.org/pdf/2605.16024#page=1 | Desktop GUI agents operate under partial observability; ScreenSearch frames the task as computer/OS state exploration before committing. | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
    '| PAGER: Bridging the Semantic-Execution Gap in Point-Precise Geometric GUI Control | 2026-05-15 |  | https://arxiv.org/abs/2605.15963 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.15963 | https://arxiv.org/pdf/2605.15963#page=1 | Large vision-language models have advanced GUI agents, but precise geometric construction requires point-accurate execution. | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
    '| SaaS-Bench: Can Computer-Use Agents Leverage Real-World SaaS to Solve Professional Workflows? | 2026-05-15 |  | https://arxiv.org/abs/2605.15777 | PDF/full-text candidate URL inferred from source: https://arxiv.org/pdf/2605.15777 | https://arxiv.org/abs/2605.15777 | arXiv:2605.15777 / published:2026-05-15 / pdf:https://arxiv.org/pdf/2605.15777 | Provider-grounded recovery package; citation/full-text verification should be run before strong scientific claims. |',
  ].join(' ');
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '基于刚才选中的research-report，不要启动新搜索。请选出最值得继续阅读全文的3篇，中文说明每篇为什么优先、PDF/全文状态、证据页码或URL、关键结论和局限性。',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      data: { markdown: reportMarkdown },
    }],
    references: [{
      kind: 'artifact',
      ref: 'artifact:research-report',
      title: 'research-report',
    }],
    uiState: {
      conversationPolicy: appliedDirectContextPolicy(directDecision('context-summary', { usedRefs: ['artifact:research-report'] })),
      currentReferences: [{
        kind: 'artifact',
        ref: 'artifact:research-report',
        title: 'research-report',
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.match(payload.message, /优先阅读 1：ShopGym/);
  assert.match(payload.message, /优先阅读 2：ScreenSearch/);
  assert.match(payload.message, /优先阅读 3：PAGER/);
  assert.match(payload.message, /evidence=https:\/\/arxiv\.org\/pdf\/2605\.16024#page=1/);
  assert.match(payload.message, /Desktop GUI agents operate under partial observability/);
  assert.doesNotMatch(payload.message, /理由：https:\/\/arxiv\.org\/abs/);
  assert.doesNotMatch(payload.message, /Known By Their Actions/);
});

test('selected literature report no-new-search follow-up overrides stale fresh-execution decision', () => {
  const reportMarkdown = [
    '# 中文文献调研报告',
    '## 候选论文与全文/PDF状态',
    '| title | year | venue | url | fullTextStatus | evidenceLocation | summary | limitations |',
    '|---|---|---|---|---|---|---|---|',
    '| ShopGym: An Integrated Framework for Realistic Simulation and Scalable Benchmarking of E-Commerce Web Agents | 2026-05-15 | arXiv | https://arxiv.org/abs/2605.16116 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.16116 | https://arxiv.org/pdf/2605.16116#page=1 | Developing and evaluating e-commerce web agents requires realistic, reproducible environments for controlled scientific comparison. | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
    '| ScreenSearch: Uncertainty-Aware OS Exploration | 2026-05-15 | arXiv | https://arxiv.org/abs/2605.16024 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.16024 | https://arxiv.org/pdf/2605.16024#page=1 | 2605.16024 | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
    '| PAGER: Bridging the Semantic-Execution Gap in Point-Precise Geometric GUI Control | 2026-05-15 | arXiv | https://arxiv.org/abs/2605.15963 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.15963 | https://arxiv.org/pdf/2605.15963#page=1 | 2605.15963 | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
  ].join('\n');
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '请再次基于刚才选中的research-report，不启动新搜索。选出最值得继续阅读全文的3篇，并用中文说明每篇为什么优先、PDF/全文状态、证据页码或URL、关键结论和局限性。',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      data: { markdown: reportMarkdown },
    }],
    uiState: {
      conversationPolicy: appliedDirectContextPolicy(directDecision('fresh-execution', {
        usedRefs: ['runtime://fresh-dispatch'],
      })),
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
  assert.match(payload.message, /不启动新的 workspace task，也不重新检索/);
  assert.match(payload.message, /优先阅读 1：ShopGym/);
  assert.match(payload.message, /优先阅读 2：ScreenSearch/);
  assert.match(payload.message, /优先阅读 3：PAGER/);
  assert.match(payload.message, /完成 bounded PDF 抽取并保留证据位置/);
  assert.doesNotMatch(payload.message, /理由：2605\.16024/);
});

test('prompt-named literature report wins over stale selected report context', () => {
  const goodReport = [
    '# 中文文献调研报告',
    '## 候选论文与全文/PDF状态',
    '| title | year | venue | url | fullTextStatus | evidenceLocation | summary | limitations |',
    '|---|---|---|---|---|---|---|---|',
    '| ShopGym: An Integrated Framework for Realistic Simulation and Scalable Benchmarking of E-Commerce Web Agents | 2026-05-15 | arXiv | https://arxiv.org/abs/2605.16116 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.16116 | https://arxiv.org/pdf/2605.16116#page=1 | Developing and evaluating e-commerce web agents requires realistic, reproducible environments for controlled scientific comparison. | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
    '| ScreenSearch: Uncertainty-Aware OS Exploration | 2026-05-15 | arXiv | https://arxiv.org/abs/2605.16024 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.16024 | https://arxiv.org/pdf/2605.16024#page=1 | Desktop GUI agents operate under partial observability and should explore uncertain OS state before committing actions. | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
    '| PAGER: Bridging the Semantic-Execution Gap in Point-Precise Geometric GUI Control | 2026-05-15 | arXiv | https://arxiv.org/abs/2605.15963 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.15963 | https://arxiv.org/pdf/2605.15963#page=1 | Point-precise geometric GUI control needs execution grounded in exact spatial operations, not only semantic labels. | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
  ].join('\n');
  const staleReport = [
    '# 中文文献调研报告（bad stale search）',
    '检索 provider：duckduckgo-html；provider query：bad stale query',
    '| title | year | venue | url | fullTextStatus | evidenceLocation | summary | limitations |',
    '|---|---|---|---|---|---|---|---|',
    '| Baidu - 百度一下，你就知道 | 2026 | web | //duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.baidu.com%2F | Full-text/PDF unavailable in this run because provider fetch failed; source URL retained for retry. | //duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.baidu.com%2F | 百度是全球领先的中文搜索引擎。 | Provider-grounded recovery package; citation/full-text verification should be run before strong scientific claims. |',
  ].join('\n');
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '基于 task-results/agentserver-generation-retry-literature-recovery-literature-b4b24737361b-research-report.md，不启动新搜索。选出最值得继续阅读全文的3篇，并用中文说明每篇为什么优先、PDF/全文状态、证据页码或URL、关键结论和局限性。',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'stale-report',
      type: 'research-report',
      dataRef: 'task-results/stale-duckduckgo-research-report.md',
      data: { markdown: staleReport },
    }, {
      id: 'research-report',
      type: 'research-report',
      dataRef: 'task-results/agentserver-generation-retry-literature-recovery-literature-b4b24737361b-research-report.md',
      data: { markdown: goodReport },
    }],
    references: [{
      kind: 'artifact',
      ref: 'artifact:stale-report',
      title: 'stale-duckduckgo-research-report.md',
    }],
    uiState: {
      conversationPolicy: appliedDirectContextPolicy(directDecision('context-summary', { usedRefs: ['artifact:stale-report'] })),
      currentReferences: [{
        kind: 'artifact',
        ref: 'artifact:stale-report',
        title: 'stale-duckduckgo-research-report.md',
      }],
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.match(payload.message, /优先阅读 1：ShopGym/);
  assert.match(payload.message, /优先阅读 2：ScreenSearch/);
  assert.match(payload.message, /优先阅读 3：PAGER/);
  assert.doesNotMatch(payload.message, /Baidu|duckduckgo-html|百度一下/);
});

test('contextProjection selected report with no-new-search hydrates session artifact and stays direct-context', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-context-projection-followup-'));
  try {
    const sessionDir = join(workspace, '.sciforge', 'sessions', '2026-05-18_literature-evidence-review_session-literature-evidence-review-session-context-proj');
    const reportRef = '.sciforge/sessions/2026-05-18_literature-evidence-review_session-literature-evidence-review-session-context-proj/task-results/research-report.md';
    const report = [
      '# 中文文献调研报告',
      '| title | year | venue | url | fullTextStatus | evidenceLocation | summary | limitations |',
      '|---|---|---|---|---|---|---|---|',
      '| ShopGym: An Integrated Framework for Realistic Simulation and Scalable Benchmarking of E-Commerce Web Agents | 2026-05-15 | arXiv | https://arxiv.org/abs/2605.16116 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.16116 | https://arxiv.org/pdf/2605.16116#page=1 | Developing and evaluating e-commerce web agents requires realistic, reproducible environments for controlled scientific comparison. | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
      '| ScreenSearch: Uncertainty-Aware OS Exploration | 2026-05-15 | arXiv | https://arxiv.org/abs/2605.16024 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.16024 | https://arxiv.org/pdf/2605.16024#page=1 | Desktop GUI agents operate under partial observability and should explore uncertain OS state before committing actions. | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
      '| PAGER: Bridging the Semantic-Execution Gap in Point-Precise Geometric GUI Control | 2026-05-15 | arXiv | https://arxiv.org/abs/2605.15963 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.15963 | https://arxiv.org/pdf/2605.15963#page=1 | Point-precise geometric GUI control needs execution grounded in exact spatial operations, not only semantic labels. | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
    ].join('\n');
    await mkdir(join(sessionDir, 'artifacts'), { recursive: true });
    await mkdir(join(sessionDir, 'task-results'), { recursive: true });
    await writeFile(join(workspace, reportRef), report, 'utf8');
    await writeFile(join(sessionDir, 'artifacts', 'research-report.json'), JSON.stringify({
      id: 'research-report',
      type: 'research-report',
      title: 'research-report',
      dataRef: reportRef,
      path: reportRef,
    }), 'utf8');
    const request: GatewayRequest = {
      skillDomain: 'literature',
      prompt: '基于刚才选中的research-report，不启动新搜索。请选出最值得继续阅读全文的3篇，中文说明每篇为什么优先、PDF/全文状态、证据页码或URL、关键结论和局限性。',
      workspacePath: workspace,
      agentServerBaseUrl: 'http://agentserver.example.test',
      artifacts: [],
      uiState: {
        sessionId: 'session-context-proj',
        contextProjection: {
          selectedContextRefs: ['artifact:research-report'],
          contextRefs: [{ ref: reportRef, kind: 'artifact' }],
        },
      },
    };

    const hydrated = await requestWithDirectContextReadableArtifactData(request);
    const payload = directContextFastPathPayload(hydrated);

    assert.ok(payload);
    assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
    assert.match(payload.message, /不启动新的 workspace task，也不重新检索/);
    assert.match(payload.message, /优先阅读 1：ShopGym/);
    assert.match(payload.message, /优先阅读 2：ScreenSearch/);
    assert.match(payload.message, /优先阅读 3：PAGER/);
    assert.doesNotMatch(payload.message, /duckduckgo|Baidu|百度一下/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('selected reference provenance path beats colliding generic artifact id in bounded report follow-up', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-selected-report-provenance-'));
  try {
    const goodRef = 'task-results/good-research-report.md';
    const staleRef = 'task-results/stale-research-report.md';
    const goodReport = [
      '# 中文文献调研报告',
      '| title | year | venue | url | fullTextStatus | evidenceLocation | summary | limitations |',
      '|---|---|---|---|---|---|---|---|',
      '| ShopGym: An Integrated Framework for Realistic Simulation and Scalable Benchmarking of E-Commerce Web Agents | 2026-05-15 | arXiv | https://arxiv.org/abs/2605.16116 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.16116 | https://arxiv.org/pdf/2605.16116#page=1 | Developing and evaluating e-commerce web agents requires realistic, reproducible environments for controlled scientific comparison. | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
      '| ScreenSearch: Uncertainty-Aware OS Exploration | 2026-05-15 | arXiv | https://arxiv.org/abs/2605.16024 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.16024 | https://arxiv.org/pdf/2605.16024#page=1 | Desktop GUI agents operate under partial observability and should explore uncertain OS state before committing actions. | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
      '| PAGER: Bridging the Semantic-Execution Gap in Point-Precise Geometric GUI Control | 2026-05-15 | arXiv | https://arxiv.org/abs/2605.15963 | PDF extracted via pdf_extract (pdftotext), page range 1-8, chars=14000; source https://arxiv.org/pdf/2605.15963 | https://arxiv.org/pdf/2605.15963#page=1 | Point-precise geometric GUI control needs execution grounded in exact spatial operations, not only semantic labels. | PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations. |',
    ].join('\n');
    await mkdir(join(workspace, 'task-results'), { recursive: true });
    await writeFile(join(workspace, goodRef), goodReport, 'utf8');
    await writeFile(join(workspace, staleRef), '# stale report\n\nNo PDF/full-text URL confirmed by provider metadata; Provider-grounded recovery package.', 'utf8');
    const request: GatewayRequest = {
      skillDomain: 'literature',
      prompt: '基于刚才选中的research-report，不启动新搜索。请选出最值得继续阅读全文的3篇，中文说明每篇为什么优先、PDF/全文状态、证据页码或URL、关键结论和局限性。',
      workspacePath: workspace,
      agentServerBaseUrl: 'http://agentserver.example.test',
      artifacts: [{
        id: 'research-report',
        type: 'research-report',
        dataRef: staleRef,
        data: { markdown: 'No PDF/full-text URL confirmed by provider metadata; Provider-grounded recovery package.' },
      }],
      references: [{
        id: 'ref-selected-report',
        kind: 'task-result',
        title: 'research-report',
        ref: 'artifact:research-report',
        payload: {
          currentReference: {
            id: 'obj-selected-report',
            kind: 'artifact',
            title: 'research-report',
            ref: 'artifact:research-report',
            artifactType: 'research-report',
            provenance: { dataRef: goodRef },
          },
          objectReference: {
            id: 'obj-selected-report',
            kind: 'artifact',
            title: 'research-report',
            ref: 'artifact:research-report',
            artifactType: 'research-report',
            provenance: { dataRef: goodRef },
          },
        },
      }],
      uiState: {
        conversationPolicy: appliedDirectContextPolicy(directDecision('context-summary', { usedRefs: ['artifact:research-report'] })),
        currentReferences: [],
      },
    };

    const hydrated = await requestWithDirectContextReadableArtifactData(request);
    const payload = directContextFastPathPayload(hydrated);

    assert.ok(payload);
    assert.match(payload.message, /不启动新的 workspace task，也不重新检索/);
    assert.match(payload.message, /优先阅读 1：ShopGym/);
    assert.match(payload.message, /优先阅读 2：ScreenSearch/);
    assert.match(payload.message, /优先阅读 3：PAGER/);
    assert.doesNotMatch(payload.message, /没有记录任何已经读取|No PDF\/full-text URL confirmed/);
    assert.doesNotMatch(JSON.stringify(payload.objectReferences ?? []), /stale-research-report/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
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
