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

test('backend presentation profiles are separate from runtime profile metadata', () => {
  const codexAudit = event({
    type: 'audit',
    label: 'raw-jsonl',
    detail: 'raw JSONL folded in audit',
    raw: {
      backend: 'codex-exec-json',
      status: 'raw-jsonl',
      profile: 'sciforge-runtime-deepseek',
    },
  });
  const claudeApproval = event({
    type: 'gui_ask_user',
    label: 'approval',
    detail: 'Approval ref: `control-1`',
    raw: {
      backend: 'claude-stream-json',
      status: 'approval-required',
      profile: 'claude-code-runtime-profile',
    },
  });
  const claudeTool = event({
    type: 'tool_started',
    label: 'tool',
    detail: 'module.invoke actions.execute',
    raw: { backend: 'claude-stream-json' },
  });
  const codexAppTool = event({
    type: 'tool_started',
    label: 'tool',
    detail: 'module.read gui:/gui/regions/sidebar/summary.md',
    raw: { backend: 'codex-app-server' },
  });
  const codexAppAssistantDelta = event({
    type: 'assistant_delta',
    label: 'assistant delta',
    raw: { backend: 'codex-app-server', type: 'assistant_delta', text: 'Cursor-like assistant draft delta.' },
  });

  const codexPresentation = presentStreamEvent(codexAudit);
  assert.equal(codexPresentation.typeLabel, 'Codex audit');
  assert.equal(codexPresentation.importance, 'debug');
  assert.equal(codexPresentation.initiallyCollapsed, true);
  assert.equal(codexPresentation.visibleInRunningMessage, false);

  const approvalPresentation = presentStreamEvent(claudeApproval);
  assert.equal(approvalPresentation.typeLabel, 'Claude approval');
  assert.equal(approvalPresentation.importance, 'key');
  assert.equal(approvalPresentation.initiallyCollapsed, false);

  const toolPresentation = presentStreamEvent(claudeTool);
  assert.equal(toolPresentation.typeLabel, 'Claude tool');
  assert.equal(toolPresentation.importance, 'background');
  const cursorPresentation = presentStreamEvent(codexAppTool);
  assert.equal(cursorPresentation.typeLabel, 'Action');
  assert.equal(cursorPresentation.importance, 'background');
  const cursorDeltaPresentation = presentStreamEvent(codexAppAssistantDelta);
  assert.equal(cursorDeltaPresentation.typeLabel, 'Assistant progress');
  assert.equal(cursorDeltaPresentation.importance, 'background');
  assert.equal(cursorDeltaPresentation.visibleInRunningMessage, false);
  assert.equal(assistantDraftDeltaFromStreamEvent(codexAppAssistantDelta), 'Cursor-like assistant draft delta.');
  assert.equal(streamEventCounts([codexAudit, claudeApproval, claudeTool]).key, 1);
  assert.match(latestRunningEvent([codexAudit, claudeApproval, claudeTool]) ?? '', /Approval ref/);
  assert.equal(presentStreamEvent(claudeApproval, { profile: 'sciforge-default' }).typeLabel, 'gui_ask_user');
});

test('context warnings stay visible without exposing runtime window internals', () => {
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

  const contextPresentation = presentStreamEvent(contextEvent);
  assert.equal(contextPresentation.importance, 'key');
  assert.equal(contextPresentation.initiallyCollapsed, false);
  assert.match(contextPresentation.detail, /Context is near the limit/);
  assert.doesNotMatch(contextPresentation.detail, /used\/window|runtime|source|last|codex/i);
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
  assert.equal(latestRunningEvent(events), 'Working in the background. Activity is folded below.');
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
  assert.equal(assistantDraftFromStreamEvents([
    event({ id: 'delta-cjk-1', type: 'text-delta', label: '生成内容', detail: '简洁直' }),
    event({ id: 'delta-cjk-2', type: 'text-delta', label: '生成内容', detail: '给 / 少说' }),
    event({ id: 'delta-cjk-3', type: 'text-delta', label: '生成内容', detail: '废话' }),
  ]), '简洁直给 / 少说废话');
});

