import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentStreamEvent } from './domain';
import { coalesceStreamEvents, latestRunningEvent, presentStreamEvent, streamEventCounts } from './streamEventPresentation';

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
