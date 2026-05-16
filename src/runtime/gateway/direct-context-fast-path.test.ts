import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types.js';
import { directContextFastPathPayload, requestWithDirectContextReadableArtifactData } from './direct-context-fast-path.js';

function directDecision(
  intent: 'context-summary' | 'context-summary:risk' | 'context-summary:method' | 'context-summary:timeline' | 'run-diagnostic' | 'artifact-status' | 'capability-status' | 'fresh-execution' | 'unknown' = 'context-summary',
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

function appliedDirectContextPolicy(decision = directDecision()) {
  return {
    applicationStatus: 'applied',
    policySource: 'python-conversation-policy',
    directContextDecision: decision,
    harnessContract: { directContextDecision: decision },
    executionModePlan: { executionMode: 'direct-context-answer' },
    responsePlan: { initialResponseMode: 'direct-context-answer' },
    latencyPolicy: { blockOnContextCompaction: false },
  };
}

function canonicalDirectDecision(
  intent: 'context-summary' | 'context-summary:risk' | 'context-summary:method' | 'context-summary:timeline' | 'run-diagnostic' | 'artifact-status' | 'capability-status' | 'fresh-execution' | 'unknown' = 'context-summary',
  overrides: Record<string, unknown> = {},
) {
  return {
    harnessContract: {
      directContextDecision: directDecision(intent, overrides),
    },
    directContextDecision: directDecision(intent, overrides),
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
        ...canonicalDirectDecision('context-summary:risk'),
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
        ...canonicalDirectDecision('context-summary:risk'),
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

test('answer-only continuation transform returns checklist from prior visible answer context', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Continue previous answer: compress the three points into one checklist and explicitly reuse previous conclusion. No new search, no code.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    expectedArtifactTypes: ['paper-list', 'evidence-matrix', 'notebook-timeline'],
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      data: {
        markdown: 'Primer design checks GC content and Tm so primers bind stably. It screens hairpins and primer-dimers to avoid self-amplification. It checks specificity, often with BLAST, so the assay amplifies only the intended target.',
      },
      metadata: { reportRef: '.sciforge/task-results/research-report.md' },
    }],
    uiState: {
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary', {
          usedRefs: ['artifact:research-report'],
          transformMode: 'answer-only-checklist',
        }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
  assert.match(payload.message, /Checklist from the previous visible answer/);
  assert.match(payload.message, /GC content and Tm/);
  assert.match(payload.message, /hairpins and primer-dimers/);
  assert.match(payload.message, /specificity/);
  const displayIntent = payload.displayIntent;
  assert.ok(displayIntent);
  assert.equal(displayIntent.taskOutcome, 'satisfied');
  assert.doesNotMatch(payload.message, /sciforge\.agentserver|generated workspace task/i);
});

test('bounded previous evidence-matrix follow-up uses direct-context hypotheses without AgentServer policy', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Based only on the previous evidence matrix, compress it into 3 testable hypotheses with supporting rows, minimal validation experiment, and failure mode. Do not perform a new search.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'evidence-matrix-provider-recovery',
      type: 'evidence-matrix',
      data: {
        rows: [
          {
            claim: 'Spatial Analysis of Intraductal Papillary Mucinous Neoplasms defines a Keratin 17-positive epithelial population.',
            method: 'spatial analysis in pancreatic precursor lesions',
            'main result': 'PMID:41638478',
            limitations: 'metadata-only provider result',
            'citation/ref': 'doi:10.1016/j.jcmgh.2026.101749',
          },
          {
            claim: 'Integrative multimodal transcriptomics identifies a cancer-associated fibroblast membrane signature.',
            method: 'multimodal transcriptomics / CAF analysis',
            'main result': 'PMID:41942785',
            limitations: 'requires full-text verification',
            'citation/ref': 'doi:10.1007/s00109-026-02669-7',
          },
          {
            claim: 'Spatially-resolved subtype progression reveals metabolic vulnerabilities in pancreatic ductal adenocarcinoma.',
            method: 'spatial subtype and metabolic-state analysis',
            'main result': 'PMID:41896850',
            limitations: 'platform transfer risk',
            'citation/ref': 'doi:10.1186/s12943-026-02628-3',
          },
        ],
      },
    }],
    uiState: {},
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
  assert.match(payload.message, /Answered directly from the existing evidence matrix/);
  assert.match(payload.message, /Hypothesis 1/);
  assert.match(payload.message, /Minimal validation experiment/i);
  assert.match(payload.message, /Main failure mode/i);
  assert.match(payload.message, /41638478|10\.1016/);
});