test('assistant draft hides redacted path placeholders and repairs split technical identifiers', () => {
  const draft = assistantDraftFromStreamEvents([
    event({ id: 'delta-paths', type: 'text-delta', label: '生成内容', detail: '[local path] [local path] [redacted-path] SciForge 需要保持 final- answer-pro se 纯净，' }),
    event({ id: 'delta-style', type: 'text-delta', label: '生成内容', detail: '过程用 worked /explored 分组，状态包含 com pleted 和 f ailed。' }),
    event({ id: 'delta-identifiers', type: 'text-delta', label: '生成内容', detail: ' splitFinal Message Presentation、init iallyExp anded、Object Reference 和 onObject Focus 也要稳定。' }),
  ]);

  assert.doesNotMatch(draft, /\[local path\]|\[redacted-path\]/i);
  assert.match(draft, /final-answer-prose/);
  assert.match(draft, /worked\/explored/);
  assert.match(draft, /completed/);
  assert.match(draft, /failed/);
  assert.match(draft, /splitFinalMessagePresentation/);
  assert.match(draft, /initiallyExpanded/);
  assert.match(draft, /ObjectReference/);
  assert.match(draft, /onObjectFocus/);
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
  assert.match(generation.typeLabel, /Writing/);
  assert.equal(write.importance, 'key');
  assert.equal(write.visibleInRunningMessage, true);
  assert.match(write.typeLabel, /Writing/);
  assert.match(write.detail, /arxiv_agent_literature_review\.py/);
  assert.match(latestRunningEvent([generationEvent, writeEvent]) || '', /Writing/);
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
  assert.match(presentation.detail, /Reading: \/workspace\/input\/papers\.csv/);
  assert.match(presentation.detail, /Writing: \/workspace\/tasks\/review\.py/);
  assert.match(presentation.detail, /Next: 收到新事件后继续执行/);
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
  assert.match(worklog.summary, /1 checked/);
});

test('interaction progress presentation covers blocked guidance and cancellation from structured contract fields', () => {
  const events = [
    normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.interaction-progress-event.v1',
      type: 'human-approval-required',
      phase: 'verification',
      status: 'blocked',
      importance: 'blocking',
      reason: 'side-effect-policy',
      interaction: { kind: 'human-approval', required: true },
      prompt: 'PROMPT_TEXT_SHOULD_NOT_DECIDE',
      scenario: 'SCENARIO_TEXT_SHOULD_NOT_DECIDE',
    }),
    normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.interaction-progress-event.v1',
      type: 'guidance-queued',
      phase: 'interaction',
      status: 'running',
      importance: 'normal',
      reason: 'backend run is active',
      interaction: { kind: 'guidance', required: false },
      message: 'NATURAL_LANGUAGE_FALLBACK_SHOULD_NOT_DECIDE',
    }),
    normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.interaction-progress-event.v1',
      type: 'run-cancelled',
      phase: 'run',
      status: 'cancelled',
      cancellationReason: 'user-aborted',
      reason: 'user interrupt',
      prompt: 'PROMPT_TEXT_SHOULD_NOT_DECIDE',
    }),
  ];

  const worklog = presentStreamWorklog(events);

  assert.deepEqual(worklog.entries.map((entry) => entry.presentation.typeLabel), ['Needs approval', 'Guidance queued', 'Run cancelled']);
  assert.deepEqual(worklog.entries.map((entry) => entry.operationKind), ['wait', 'wait', 'diagnostic']);
  assert.equal(worklog.entries[0].presentation.tone, 'warning');
  assert.equal(worklog.entries[2].presentation.tone, 'danger');
  const visible = worklog.entries.map((entry) => entry.presentation.detail).join('\n');
  assert.match(visible, /Interaction: human-approval required/);
  assert.match(visible, /Interaction: guidance optional/);
  assert.match(visible, /Cancellation: user-cancelled/);
  assert.doesNotMatch(visible, /PROMPT_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(visible, /SCENARIO_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(visible, /NATURAL_LANGUAGE_FALLBACK_SHOULD_NOT_DECIDE/);
});

