import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AgentStreamEvent } from './domain';
import { assistantDraftDeltaFromStreamEvent, assistantDraftFromStreamEvents, coalesceStreamEvents, latestRunningEvent, presentStreamEvent, presentStreamWorklog, streamEventCounts } from './streamEventPresentation';
import { RunningWorkProcess, visibleRunningWorkEntries } from './app/chat/RunningWorkProcess';
import { normalizeWorkspaceRuntimeEvent } from './api/sciforgeToolsClient/runtimeEvents';

function event(partial: Partial<AgentStreamEvent>): AgentStreamEvent {
  return {
    id: partial.id ?? `evt-${partial.type ?? 'test'}`,
    type: partial.type ?? 'event',
    label: partial.label ?? partial.type ?? 'event',
    createdAt: partial.createdAt ?? '2026-05-02T00:00:00.000Z',
    ...partial,
  };
}

test('usage updates stay in background instead of becoming visible work content', () => {
  const usageEvent = event({
    type: 'usage-update',
    label: 'AgentServer usage-update',
    usage: { input: 178_700, output: 2_318, total: 181_018, provider: 'codex', source: 'model-provider' },
  });
  const presentation = presentStreamEvent(usageEvent);

  assert.equal(presentation.importance, 'background');
  assert.equal(presentation.initiallyCollapsed, true);
  assert.equal(presentation.visibleInRunningMessage, false);
  assert.equal(streamEventCounts([usageEvent]).background, 1);
});

test('context warnings and repair events stay visible as key work status', () => {
  const contextEvent = event({
    type: 'contextWindowState',
    label: '上下文窗口',
    contextWindowState: {
      source: 'native',
      status: 'near-limit',
      usedTokens: 180_000,
      windowTokens: 200_000,
      ratio: 0.9,
      backend: 'codex',
    },
  });
  const repairEvent = event({
    type: 'acceptance-repair-start',
    label: '验收修复',
    detail: 'TurnAcceptanceGate 触发一次 backend artifact/execution repair rerun。',
  });

  assert.equal(presentStreamEvent(contextEvent).importance, 'key');
  assert.equal(presentStreamEvent(contextEvent).initiallyCollapsed, false);
  assert.equal(presentStreamEvent(repairEvent).visibleInRunningMessage, true);
  assert.match(latestRunningEvent([contextEvent, repairEvent]) || '', /TurnAcceptanceGate/);
});

test('text deltas coalesce and remain folded as background process detail', () => {
  const events = coalesceStreamEvents(
    [event({ id: 'delta-1', type: 'text-delta', label: '生成内容', detail: '正在读取' })],
    event({ id: 'delta-2', type: 'text-delta', label: '生成内容', detail: '文件。' }),
  );
  const presentation = presentStreamEvent(events[0]);

  assert.equal(events.length, 1);
  assert.match(events[0].detail || '', /正在读取 文件。|正在读取文件。/);
  assert.equal(presentation.importance, 'background');
  assert.equal(presentation.initiallyCollapsed, true);
  assert.equal(latestRunningEvent(events), '后台正在探索或执行，过程日志已折叠。');
});

test('assistant draft extracts natural language text deltas but skips task JSON', () => {
  const draft = assistantDraftFromStreamEvents([
    event({ id: 'delta-1', type: 'text-delta', label: '生成内容', detail: '已确认收到，' }),
    event({ id: 'delta-2', type: 'text-delta', label: '生成内容', detail: '当前正在整理结果。' }),
    event({
      id: 'task-json',
      type: 'text-delta',
      label: '生成内容',
      detail: '{"taskFiles":[{"path":"tasks/report.py","content":"print(1)"}],"entrypoint":{"path":"tasks/report.py"}}',
    }),
  ]);

  assert.match(draft, /已确认收到/);
  assert.match(draft, /当前正在整理结果/);
  assert.doesNotMatch(draft, /taskFiles/);
});