test('bounded previous evidence-matrix follow-up hydrates artifacts from session bundle', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-direct-context-session-'));
  const bundle = join(workspace, '.sciforge', 'sessions', '2026-05-16_literature-evidence-review_session-literature-evidence-review-test');
  await mkdir(join(bundle, 'records'), { recursive: true });
  await mkdir(join(bundle, 'artifacts'), { recursive: true });
  await writeFile(join(bundle, 'records', 'session.json'), JSON.stringify({
    sessionId: 'session-literature-evidence-review-test',
    scenarioId: 'literature-evidence-review',
    artifacts: [],
  }, null, 2));
  await writeFile(join(bundle, 'artifacts', 'evidence-matrix-provider-recovery.json'), JSON.stringify({
    id: 'evidence-matrix-provider-recovery',
    type: 'evidence-matrix',
    data: {
      rows: [{
        claim: 'Spatial Analysis of Intraductal Papillary Mucinous Neoplasms defines a Keratin 17-positive epithelial population.',
        method: 'spatial analysis in pancreatic precursor lesions',
        'main result': 'PMID:41638478',
        limitations: 'metadata-only provider result',
        'citation/ref': 'doi:10.1016/j.jcmgh.2026.101749',
      }],
    },
  }, null, 2));

  const request: GatewayRequest = {
    skillDomain: 'literature',
    workspacePath: workspace,
    prompt: 'Based only on the previous evidence matrix artifact, compress it into 3 testable hypotheses with supporting rows, minimal validation experiment, and failure mode. Do not perform a new search.',
    artifacts: [],
    uiState: { sessionId: 'session-literature-evidence-review-test' },
  };

  const enriched = await requestWithDirectContextReadableArtifactData(request);
  const payload = directContextFastPathPayload(enriched);

  assert.equal(enriched.artifacts[0]?.id, 'evidence-matrix-provider-recovery');
  assert.ok(payload);
  assert.match(payload.message, /Hypothesis 1/);
  assert.match(payload.message, /41638478|10\.1016/);
});

test('harness transformMode drives answer-only compression without prompt regex', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Please make this terse from the already visible material.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    expectedArtifactTypes: ['paper-list'],
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      data: {
        markdown: 'The prior conclusion says assay specificity is the main constraint. Primer-dimer risk is secondary. Reuse the validated target region.',
      },
    }],
    uiState: {
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary', {
          usedRefs: ['artifact:research-report'],
          transformMode: 'answer-only-compress',
        }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.match(payload.message, /Direct answer from the previous visible answer/);
  assert.match(payload.message, /assay specificity/);
  assert.equal(payload.executionUnits[0]?.status, 'done');
});

test('structured method summary intent selects method snippets without prompt domain regex', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Give me a short recap.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'method-note',
      type: 'research-report',
      data: {
        markdown: 'Method: retrieve seed papers, screen abstracts, then extract evidence tables. Risk: source coverage can drift if provider routes change.',
      },
    }],
    uiState: {
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary:method', { usedRefs: ['artifact:method-note'] }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
      },
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.match(payload.message, /retrieve seed papers/);
  assert.doesNotMatch(payload.message, /source coverage can drift/);
});