test('worklog restores compact interaction progress from structured detail only', () => {
  const compact = event({
    id: 'compact-approval',
    type: 'human-approval-required',
    label: '需要确认',
    detail: [
      'Phase: verification',
      'Status: blocked',
      'Reason: side-effect-policy',
      'Interaction: human-approval required',
    ].join('\n'),
    raw: {
      type: 'human-approval-required',
      label: '需要确认',
      detail: [
        'Phase: verification',
        'Status: blocked',
        'Reason: side-effect-policy',
        'Interaction: human-approval required',
      ].join('\n'),
      prompt: 'PROMPT_TEXT_SHOULD_NOT_DECIDE search write failed approval',
      scenario: 'SCENARIO_TEXT_SHOULD_NOT_DECIDE retrieval repair blocked',
      message: 'NATURAL_LANGUAGE_FALLBACK_SHOULD_NOT_DECIDE search write failed approval',
    },
  });
  const poison = event({
    id: 'compact-poison',
    type: 'human-approval-required',
    label: '需要确认',
    raw: {
      type: 'human-approval-required',
      label: '需要确认',
      prompt: 'Phase: verification\nStatus: blocked\nInteraction: human-approval required',
      scenario: 'Phase: interaction\nStatus: blocked\nInteraction: clarification required',
      message: 'Phase: verification\nStatus: blocked\nInteraction: human-approval required',
    },
  });

  const compactPresentation = presentStreamEvent(compact);
  const poisonPresentation = presentStreamEvent(poison);
  const worklog = presentStreamWorklog([compact, poison]);

  assert.equal(compactPresentation.typeLabel, 'Needs approval');
  assert.equal(compactPresentation.importance, 'key');
  assert.match(compactPresentation.detail, /Interaction: human-approval required/);
  assert.equal(poisonPresentation.typeLabel, 'human-approval-required');
  assert.equal(poisonPresentation.detail, '');
  assert.equal(worklog.entries.length, 1);
  assert.equal(worklog.entries[0].operationKind, 'wait');
  assert.match(worklog.entries[0].operationLine, /^Waiting Phase: verification/);
  assert.doesNotMatch(worklog.entries[0].operationLine, /PROMPT_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(worklog.entries[0].operationLine, /SCENARIO_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(worklog.entries[0].operationLine, /NATURAL_LANGUAGE_FALLBACK_SHOULD_NOT_DECIDE/);
});

test('cursor-like worklog fixture summarizes operations and keeps runtime internals out of live entries', () => {
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
  assert.match(worklog.summary, /1 explored/);
  assert.match(worklog.summary, /1 searched/);
  assert.match(worklog.summary, /1 read/);
  assert.match(worklog.summary, /1 wrote/);
  assert.match(worklog.summary, /1 ran/);
  assert.match(worklog.summary, /1 waited/);
  assert.match(worklog.summary, /1 guided/);
  assert.equal(worklog.operationCounts.explore, 1);
  assert.equal(worklog.operationCounts.search, 1);
  assert.equal(worklog.operationCounts.read, 1);
  assert.equal(worklog.operationCounts.write, 1);
  assert.equal(worklog.operationCounts.command, 1);
  assert.equal(worklog.operationCounts.wait, 1);
  assert.deepEqual(worklog.entries.map((entry) => entry.operationKind), ['plan', 'explore', 'search', 'read', 'write', 'command', 'wait']);
  assert.match(worklog.entries[1].operationLine, /^Explored /);
  assert.match(worklog.entries[2].operationLine, /^Searched /);
  assert.match(worklog.entries[3].operationLine, /^Read /);
  assert.match(worklog.entries[4].operationLine, /^Wrote /);
  assert.match(worklog.entries[5].operationLine, /^Ran /);
  assert.match(worklog.entries[6].operationLine, /^Waiting /);
  assert.deepEqual(visibleRunningWorkEntries(worklog, 4).map((entry) => entry.operationLine.replace(/\s.+$/, '')), ['Explored', 'Wrote', 'Ran', 'Waiting']);
  assert.doesNotMatch(visibleRunningWorkEntries(worklog, 8).map((entry) => entry.operationLine).join('\n'), /Plan: implement/);
  assert.doesNotMatch(visibleRunningWorkEntries(worklog, 8).map((entry) => entry.operationLine).join('\n'), /used\/window/);
  assert.doesNotMatch(worklog.entries.map((entry) => entry.presentation.detail).join('\n'), /used\/window|Calling local model/);
  assert.equal(worklog.entries.every((entry) => entry.rawInitiallyCollapsed), true);
});

test('running work timeline keeps order while collapsing completed and repeated wait rows', () => {
  const events = [
    event({
      id: 'search',
      type: 'tool-call',
      label: 'Search',
      detail: '检索一下今天arxiv上Agentic harness自进化的文章',
      raw: { toolName: 'web_search', detail: '检索一下今天arxiv上Agentic harness自进化的文章' },
    }),
    event({
      id: 'wait-21',
      type: 'backend-silent',
      label: 'wait',
      detail: '后端 21s 没有输出新事件；HTTP stream 仍在等待 codex 返回。',
    }),
    event({
      id: 'wait-25',
      type: 'backend-silent',
      label: 'wait',
      detail: '后端 25s 没有输出新事件；HTTP stream 仍在等待 codex 返回。',
    }),
  ];
  const worklog = presentStreamWorklog(events);
  const visible = visibleRunningWorkEntries(worklog, 8);
  const markup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events,
    counts: streamEventCounts(events),
    backend: 'test',
    guidanceCount: 0,
  }));

  assert.deepEqual(visible.map((entry) => entry.event.id), ['search', 'wait-25']);
  assert.equal(visible.filter((entry) => entry.operationKind === 'wait').length, 1);
  assert.match(markup, /native-event-stream is-live/);
  assert.match(markup, /native-event-row[^"]*active/);
  assert.doesNotMatch(markup, />live<|>Working<|Agent process replay/);
  assert.doesNotMatch(markup, /running-work-completed-fold|执行轨迹|已完成/);
  assert.match(markup, /检索/);
  assert.doesNotMatch(markup, /后端 25s 没有输出新事件|Backend progress/);
  assert.doesNotMatch(markup, /Search<\/span><span>Searched/);
});

test('native stream promotes shell read lifecycle over backend wait placeholders', () => {
  const events = [
    normalizeWorkspaceRuntimeEvent({
      type: 'process-progress',
      progress: {
        phase: 'wait',
        status: 'running',
        title: 'Codex CLI 正在运行',
        waitingFor: '下一条 Codex CLI JSONL 事件',
        nextStep: '收到事件后继续按顺序展示执行轨迹。',
      },
    }),
    normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'tool_started',
      toolName: 'shell',
      command: "/bin/zsh -lc 'cat PROJECT.md | head -20'",
      status: 'in_progress',
      message: "Shell command started: /bin/zsh -lc 'cat PROJECT.md | head -20' (status=in_progress)",
    }),
    normalizeWorkspaceRuntimeEvent({
      type: 'backend-silent',
      detail: '后端 25s 没有输出新事件；HTTP stream 仍在等待 codex 返回。',
    }),
  ];
  const markup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events,
    counts: streamEventCounts(events),
    backend: 'codex',
    guidanceCount: 0,
  }));

  assert.match(markup, /Explored 1 file/);
  assert.match(markup, /Read PROJECT\.md running/);
  assert.doesNotMatch(markup, /cat PROJECT\.md/);
  assert.doesNotMatch(markup, /Shell command started|下一条 Codex CLI JSONL|后端 25s 没有输出新事件|Backend progress/);
});