test('assistant draft can use output events when they contain natural language', () => {
  assert.equal(assistantDraftDeltaFromStreamEvent(event({
    type: 'output',
    label: '输出',
    detail: '这里是运行中的自然语言草稿。',
  })), '这里是运行中的自然语言草稿。');
  assert.equal(assistantDraftDeltaFromStreamEvent(event({
    type: 'output',
    label: '输出',
    detail: '{"message":"structured payload"}',
  })), '');
});

test('script generation and write-file events stay visible in the running chat message', () => {
  const generationEvent = event({
    type: 'text-delta',
    label: '思考',
    detail: '{"taskFiles":[{"path":"tasks/arxiv_agent_literature_review.py","language":"python","content":"print(1)"}],"entrypoint":{"path":"tasks/arxiv_agent_literature_review.py"}}',
  });
  const writeEvent = event({
    type: 'tool-call',
    label: '调用 write_file',
    detail: '{"path":"/workspace/tasks/arxiv_agent_literature_review.py","content":"#!/usr/bin/env python3\\nprint(1)"}',
    raw: {
      type: 'tool-call',
      toolName: 'write_file',
      detail: '{"path":"/workspace/tasks/arxiv_agent_literature_review.py","content":"#!/usr/bin/env python3\\nprint(1)"}',
    },
  });

  const generation = presentStreamEvent(generationEvent);
  const write = presentStreamEvent(writeEvent);

  assert.equal(generation.importance, 'key');
  assert.equal(generation.visibleInRunningMessage, true);
  assert.match(generation.typeLabel, /生成脚本/);
  assert.equal(write.importance, 'key');
  assert.equal(write.visibleInRunningMessage, true);
  assert.match(write.typeLabel, /写入脚本/);
  assert.match(write.detail, /arxiv_agent_literature_review\.py/);
  assert.match(latestRunningEvent([generationEvent, writeEvent]) || '', /正在写入脚本/);
});

test('AgentServer task file payloads show as concise write work instead of raw searched JSON', () => {
  const generationResult = event({
    id: 'agentserver-taskfiles',
    type: 'tool-result',
    label: 'AgentServer 状态',
    detail: JSON.stringify({
      kind: 'AgentServerGenerationResponse',
      taskFiles: [{
        path: 'tasks/literature/ai_virtual_cell_report.py',
        language: 'python',
        content: 'SEARCH_TERM = "AI virtual cell"',
      }],
      notes: '检索最近一周 AI + 虚拟细胞文章并生成报告。',
    }),
  });

  const worklog = presentStreamWorklog([generationResult]);

  assert.equal(worklog.operationCounts.write, 1);
  assert.equal(worklog.operationCounts.search, 0);
  assert.match(worklog.entries[0].operationLine, /^Wrote 生成任务文件：tasks\/literature\/ai_virtual_cell_report\.py/);
  assert.doesNotMatch(worklog.entries[0].operationLine, /SEARCH_TERM/);
});

test('process-progress events expose read write wait and next step details', () => {
  const processEvent = event({
    type: 'process-progress',
    label: '过程',
    detail: '正在等待 AgentServer 返回',
    raw: {
      progress: {
        phase: 'wait',
        title: '正在等待 AgentServer 返回',
        reading: ['/workspace/input/papers.csv'],
        writing: ['/workspace/tasks/review.py'],
        waitingFor: 'AgentServer 返回',
        nextStep: '收到新事件后继续执行。',
      },
    },
  });

  const presentation = presentStreamEvent(processEvent);

  assert.equal(presentation.importance, 'key');
  assert.equal(presentation.visibleInRunningMessage, true);
  assert.match(presentation.detail, /正在读：\/workspace\/input\/papers\.csv/);
  assert.match(presentation.detail, /正在写：\/workspace\/tasks\/review\.py/);
  assert.match(presentation.detail, /下一步：收到新事件后继续执行/);
});