test('visible analysis report follow-up reads bounded report body and answers the scientific question', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-direct-context-'));
  const reportRel = 'analysis_report.md';
  await writeFile(join(workspace, reportRel), [
    '# Simulated Experiment Analysis Report',
    '## Treatment Effect',
    '- control mean = 109.66; drugA mean = 122.06.',
    '- Cohen’s d = 1.029, indicating a large positive drugA effect.',
    '- Two-way ANOVA treatment p = 1.1474e-04; reject H0.',
    '## Batch and Timepoint',
    '- Batch was modeled as a fixed effect with means B1 = 115.7, B2 = 114.4, B3 = 117.46.',
    '- Timepoint means were 0h = 106.95, 24h = 112.84, 48h = 127.78.',
    '## Limitations',
    '- No interaction terms (treatment×batch, treatment×timepoint) included.',
    '- Mixed models may be more appropriate for batch as random.',
    '- Normality and homogeneity of variances are assumed.',
  ].join('\n'));
  const request: GatewayRequest = {
    skillDomain: 'omics',
    workspacePath: workspace,
    prompt: 'Based on the visible analysis report from Round 1, explain the main conclusion of the treatment effect. Identify batch/timepoint confounders and propose three robustness checks.',
    artifacts: [{
      id: 'analysis-report',
      type: 'research-report',
      metadata: { reportRef: reportRel },
    }],
    uiState: {
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary', { usedRefs: ['artifact:analysis-report'] }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
    },
  };

  const enriched = await requestWithDirectContextReadableArtifactData(request);
  const payload = directContextFastPathPayload(enriched);

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
  assert.match(payload.message, /Cohen/);
  assert.match(payload.message, /1\.1474e-04/);
  assert.match(payload.message, /Batch/);
  assert.match(payload.message, /interaction/i);
  assert.doesNotMatch(payload.message, /^Summary from the selected reference/m);
});

test('answer-only continuation transform ignores unreadable digest and path-only refs', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Compress the previous answer into a three-item checklist. Use only the previous answer; no search, no code.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      metadata: { reportRef: '.sciforge/task-results/research-report.md' },
    }],
    references: [{
      kind: 'artifact',
      ref: 'artifact:research-report',
      title: 'research report',
      summary: 'artifact:research-report',
    }],
    uiState: {
      currentReferenceDigests: [{
        sourceRef: 'artifact:research-report',
        digestText: 'Reference path was not readable inside the workspace.',
      }],
      claims: [{
        id: 'claim-visible-answer',
        type: 'answer',
        text: 'ConversationProjection is authoritative. It keeps visible results auditable. It prevents stale raw backend output from competing with the final answer.',
      }],
      recentExecutionRefs: [{
        id: 'agentserver-direct',
        outputRef: '.sciforge/task-results/agentserver-direct.json',
        stdoutRef: '.sciforge/logs/agentserver.stdout.log',
      }],
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary', {
          usedRefs: ['artifact:research-report', 'claim:claim-visible-answer'],
        }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.match(payload.message, /ConversationProjection is authoritative/);
  assert.match(payload.message, /visible results auditable/);
  assert.match(payload.message, /prevents stale raw backend output/);
  assert.doesNotMatch(payload.message, /Reference path was not readable/);
  assert.doesNotMatch(payload.message, /\.sciforge/);
});

test('selected artifact summary uses structured artifact data instead of unreadable artifact ref digest', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'use selected artifact only no rerun no tools summarize what it says in five bullets',
    agentServerBaseUrl: 'http://agentserver.example.test',
    references: [{
      kind: 'artifact',
      ref: 'artifact:research-report-kras-g12d',
      title: 'research-report-kras-g12d',
      summary: 'artifact:research-report-kras-g12d',
    }],
    artifacts: [{
      id: 'research-report-kras-g12d',
      type: 'research-report',
      dataRef: '.sciforge/sessions/session-a/artifacts/research-report-kras-g12d.json',
      data: {
        summary: 'KRAS G12D evidence centers on allele-specific biology and downstream MAPK signaling.',
        keyFindings: [
          'Covalent and non-covalent inhibitor programs should be separated when comparing evidence.',
          'Preclinical context should not be presented as clinical efficacy.',
          'The selected report calls for paper-level retrieval before comprehensive claims.',
        ],
        conclusion: 'The selected artifact is a bounded evidence framing report, not a full systematic review.',
      },
    }],
    uiState: {
      currentReferences: [{
        kind: 'artifact',
        ref: 'artifact:research-report-kras-g12d',
        title: 'research-report-kras-g12d',
      }],
      currentReferenceDigests: [{
        sourceRef: 'artifact:research-report-kras-g12d',
        status: 'unresolved',
        digestText: 'Reference path was not readable inside the workspace.',
      }],
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary', {
          usedRefs: ['artifact:research-report-kras-g12d'],
        }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.match(payload.message, /Summary from the selected reference/);
  assert.match(payload.message, /KRAS G12D evidence centers/);
  assert.match(payload.message, /Preclinical context should not be presented as clinical efficacy/);
  assert.doesNotMatch(payload.message, /Reference path was not readable/);
});