test('native stream drops generic backend lifecycle placeholders once real backend content exists', () => {
  const events = [
    event({
      id: 'generic-progress',
      type: 'process-progress',
      label: 'Backend progress',
      detail: '进展',
      raw: { backend: 'codex-exec-json', type: 'process-progress' },
    }),
    event({
      id: 'generic-tool',
      type: 'tool_started',
      label: 'Backend tool',
      detail: 'Tool started.',
      raw: { backend: 'codex-exec-json', type: 'tool_started', message: 'Tool started.' },
    }),
    event({
      id: 'backend-message',
      type: 'message',
      label: 'Backend message',
      detail: 'Codex backend emitted a real assistant message.',
      raw: { backend: 'codex-exec-json', type: 'message', message: 'Codex backend emitted a real assistant message.' },
    }),
  ];
  const markup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events,
    counts: streamEventCounts(events),
    backend: 'codex',
    guidanceCount: 0,
  }));

  assert.equal(markup, '');
  assert.doesNotMatch(markup, /Backend progress|Tool started/);
});

test('native stream mirrors Codex lifecycle affordances for command, file edit, and subagent rows', () => {
  const runningCommandMarkup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events: [normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'tool_started',
      toolName: 'shell',
      command: "/bin/zsh -lc 'npm run typecheck --silent'",
      status: 'in_progress',
    })],
    counts: streamEventCounts([]),
    backend: 'codex',
    guidanceCount: 0,
  }));
  assert.match(runningCommandMarkup, /Worked for/);
  assert.match(runningCommandMarkup, /Ran \/bin\/zsh -lc/);
  assert.match(runningCommandMarkup, /<details[^>]*open=""/);

  const completedCommandMarkup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events: [normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'tool_completed',
      toolName: 'shell',
      command: "/bin/zsh -lc 'npm run typecheck --silent'",
      status: 'completed',
      exitCode: 0,
      outputSummary: 'typecheck clean',
    })],
    counts: streamEventCounts([]),
    backend: 'codex',
    guidanceCount: 0,
  }));
  assert.match(completedCommandMarkup, /Ran \/bin\/zsh -lc/);
  assert.match(completedCommandMarkup, /typecheck clean/);
  assert.doesNotMatch(completedCommandMarkup, /<details[^>]*open=""/);

  const fileEditMarkup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events: [event({
      type: 'tool_completed',
      label: 'apply_patch',
      detail: '*** Update File: src/ui/src/app/chat/RunningWorkProcess.tsx',
      raw: { backend: 'codex-exec-json', type: 'tool_completed', toolName: 'apply_patch', status: 'completed' },
    })],
    counts: streamEventCounts([]),
    backend: 'codex',
    guidanceCount: 0,
  }));
  assert.match(fileEditMarkup, /Edited/);
  assert.match(fileEditMarkup, /src\/ui\/src\/app\/chat\/RunningWorkProcess\.tsx/);

  const subagentMarkup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events: [event({
      type: 'tool_started',
      label: 'spawn_agent',
      detail: 'multi_agent_v1.spawn_agent agent_type=worker',
      raw: { backend: 'codex-exec-json', type: 'tool_started', toolName: 'multi_agent_v1.spawn_agent', status: 'started' },
    })],
    counts: streamEventCounts([]),
    backend: 'codex',
    guidanceCount: 0,
  }));
  assert.match(subagentMarkup, /Sub agent/);
});