test('structured interaction progress fields drive presentation without prompt or scenario semantics', () => {
  const normalized = normalizeWorkspaceRuntimeEvent({
    schemaVersion: 'sciforge.interaction-progress-event.v1',
    type: 'process-progress',
    phase: 'verification',
    status: 'completed',
    importance: 'low',
    reason: 'budget-watch',
    budget: {
      elapsedMs: 1200,
      remainingMs: 800,
      retryCount: 1,
      maxRetries: 2,
      maxWallMs: 5000,
    },
    prompt: 'PROMPT_TEXT_SHOULD_NOT_DECIDE search write failed approval',
    scenario: 'SCENARIO_TEXT_SHOULD_NOT_DECIDE retrieval repair blocked',
    message: 'NATURAL_LANGUAGE_FALLBACK_SHOULD_NOT_DECIDE search write failed approval',
  });

  const presentation = presentStreamEvent(normalized);
  const worklog = presentStreamWorklog([normalized]);
  const entry = worklog.entries[0];

  assert.equal(presentation.importance, 'background');
  assert.equal(presentation.tone, 'success');
  assert.equal(presentation.visibleInRunningMessage, false);
  assert.match(presentation.detail, /Phase: verification/);
  assert.match(presentation.detail, /Status: completed/);
  assert.match(presentation.detail, /Reason: budget-watch/);
  assert.match(presentation.detail, /Budget: elapsed 1200ms, remaining 800ms, retries 1\/2, max wall 5000ms/);
  assert.doesNotMatch(presentation.detail, /PROMPT_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(presentation.detail, /SCENARIO_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(presentation.detail, /NATURAL_LANGUAGE_FALLBACK_SHOULD_NOT_DECIDE/);
  assert.equal(entry.operationKind, 'validate');
  assert.match(entry.operationLine, /^Validated Phase: verification/);
  assert.equal(worklog.operationCounts.validate, 1);
  assert.match(worklog.summary, /1 验证/);
});

test('cursor-like worklog fixture summarizes operations and keeps raw output second-level collapsed', () => {
  const events = [
    event({
      id: 'context',
      type: 'contextWindowState',
      label: '上下文窗口',
      contextWindowState: {
        source: 'native',
        status: 'healthy',
        usedTokens: 6_700,
        windowTokens: 200_000,
        ratio: 0.03,
        backend: 'codex',
      },
    }),
    event({
      id: 'plan',
      type: 'run-plan',
      label: '计划',
      detail: 'Plan: implement via codex',
    }),
    event({
      id: 'status',
      type: 'status',
      label: 'AgentServer 状态',
      detail: 'Calling local model',
    }),
    event({
      id: 'explore',
      type: 'tool-call',
      label: 'List candidates',
      detail: 'ls workspace/tasks/generated-literature',
      raw: { toolName: 'run_command', detail: 'ls workspace/tasks/generated-literature' },
    }),
    event({
      id: 'search',
      type: 'tool-call',
      label: 'Search workspace',
      detail: 'rg -n "RunningWorkProcess" src/ui/src',
      raw: { toolName: 'run_command', detail: 'rg -n "RunningWorkProcess" src/ui/src' },
    }),
    event({
      id: 'read',
      type: 'tool-call',
      label: 'Read file',
      detail: 'sed -n 1,220p src/ui/src/app/chat/RunningWorkProcess.tsx',
      raw: { toolName: 'run_command', detail: 'sed -n 1,220p src/ui/src/app/chat/RunningWorkProcess.tsx' },
    }),
    event({
      id: 'write',
      type: 'tool-call',
      label: 'Edit file',
      detail: 'apply patch to streamEventPresentation.ts',
      raw: { toolName: 'apply_patch', detail: '*** Update File: streamEventPresentation.ts' },
    }),
    event({
      id: 'command',
      type: 'tool-call',
      label: 'Run tests',
      detail: 'npm run typecheck -- --pretty false',
      raw: { toolName: 'run_command', detail: 'npm run typecheck -- --pretty false' },
    }),
    event({
      id: 'wait',
      type: 'process-progress',
      label: 'Waiting',
      detail: 'HTTP stream still waiting for backend events',
      raw: {
        progress: {
          phase: 'wait',
          title: '等待后端事件',
          waitingFor: 'backend stream',
          nextStep: '继续监听或安全中止',
        },
      },
    }),
  ];

  const worklog = presentStreamWorklog(events, { guidanceCount: 1 });

  assert.equal(worklog.initiallyCollapsed, true);
  assert.match(worklog.summary, /1 探索/);
  assert.match(worklog.summary, /1 搜索/);
  assert.match(worklog.summary, /1 读取/);
  assert.match(worklog.summary, /1 写入/);
  assert.match(worklog.summary, /1 执行/);
  assert.match(worklog.summary, /1 等待/);
  assert.match(worklog.summary, /1 引导/);
  assert.equal(worklog.operationCounts.explore, 1);
  assert.equal(worklog.operationCounts.search, 1);
  assert.equal(worklog.operationCounts.read, 1);
  assert.equal(worklog.operationCounts.write, 1);
  assert.equal(worklog.operationCounts.command, 1);
  assert.equal(worklog.operationCounts.wait, 1);
  assert.deepEqual(worklog.entries.map((entry) => entry.operationKind), ['diagnostic', 'plan', 'other', 'explore', 'search', 'read', 'write', 'command', 'wait']);
  assert.match(worklog.entries[3].operationLine, /^Explored /);
  assert.match(worklog.entries[4].operationLine, /^Searched /);
  assert.match(worklog.entries[5].operationLine, /^Read /);
  assert.match(worklog.entries[6].operationLine, /^Wrote /);
  assert.match(worklog.entries[7].operationLine, /^Ran /);
  assert.match(worklog.entries[8].operationLine, /^Waiting /);
  assert.deepEqual(visibleRunningWorkEntries(worklog, 4).map((entry) => entry.operationLine.replace(/\s.+$/, '')), ['Read', 'Wrote', 'Ran', 'Waiting']);
  assert.doesNotMatch(visibleRunningWorkEntries(worklog, 8).map((entry) => entry.operationLine).join('\n'), /Plan: implement/);
  assert.doesNotMatch(visibleRunningWorkEntries(worklog, 8).map((entry) => entry.operationLine).join('\n'), /used\/window/);
  assert.equal(worklog.entries.every((entry) => entry.rawInitiallyCollapsed), true);
  assert.match(worklog.entries.find((entry) => entry.operationKind === 'search')?.rawOutput ?? '', /run_command/);
});

test('WorkEvidence retrieval uses structured fields and displays Search', () => {
  const searchEvidence = event({
    id: 'work-evidence-search',
    type: 'tool-result',
    label: 'evidence',
    detail: 'provider payload mentions nothing useful',
    raw: {
      workEvidence: [{
        kind: 'retrieval',
        status: 'success',
        provider: 'generic-search',
        input: { query: 'BRCA1 review' },
        outputSummary: '3 candidate records from provider',
        evidenceRefs: ['trace:search-1'],
        recoverActions: [],
      }],
    },
  });

  const worklog = presentStreamWorklog([searchEvidence]);

  assert.equal(worklog.entries[0].operationKind, 'search');
  assert.match(worklog.entries[0].operationLine, /^Searched /);
  assert.match(worklog.entries[0].presentation.detail, /Evidence: 3 candidate records/);
  assert.equal(visibleRunningWorkEntries(worklog, 1)[0].operationKind, 'search');
});

test('WorkEvidence read command and validate kinds drive WorkEvent atoms', () => {
  const worklog = presentStreamWorklog([
    event({
      id: 'work-evidence-read',
      type: 'tool-result',
      label: 'evidence',
      raw: {
        workEvidence: [{
          kind: 'read',
          status: 'success',
          input: { path: '/tmp/report.md' },
          outputSummary: 'Read bounded file preview',
          evidenceRefs: ['file:/tmp/report.md'],
          recoverActions: [],
        }],
      },
    }),
    event({
      id: 'work-evidence-command',
      type: 'tool-result',
      label: 'evidence',
      raw: {
        workEvidence: [{
          kind: 'command',
          status: 'success',
          input: { command: 'npm test' },
          outputSummary: 'Command completed',
          evidenceRefs: ['log:test'],
          recoverActions: [],
        }],
      },
    }),
    event({
      id: 'work-evidence-validate',
      type: 'tool-result',
      label: 'evidence',
      raw: {
        workEvidence: [{
          kind: 'validate',
          status: 'success',
          outputSummary: 'Schema accepted output',
          evidenceRefs: ['trace:validator'],
          recoverActions: [],
        }],
      },
    }),
  ]);

  assert.deepEqual(worklog.entries.map((entry) => entry.operationKind), ['read', 'command', 'validate']);
  assert.match(worklog.entries[0].operationLine, /^Read /);
  assert.match(worklog.entries[1].operationLine, /^Ran /);
  assert.match(worklog.entries[2].operationLine, /^Validated /);
});

test('workspace runtime top-level WorkEvidence drives UI before text fallback', () => {
  const normalized = normalizeWorkspaceRuntimeEvent({
    type: 'tool-result',
    source: 'agentserver',
    toolName: 'generic_lookup',
    message: 'TEXT_FALLBACK_SHOULD_NOT_WIN',
    workEvidence: [{
      kind: 'retrieval',
      status: 'success',
      provider: 'generic-provider',
      input: { query: 'runtime evidence' },
      resultCount: 2,
      outputSummary: 'Top-level runtime WorkEvidence summary',
      evidenceRefs: ['stream:runtime-evidence'],
      recoverActions: [],
    }],
    providerRawOutput: 'RAW_RUNTIME_OUTPUT_SHOULD_STAY_RAW',
  });

  const entry = presentStreamWorklog([normalized]).entries[0];

  assert.equal(entry.operationKind, 'search');
  assert.match(entry.presentation.detail, /Top-level runtime WorkEvidence summary/);
  assert.doesNotMatch(entry.presentation.detail, /TEXT_FALLBACK_SHOULD_NOT_WIN/);
  assert.match(entry.rawOutput, /RAW_RUNTIME_OUTPUT_SHOULD_STAY_RAW/);
});

test('raw provider scenario and prompt fields do not become structured WorkEvent facts', () => {
  const genericStatus = event({
    id: 'generic-status',
    type: 'status',
    label: 'backend status',
    detail: 'ready',
    raw: {
      provider: 'some-provider',
      scenario: 'literature-review',
      prompt: 'search for BRCA1 papers',
      kind: 'retrieval',
      status: 'success',
      outputSummary: 'This is raw metadata only.',
    },
  });

  const entry = presentStreamWorklog([genericStatus]).entries[0];

  assert.equal(entry.structured, undefined);
  assert.equal(entry.operationKind, 'other');
  assert.doesNotMatch(entry.presentation.detail, /Evidence: This is raw metadata only/);
});

test('TaskStage failed exposes recover and diagnostic fields', () => {
  const failedStage = event({
    id: 'stage-failed',
    type: 'task-stage',
    label: 'stage failed',
    raw: {
      taskStage: {
        schemaVersion: 'sciforge.task-stage.v1',
        id: 'stage-validate',
        projectId: 'project-1',
        index: 2,
        kind: 'validate',
        title: 'Validate outputs',
        status: 'failed',
        createdAt: '2026-05-02T00:00:00.000Z',
        updatedAt: '2026-05-02T00:00:01.000Z',
        inputRefs: [],
        outputRefs: [],
        artifactRefs: [],
        evidenceRefs: ['trace:validator'],
        logRefs: ['log:validator-stderr'],
        failureReason: 'schema check rejected missing evidence refs',
        recoverActions: ['rerun validator with bounded artifact refs'],
        diagnostics: ['validator schema mismatch'],
        failure: {
          reason: 'schema check rejected missing evidence refs',
          recoverActions: ['rerun validator with bounded artifact refs'],
          evidenceRefs: ['trace:validator'],
        },
      },
    },
  });

  const entry = presentStreamWorklog([failedStage]).entries[0];

  assert.equal(entry.operationKind, 'recover');
  assert.match(entry.presentation.detail, /Failure: schema check rejected/);
  assert.match(entry.presentation.detail, /Recover: rerun validator/);
  assert.match(entry.presentation.detail, /Diagnostic: validator schema mismatch/);
  assert.match(entry.presentation.detail, /log:validator-stderr/);
  assert.equal(entry.presentation.tone, 'danger');
});

test('TaskStage WorkEvidence prefers structured fields over fallback detail', () => {
  const structuredStage = event({
    id: 'stage-structured-priority',
    type: 'task-stage',
    label: 'stage update',
    detail: 'TEXT_FALLBACK_SHOULD_NOT_APPEAR',
    raw: {
      taskStage: {
        schemaVersion: 'sciforge.task-stage.v1',
        id: 'stage-search',
        projectId: 'project-structured',
        index: 0,
        kind: 'search',
        title: 'Search durable refs',
        status: 'running',
        createdAt: '2026-05-02T00:00:00.000Z',
        updatedAt: '2026-05-02T00:00:01.000Z',
        inputRefs: [],
        outputRefs: [],
        artifactRefs: [],
        evidenceRefs: ['stage:evidence-ref'],
        logRefs: [],
        recoverActions: ['retry with bounded provider'],
        diagnostics: ['provider status 429'],
        nextStep: 'Use fallback provider',
        workEvidence: [{
          kind: 'retrieval',
          status: 'repair-needed',
          provider: 'generic-provider',
          input: { query: 'durable refs' },
          resultCount: 0,
          outputSummary: 'Structured evidence summary wins',
          evidenceRefs: ['work:evidence-ref'],
          failureReason: 'primary provider rate limited',
          recoverActions: ['retry with bounded provider'],
          diagnostics: ['provider status 429'],
          nextStep: 'Use fallback provider',
          rawRef: 'raw:provider-output',
        }],
      },
      providerRawOutput: 'RAW_STAGE_OUTPUT_SHOULD_STAY_RAW',
    },
  });

  const worklog = presentStreamWorklog([structuredStage]);
  const entry = worklog.entries[0];

  assert.equal(entry.operationKind, 'recover');
  assert.match(entry.presentation.detail, /Project: project-structured/);
  assert.match(entry.presentation.detail, /Stage: 1\. Search durable refs · running/);
  assert.match(entry.presentation.detail, /Evidence: Structured evidence summary wins/);
  assert.match(entry.presentation.detail, /Failure: primary provider rate limited/);
  assert.match(entry.presentation.detail, /Recover: retry with bounded provider/);
  assert.match(entry.presentation.detail, /Diagnostic: provider status 429/);
  assert.match(entry.presentation.detail, /Next: Use fallback provider/);
  assert.doesNotMatch(entry.presentation.detail, /TEXT_FALLBACK_SHOULD_NOT_APPEAR/);
  assert.match(entry.rawOutput, /RAW_STAGE_OUTPUT_SHOULD_STAY_RAW/);
});

test('multi-stage project summary shows project and stage progress', () => {
  const projectSummary = event({
    id: 'project-summary',
    type: 'task-project-summary',
    label: 'project summary',
    raw: {
      schemaVersion: 'sciforge.task-project-handoff.v1',
      project: {
        id: 'project-1',
        title: 'Evidence review',
        goal: 'review literature',
        status: 'running',
        createdAt: '2026-05-02T00:00:00.000Z',
        updatedAt: '2026-05-02T00:00:01.000Z',
      },
      refs: {},
      stages: [
        { id: 's1', projectId: 'project-1', index: 0, kind: 'search', title: 'Search literature', status: 'done', ref: 'stage:s1', evidenceRefs: ['trace:s1'], artifactRefs: [], diagnostics: [], recoverActions: [], workEvidence: [] },
        {
          id: 's2',
          projectId: 'project-1',
          index: 1,
          kind: 'analyze',
          title: 'Analyze claims',
          status: 'running',
          ref: 'stage:s2',
          summary: 'Comparing candidate claims',
          evidenceRefs: ['trace:s2'],
          artifactRefs: [],
          diagnostics: [],
          recoverActions: [],
          workEvidence: [{
            kind: 'claim',
            status: 'partial',
            outputSummary: 'Claim comparison evidence summary',
            evidenceRefs: ['trace:s2-work-evidence'],
            recoverActions: [],
          }],
        },
        { id: 's3', projectId: 'project-1', index: 2, kind: 'emit', title: 'Emit report', status: 'planned', ref: 'stage:s3', evidenceRefs: [], artifactRefs: [], diagnostics: [], recoverActions: [], workEvidence: [] },
      ],
      truncated: false,
    },
  });

  const worklog = presentStreamWorklog([projectSummary]);
  const entry = worklog.entries[0];

  assert.match(worklog.summary, /Project Evidence review · running · 1\/3 stages/);
  assert.match(worklog.summary, /Stage 2 Analyze claims · running/);
  assert.equal(entry.operationKind, 'analyze');
  assert.match(entry.presentation.detail, /Project: Evidence review · running · 1\/3 stages/);
  assert.match(entry.presentation.detail, /Stage: 2\. Analyze claims · running/);
  assert.match(entry.presentation.detail, /Summary: Comparing candidate claims/);
  assert.match(entry.presentation.detail, /Evidence: Claim comparison evidence summary/);
});

test('running work process renders structured progress without prompt or scenario semantic branching', () => {
  const progressEvent = event({
    id: 'structured-progress-shell',
    type: 'process-progress',
    label: '过程',
    detail: 'PROMPT_TEXT_SHOULD_NOT_DECIDE search write failed approval',
    raw: {
      prompt: 'PROMPT_TEXT_SHOULD_NOT_DECIDE search write failed approval',
      scenario: 'SCENARIO_TEXT_SHOULD_NOT_DECIDE retrieval repair blocked',
      progress: {
        phase: 'wait',
        title: '结构化等待状态',
        detail: 'structured detail wins',
        reading: ['/structured/read.csv'],
        waitingFor: 'structured backend event',
        nextStep: 'structured next step',
        status: 'running',
      },
    },
  });
  const counts = streamEventCounts([progressEvent]);
  const markup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events: [progressEvent],
    counts,
    backend: 'test',
    guidanceCount: 0,
  }));
  const visibleMarkup = markup.replace(/<details class="message-fold depth-3 stream-event-raw-fold"[\s\S]*?<\/details>/g, '');

  assert.match(visibleMarkup, /结构化等待状态/);
  assert.match(visibleMarkup, /正在读/);
  assert.match(visibleMarkup, /\/structured\/read\.csv/);
  assert.match(visibleMarkup, /structured backend event/);
  assert.match(visibleMarkup, /structured next step/);
  assert.doesNotMatch(visibleMarkup, /PROMPT_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(visibleMarkup, /SCENARIO_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(visibleMarkup, /search write failed approval/);
  assert.doesNotMatch(visibleMarkup, /retrieval repair blocked/);
  assert.match(markup, /PROMPT_TEXT_SHOULD_NOT_DECIDE/);
  assert.match(markup, /SCENARIO_TEXT_SHOULD_NOT_DECIDE/);
});

test('running work process keeps raw output inside collapsed raw fold', () => {
  const rawHeavyEvent = event({
    id: 'raw-heavy',
    type: 'tool-result',
    label: 'evidence',
    raw: {
      workEvidence: [{
        kind: 'retrieval',
        status: 'success',
        outputSummary: 'bounded summary only',
        evidenceRefs: ['trace:bounded'],
        recoverActions: [],
      }],
      providerRawOutput: 'RAW_PAYLOAD_SHOULD_STAY_IN_FOLD',
    },
  });
  const counts = streamEventCounts([rawHeavyEvent]);
  const markup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events: [rawHeavyEvent],
    counts,
    backend: 'test',
    guidanceCount: 0,
  }));

  assert.match(markup, /raw output/);
  assert.match(markup, /stream-event-raw-fold/);
  assert.doesNotMatch(markup, /stream-event-raw-fold" open=/);
  assert.match(markup, /RAW_PAYLOAD_SHOULD_STAY_IN_FOLD/);
  assert.doesNotMatch(markup.replace(/<pre>[\s\S]*?<\/pre>/g, ''), /RAW_PAYLOAD_SHOULD_STAY_IN_FOLD/);
});