test('selected artifact summary ignores unrelated current-run diagnostic claims', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'use selected artifact only no rerun no tools summarize what it says in five bullets',
    agentServerBaseUrl: 'http://agentserver.example.test',
    references: [{
      kind: 'artifact',
      ref: 'artifact:research-report-kras-g12d',
      title: 'research-report-kras-g12d',
      summary: 'paper-list',
      payload: {
        currentReference: {
          id: 'artifact:research-report-kras-g12d',
          ref: 'artifact:research-report-kras-g12d',
          title: 'research-report-kras-g12d',
        },
      },
    }],
    artifacts: [{
      id: 'research-report-kras-g12d',
      type: 'research-report',
      data: {
        summary: 'KRAS G12D report compares mutation prevalence, inhibitor evidence, and evidence limitations.',
        keyFindings: [
          'KRAS G12D is discussed across pancreatic, colorectal, and lung cancer contexts.',
          'MRTX1133 and related inhibitor programs are framed as emerging preclinical evidence.',
          'Combination therapy hypotheses need paper-level verification before strong clinical claims.',
        ],
        conclusion: 'The selected artifact is an evidence framing report with explicit limitations.',
      },
    }, {
      id: 'artifact-summary-bullets',
      type: 'runtime-context-summary',
      data: {
        markdown: 'Selected Artifact Summary\nThe selected artifact content was not available in the workspace.',
      },
    }],
    uiState: {
      claims: [{
        id: 'claim-unreadable',
        type: 'prediction',
        text: 'Reference path was not readable inside the workspace.',
      }, {
        id: 'claim-prior-summary',
        type: 'prediction',
        text: 'Selected Artifact Summary\nThe selected artifact content was not available in the workspace.',
      }],
      currentReferenceDigests: [{
        sourceRef: 'artifact:research-report-kras-g12d',
        status: 'unresolved',
        digestText: 'Reference path was not readable inside the workspace.',
      }],
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary', {
          usedRefs: ['artifact:research-report-kras-g12d'],
        }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.match(payload.message, /Summary from the selected reference/);
  assert.match(payload.message, /mutation prevalence/);
  assert.match(payload.message, /MRTX1133/);
  assert.doesNotMatch(payload.message, /Reference path was not readable/);
  assert.doesNotMatch(payload.message, /content was not available/);
});

test('selected workspace file summary can come from current ui references without top-level references', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Use the selected patch report only. No rerun, no tools. Write a PR summary and risk checklist.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    references: [],
    artifacts: [{
      id: 'runtime-diagnostic',
      type: 'runtime-diagnostic',
      data: {
        markdown: 'Generated workspace task failed before producing the requested report.',
      },
    }],
    uiState: {
      currentReferences: [{
        kind: 'file',
        ref: 'file:workspace/parallel/p4/rcg-004-preflight-patch-report.md',
        title: 'rcg-004-preflight-patch-report.md',
        payload: {
          selectedText: [
            'Patch Summary: generatedTaskPayloadPreflightForTaskInput now preserves stable issue id, kind, and clipped evidence.',
            'Risk checklist: verify current-reference gate false positives and selected-file direct-context follow-up in browser.',
          ].join(' '),
        },
      }],
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary', {
          usedRefs: ['file:workspace/parallel/p4/rcg-004-preflight-patch-report.md'],
        }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.match(payload.message, /Summary from the selected reference/);
  assert.match(payload.message, /preserves stable issue id, kind, and clipped evidence/);
  assert.match(payload.message, /selected-file direct-context follow-up/);
  assert.doesNotMatch(payload.message, /Generated workspace task failed/);
});