test('cursor process aggregates read and search actions and expands output, diff, and terminal states', () => {
  const events = [
    normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'tool_completed',
      toolName: 'shell',
      command: "/bin/zsh -lc 'sed -n 1,20p PROJECT.md'",
      status: 'completed',
      message: "Shell command completed: /bin/zsh -lc 'sed -n 1,20p PROJECT.md'",
    }),
    normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'tool_completed',
      toolName: 'shell',
      command: "rg -n 'TODO' src/ui/src",
      status: 'completed',
    }),
    event({
      id: 'command-output',
      type: 'tool_completed',
      label: 'shell',
      detail: 'npm test',
      createdAt: '2026-05-25T00:00:01.000Z',
      raw: {
        backend: 'codex-app-server',
        type: 'tool_completed',
        toolName: 'shell',
        command: 'npm test',
        status: 'completed',
        stdout: 'tests passed\nsecret=sk-secret',
        stderr: 'warning provider=https://provider.example/v1',
      },
    }),
    normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'tool_completed',
      toolName: 'apply_patch',
      filePath: 'src/ui/src/app/chat/RunningWorkProcess.tsx',
      status: 'completed',
      outputSummary: '+1 -1',
      diff: [
        'diff --git a/src/ui/src/app/chat/RunningWorkProcess.tsx b/src/ui/src/app/chat/RunningWorkProcess.tsx',
        '-old line',
        '+new line',
      ].join('\n'),
    }),
    normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'tool_completed',
      toolName: 'shell',
      command: 'npm run failing-check',
      status: 'failed',
      exitCode: 1,
      outputSummary: 'check failed',
    }),
    normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'tool_completed',
      toolName: 'shell',
      command: 'npm run long-watch',
      status: 'cancelled',
    }),
  ];
  const markup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events,
    counts: streamEventCounts(events),
    backend: 'codex',
    guidanceCount: 0,
  }));

  assert.match(markup, /Explored 1 file, 1 search/);
  assert.match(markup, /Read PROJECT\.md/);
  assert.match(markup, /Searched TODO src\/ui\/src/);
  assert.match(markup, /tests passed/);
  assert.match(markup, /provider=\[redacted\]/);
  assert.doesNotMatch(markup, /Stdout:|Stderr:/);
  assert.match(markup, /Edited src\/ui\/src\/app\/chat\/RunningWorkProcess\.tsx \+1 -1/);
  assert.equal((markup.match(/\+new line/g) ?? []).length, 1);
  assert.match(markup, /failed/);
  assert.match(markup, /cancelled/);
  assert.doesNotMatch(markup, /Runtime event recorded|Shell command completed|sk-secret|provider\.example/);
});

test('cursor process keeps interleaved worked and explored chunks in chronological order', () => {
  const events = [
    event({
      id: 'run-install',
      type: 'tool_completed',
      label: 'shell',
      detail: 'npm install',
      createdAt: '2026-05-25T00:00:00.000Z',
      raw: {
        backend: 'codex-app-server',
        type: 'tool_completed',
        toolName: 'shell',
        command: 'npm install',
        status: 'completed',
      },
    }),
    event({
      id: 'read-project',
      type: 'tool_completed',
      label: 'read_file',
      detail: 'PROJECT.md loaded',
      createdAt: '2026-05-25T00:00:01.000Z',
      raw: {
        backend: 'codex-app-server',
        type: 'tool_completed',
        toolName: 'read_file',
        filePath: 'PROJECT.md',
        status: 'completed',
        text: 'PROJECT.md loaded',
      },
    }),
    event({
      id: 'run-typecheck',
      type: 'tool_completed',
      label: 'shell',
      detail: 'npm run typecheck --silent',
      createdAt: '2026-05-25T00:00:02.000Z',
      raw: {
        backend: 'codex-app-server',
        type: 'tool_completed',
        toolName: 'shell',
        command: 'npm run typecheck --silent',
        status: 'completed',
      },
    }),
  ];
  const markup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events,
    counts: streamEventCounts(events),
    backend: 'codex',
    guidanceCount: 0,
  }));
  const timelineMarkup = markup.slice(markup.indexOf('native-event-list'));
  const firstRun = timelineMarkup.indexOf('Ran npm install');
  const read = timelineMarkup.indexOf('Read PROJECT.md');
  const secondRun = timelineMarkup.indexOf('Ran npm run typecheck --silent');

  assert.ok(firstRun >= 0 && read > firstRun && secondRun > read, timelineMarkup);
  assert.equal((markup.match(/Worked for/g) ?? []).length, 2);
  assert.equal((markup.match(/Explored 1 file/g) ?? []).length, 1);
});

test('live cursor process keeps forty eight actions and separates action overflow from diagnostics', () => {
  const events = Array.from({ length: 50 }, (_, index) => event({
    id: `cmd-${index}`,
    type: 'tool_completed',
    label: 'shell',
    detail: `echo command-${index}`,
    createdAt: `2026-05-25T00:00:${String(index).padStart(2, '0')}.000Z`,
    raw: {
      backend: 'codex-app-server',
      type: 'tool_completed',
      toolName: 'shell',
      command: `echo command-${index}`,
      status: 'completed',
    },
  }));
  const markup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events,
    counts: streamEventCounts(events),
    backend: 'codex',
    guidanceCount: 0,
  }));

  assert.match(markup, /Ran echo command-0/);
  assert.match(markup, /Ran echo command-49/);
  assert.doesNotMatch(markup, /条底层诊断已收起/);
  assert.doesNotMatch(markup, /底层诊断事件：/);
  assert.equal((markup.match(/cursor-agent-action-shell_command/g) ?? []).length, 48);
  assert.match(markup, /2 earlier actions hidden/);
});

test('cursor action details are redacted and file previews require trusted refs', () => {
  const runtimePhraseMarkup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events: [event({
      type: 'tool-result',
      label: 'Runtime Codex',
      detail: 'Runtime Codex started with sciforge-deepseek-proxy/bailian/deepseek-v4-flash profile sciforge-runtime-deepseek.',
      raw: {
        type: 'tool_completed',
        toolName: 'process_summary',
        status: 'completed',
        detail: 'Runtime Codex started with sciforge-deepseek-proxy/bailian/deepseek-v4-flash profile sciforge-runtime-deepseek.',
      },
    })],
    counts: streamEventCounts([]),
    backend: 'codex',
    guidanceCount: 0,
  }));
  assert.match(runtimePhraseMarkup, /configured runtime/);
  assert.doesNotMatch(runtimePhraseMarkup, /sciforge-deepseek-proxy|bailian\/deepseek-v4-flash|sciforge-runtime-deepseek/);

  const redactedCommandMarkup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events: [normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'tool_completed',
      toolName: 'shell',
      command: "curl https://provider.example/v1 -H 'Authorization: Bearer sk-secret' --model bailian/deepseek-v4-flash --cwd /Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p1",
      status: 'completed',
      exitCode: 0,
      outputSummary: 'provider=https://provider.example token=sk-secret path=/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p1',
    })],
    counts: streamEventCounts([]),
    backend: 'codex',
    guidanceCount: 0,
  }));
  assert.match(redactedCommandMarkup, /\[url\]/);
  assert.match(redactedCommandMarkup, /\[redacted\]/);
  assert.match(redactedCommandMarkup, /p1/);
  assert.doesNotMatch(redactedCommandMarkup, /provider\.example|sk-secret|bailian\/deepseek-v4-flash|\/Applications\/workspace/);

  const rawPathOnlyMarkup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events: [normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'tool_completed',
      toolName: 'read_file',
      filePath: 'PROJECT.md',
      status: 'completed',
      outputSummary: 'loaded',
    })],
    counts: streamEventCounts([]),
    backend: 'codex',
    guidanceCount: 0,
    onObjectFocus: () => undefined,
  }));
  assert.match(rawPathOnlyMarkup, /Read PROJECT\.md/);
  assert.match(rawPathOnlyMarkup, /cursor-agent-action-focus/);

  const inferredReadTargetMarkup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events: [event({
      type: 'tool-result',
      label: 'Read',
      detail: '只读检查：请读取 PROJECT.md 的目标摘要，用一句中文概括当前阶段目标。',
      raw: {
        type: 'tool_completed',
        toolName: 'read_file',
        status: 'completed',
        detail: '只读检查：请读取 PROJECT.md 的目标摘要，用一句中文概括当前阶段目标。',
      },
    })],
    counts: streamEventCounts([]),
    backend: 'codex',
    guidanceCount: 0,
    onObjectFocus: () => undefined,
  }));
  assert.match(inferredReadTargetMarkup, /Read PROJECT\.md/);
  assert.doesNotMatch(inferredReadTargetMarkup, /只读检查：请读取 PROJECT\.md/);
  assert.doesNotMatch(inferredReadTargetMarkup, /Preview file/);

  const unsafeRefMarkup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events: [normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'tool_completed',
      toolName: 'read_file',
      filePath: '/tmp/private-note.md',
      fileRef: 'file:/tmp/private-note.md',
      status: 'completed',
      outputSummary: 'loaded /tmp/private-note.md',
    })],
    counts: streamEventCounts([]),
    backend: 'codex',
    guidanceCount: 0,
    onObjectFocus: () => undefined,
  }));
  assert.match(unsafeRefMarkup, /Read private-note\.md/);
  assert.doesNotMatch(unsafeRefMarkup, /Preview file|file:\/tmp|\/tmp\/private-note/);

  const trustedRefMarkup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events: [normalizeWorkspaceRuntimeEvent({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'tool_completed',
      toolName: 'read_file',
      filePath: 'PROJECT.md',
      fileRef: 'file:PROJECT.md',
      status: 'completed',
      outputSummary: 'loaded',
    })],
    counts: streamEventCounts([]),
    backend: 'codex',
    guidanceCount: 0,
    onObjectFocus: () => undefined,
  }));
  assert.match(trustedRefMarkup, /cursor-agent-action-focus/);

  const assistantDeltaMarkup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events: [event({
      type: 'text-delta',
      label: 'Assistant text',
      detail: 'This belongs in the assistant answer, not the process transcript.',
      raw: { backend: 'codex-app-server', type: 'text-delta', text: 'This belongs in the assistant answer, not the process transcript.' },
    })],
    counts: streamEventCounts([]),
    backend: 'codex',
    guidanceCount: 0,
  }));
  assert.equal(assistantDeltaMarkup, '');
});