test('selected reproduction report credibility follow-up does not become a planning register', () => {
  const reportMarkdown = [
    '# Logistic Growth ODE Parameter Estimation Reproduction Report',
    '',
    'Reproduction success: YES',
    '',
    '| parameter | true | fitted | percent error |',
    '| --- | ---: | ---: | ---: |',
    '| r | 0.5000 | 0.4767 | 4.67% |',
    '| K | 200.0 | 201.5 | 0.77% |',
    '',
    'RMSE: 4.3505',
    '',
    'This is a toy synthetic noisy logistic-growth reproduction with a fixed seed.',
  ].join('\n');
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Using only the selected reproduction report, tell me whether this toy reproduction is credible. List the exact metrics that support the verdict, the biggest remaining risk, and one next validation step. Do not use unrelated previous diagnostics.',
    agentServerBaseUrl: 'http://agentserver.example.test',
    references: [],
    artifacts: [],
    uiState: {
      currentReferences: [{
        kind: 'file',
        ref: 'file:workspace/parallel/p3/generated-literature-8ef4985b7dc3-reproduction-report.md',
        title: 'generated-literature-8ef4985b7dc3-reproduction-report.md',
        payload: { selectedText: reportMarkdown },
      }],
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary', {
          usedRefs: ['file:workspace/parallel/p3/generated-literature-8ef4985b7dc3-reproduction-report.md'],
        }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.match(payload.message, /Answered directly from the selected report/);
  assert.match(payload.message, /Reproduction success: YES/);
  assert.match(payload.message, /r true 0\.5000, fitted 0\.4767, error 4\.67%/);
  assert.match(payload.message, /K true 200\.0, fitted 201\.5, error 0\.77%/);
  assert.match(payload.message, /RMSE 4\.3505/);
  assert.match(payload.message, /synthetic data|fixed seed|toy setup/);
  assert.match(payload.message, /multiple random seeds and noise levels/);
  assert.doesNotMatch(payload.message, /Planning register/);
  assert.doesNotMatch(payload.message, /## Budget/);
});

test('selected metadata-only literature report answers full-text status from selected artifact only', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '只基于我刚刚选中的 research-report-provider-recovery 报告回答：这份报告实际读取了哪些 arXiv PDF/全文证据？哪些没有读取或未验证？它能否支持“全文调研已完成”的结论？请不要使用未选中的历史消息、其它 artifact 或外部新检索。',
    agentServerBaseUrl: 'http://agentserver.example.test',
    references: [],
    artifacts: [{
      id: 'research-report-provider-recovery',
      type: 'research-report',
      data: {
        markdown: 'Recovered through the SciForge web_search provider route and produced an evidence matrix with 8 candidate evidence items. Treat rows as provider-grounded metadata until full-text verification.',
      },
    }, {
      id: 'latest-unselected-report',
      type: 'research-report',
      data: {
        markdown: 'UNSELECTED: arXiv:2501.00001 PDF was read and full-text verification completed.',
      },
    }],
    uiState: {
      claims: [{
        id: 'claim-unselected-fulltext',
        type: 'prediction',
        text: 'UNSELECTED claim says full-text research completed.',
      }],
      currentReferences: [{
        kind: 'artifact',
        ref: 'artifact:research-report-provider-recovery',
        title: 'research-report-provider-recovery',
      }],
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        ...canonicalDirectDecision('context-summary', {
          usedRefs: ['artifact:research-report-provider-recovery'],
        }),
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
        latencyPolicy: { blockOnContextCompaction: false },
      },
    },
  };

  const payload = directContextFastPathPayload(request);

  assert.ok(payload);
  assert.match(payload.message, /只基于当前选中的 research-report-provider-recovery/);
  assert.match(payload.message, /没有记录任何已经读取、下载或验证过的 arXiv PDF\/全文证据/);
  assert.match(payload.message, /不能支持“全文调研已完成”/);
  assert.match(payload.message, /provider-grounded metadata/);
  assert.doesNotMatch(payload.message, /上一轮可见答案/);
  assert.doesNotMatch(payload.message, /2501\.00001|UNSELECTED|full-text research completed/);
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