test('live chat worklog filters internal runtime events but keeps meaningful work steps', () => {
  const events = [
    event({
      id: 'internal-plan',
      type: 'current-plan',
      label: 'current-plan',
      detail: 'Plan: route GUI prompt through Codex Runtime bridge.',
    }),
    event({
      id: 'tool-start',
      type: 'project-tool-start',
      label: 'project-tool-start',
      detail: 'SciForge project tool started with runtime profile sciforge-runtime-deepseek.',
    }),
    event({
      id: 'context',
      type: 'contextWindowState',
      label: 'contextWindowState',
      contextWindowState: {
        source: 'native',
        status: 'healthy',
        usedTokens: 411,
        windowTokens: 200_000,
        ratio: 0.002,
        backend: 'codex',
      },
    }),
    event({
      id: 'runtime-run',
      type: 'codex-runtime-run',
      label: 'codex-runtime-run',
      detail: 'Runtime Codex started with provider=bailian model=deepseek profile=sciforge-runtime-deepseek workspace=/tmp/work',
    }),
    event({
      id: 'request-accepted',
      type: 'process-progress',
      label: '已收到请求',
      detail: '正在把本轮请求交给 workspace runtime：read PROJECT.md and summarize UX. 正在等：workspace runtime 首个事件。',
    }),
    event({
      id: 'native-message-layer',
      type: 'message',
      label: 'Runtime Codex',
      detail: 'Runtime Codex native assistant message recorded; the final assistant answer can render as the primary reply, while raw JSONL, stderr, and plugin diagnostics stay folded in the run audit.',
    }),
    event({
      id: 'read-step',
      type: 'tool-call',
      label: 'Read PROJECT.md',
      detail: 'sed -n 1,160p PROJECT.md',
      raw: { toolName: 'run_command', detail: 'sed -n 1,160p PROJECT.md' },
    }),
  ];
  const worklog = presentStreamWorklog(events);
  const counts = streamEventCounts(events);
  const markup = renderToStaticMarkup(React.createElement(RunningWorkProcess, {
    events,
    counts,
    backend: 'codex',
    guidanceCount: 0,
  }));

  assert.deepEqual(worklog.entries.map((entry) => entry.event.id), ['read-step']);
  assert.equal(counts.debug, 6);
  assert.match(markup, /Read PROJECT\.md|sed -n 1,160p PROJECT\.md/);
  assert.doesNotMatch(markup, /current-plan|project-tool-start|codex-runtime-run|sciforge-runtime-deepseek|used\/window|workspace=|raw output|native assistant message|raw JSONL|workspace runtime 首个事件/);
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
  assert.doesNotMatch(entry.rawOutput, /RAW_RUNTIME_OUTPUT_SHOULD_STAY_RAW/);
  assert.match(entry.rawOutput, /runtime-debug-sensitive/);
});

test('workspace runtime raw-shaped event fallback does not expose JSON or private refs as visible detail', () => {
  const normalized = normalizeWorkspaceRuntimeEvent({
    status: 'failed',
    stdoutRef: '.sciforge/logs/stdout.log',
    stderrRef: '.sciforge/logs/stderr.log',
    rawRef: '.sciforge/sessions/session-a/raw.json',
    payload: { finalText: 'HTTP 401 Unauthorized: Invalid token' },
  });

  const presentation = presentStreamEvent(normalized);

  assert.match(presentation.detail, /Runtime event recorded/);
  assert.doesNotMatch(presentation.detail, /stdoutRef|stderrRef|rawRef|Invalid token|^\{/);
  assert.doesNotMatch(presentStreamWorklog([normalized]).entries.map((entry) => entry.operationLine).join('\n'), /stdoutRef|stderrRef|rawRef|Invalid token/);
});

test('Runtime Codex stderr and plugin warnings stay audit-only in running presentation', () => {
  const stderrWarning = normalizeWorkspaceRuntimeEvent({
    type: 'audit',
    status: 'stderr',
    message: 'Plugin manifest warning: failed to load plugin from /tmp/plugin.json',
    raw: { stream: 'stderr', chunk: 'Plugin manifest warning: failed to load plugin from /tmp/plugin.json' },
  });
  const directStderr = event({
    type: 'stderr',
    label: 'stderr',
    detail: '<!DOCTYPE html><html><title>Attention Required! Cloudflare</title><body>CF-RAY raw transport page</body></html>',
    raw: { stream: 'stderr' },
  });

  const warningPresentation = presentStreamEvent(stderrWarning);
  const stderrPresentation = presentStreamEvent(directStderr);
  const worklog = presentStreamWorklog([stderrWarning, directStderr]);

  assert.equal(warningPresentation.importance, 'debug');
  assert.equal(warningPresentation.visibleInRunningMessage, false);
  assert.equal(stderrPresentation.importance, 'debug');
  assert.equal(stderrPresentation.visibleInRunningMessage, false);
  assert.match(warningPresentation.detail, /plugin manifest warning recorded/i);
  assert.match(stderrPresentation.detail, /stderr output recorded/i);
  assert.equal(latestRunningEvent([stderrWarning, directStderr]), undefined);
  assert.equal(worklog.entries.length, 0);
  assert.doesNotMatch([
    warningPresentation.detail,
    stderrPresentation.detail,
    latestRunningEvent([stderrWarning, directStderr]) ?? '',
  ].join('\n'), /failed to load plugin|CF-RAY|Attention Required|<html/i);
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
  assert.doesNotMatch(entry.rawOutput, /RAW_STAGE_OUTPUT_SHOULD_STAY_RAW/);
  assert.match(entry.rawOutput, /runtime-debug-sensitive/);
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
  assert.match(visibleMarkup, /Reading:/);
  assert.match(visibleMarkup, /\/structured\/read\.csv/);
  assert.match(visibleMarkup, /structured backend event/);
  assert.match(visibleMarkup, /structured next step/);
  assert.doesNotMatch(visibleMarkup, /PROMPT_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(visibleMarkup, /SCENARIO_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(visibleMarkup, /search write failed approval/);
  assert.doesNotMatch(visibleMarkup, /retrieval repair blocked/);
  assert.doesNotMatch(markup, /PROMPT_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(markup, /SCENARIO_TEXT_SHOULD_NOT_DECIDE/);
});

test('running work process keeps raw output out of the live chat DOM', () => {
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

  assert.doesNotMatch(markup, /raw output/);
  assert.doesNotMatch(markup, /复制 raw/);
  assert.doesNotMatch(markup, /stream-event-raw-fold/);
  assert.doesNotMatch(markup, /RAW_PAYLOAD_SHOULD_STAY_IN_FOLD/);
  assert.doesNotMatch(markup, /runtime-debug-sensitive/);
});
