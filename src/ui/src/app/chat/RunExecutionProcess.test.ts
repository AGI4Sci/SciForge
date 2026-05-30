import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentStreamEvent, RuntimeExecutionUnit, SciForgeSession } from '../../domain';
import { RunExecutionProcess } from './RunExecutionProcess';
import { conversationProjectionMigrationAuditFixtureForRun } from '../conversation-projection-view-model';
import { attachStreamProcessToResponse } from './runPresentation';

test('execution process groups blocking execution units into Codex-style folded sections', () => {
  const html = renderProcess([
    executionUnit({ id: 'failed-with-reason', status: 'failed-with-reason', failureReason: 'contract validation failed' }),
    executionUnit({
      id: 'repair-needed',
      status: 'repair-needed',
      params: 'large params should not hide recovery details',
      codeRef: 'src/report.ts',
      code: 'emitReport({ schemaVersion: 0 })',
      diffRef: 'diffs/report.patch',
      stdoutRef: 'logs/stdout.log',
      stderrRef: 'logs/stderr.log',
      outputRef: 'artifacts/report.json',
      patchSummary: 'report schema mismatch',
      failureReason: 'artifact payload is missing markdownRef',
      recoverActions: ['Regenerate the report artifact with schemaVersion=1.'],
      nextStep: 'Retry artifact materialization before presenting success.',
    }),
    executionUnit({ id: 'needs-human', status: 'needs-human' }),
  ]);

  assert.equal(html, '');
});

test('execution process scopes execution units to the selected run artifact refs', () => {
  const html = renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-old',
    session: {
      ...session([]),
      runs: [
        {
          id: 'run-old',
          scenarioId: 'literature-evidence-review',
          status: 'completed',
          prompt: 'old report',
          response: 'done',
          createdAt: '2026-05-12T00:00:00.000Z',
          objectReferences: [{ kind: 'artifact', ref: 'artifact:old-report', title: 'old report', runId: 'run-old' }],
          raw: { payload: { executionUnits: [executionUnit({ id: 'EU-old', tool: 'old.tool', outputRef: 'artifact:old-report' })] } },
        },
        {
          id: 'run-new',
          scenarioId: 'literature-evidence-review',
          status: 'completed',
          prompt: 'new report',
          response: 'done',
          createdAt: '2026-05-12T00:05:00.000Z',
          objectReferences: [{ kind: 'artifact', ref: 'artifact:new-report', title: 'new report', runId: 'run-new' }],
          raw: { payload: { executionUnits: [executionUnit({ id: 'EU-new', tool: 'new.tool', outputRef: 'artifact:new-report' })] } },
        },
      ] as never,
      executionUnits: [],
    },
    onObjectFocus: () => undefined,
  }));

  assert.equal(html, '');
});

test('execution process does not fall back to same-package units from another run', () => {
  const html = renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-old',
    session: {
      ...session([]),
      runs: [
        { id: 'run-old', scenarioId: 'literature-evidence-review', status: 'completed', prompt: 'old', response: 'done', createdAt: '2026-05-12T00:00:00.000Z' },
        { id: 'run-new', scenarioId: 'literature-evidence-review', status: 'completed', prompt: 'new', response: 'done', createdAt: '2026-05-12T00:05:00.000Z' },
      ],
      executionUnits: [executionUnit({
        id: 'EU-new-only',
        tool: 'new.tool',
        outputRef: 'run:run-new#output',
        scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
      })],
    },
    onObjectFocus: () => undefined,
  }));

  assert.equal(html, '');
});

test('execution process summarizes failed execution units preserved in run payload without internal refs', () => {
  const html = renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-failed-payload',
    session: {
      ...session([]),
      runs: [{
        id: 'run-failed-payload',
        scenarioId: 'literature-evidence-review',
        status: 'failed',
        prompt: 'probe page',
        response: 'failed-with-reason',
        createdAt: '2026-05-12T00:00:00.000Z',
        raw: {
          payload: {
            executionUnits: [{
              id: 'EU-failed-payload',
              tool: 'web.probe',
              params: '{}',
              status: 'failed-with-reason',
              hash: 'failed-payload',
              outputRef: 'run:run-failed-payload#EU-failed-payload',
              failureReason: 'probe failed before rendering',
            }],
          },
        },
      }],
      executionUnits: [],
    },
    onObjectFocus: () => undefined,
  }));

  assert.equal(html, '');
});

test('execution process uses projection events instead of raw audit execution units when projection exists', () => {
  const html = renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-projection-process',
    session: withMaterializedProjectionFixture({
      ...session([]),
      runs: [{
        id: 'run-projection-process',
        scenarioId: 'literature-evidence-review',
        status: 'failed',
        prompt: 'summarize refs',
        response: 'legacy failed response',
        createdAt: '2026-05-12T00:00:00.000Z',
        raw: {
          resultPresentation: {
            conversationProjection: {
              schemaVersion: 'sciforge.conversation-projection.v1',
              conversationId: 'conversation-projection-process',
              currentTurn: { id: 'turn-projection-process', prompt: 'summarize refs' },
              visibleAnswer: { status: 'satisfied', text: 'Projection-visible answer.', artifactRefs: [] },
              artifacts: [],
              executionProcess: [{
                eventId: 'event-projection-process',
                type: 'OutputMaterialized',
                summary: 'Projection output materialized.',
                timestamp: '2026-05-13T00:00:01.000Z',
              }],
              recoverActions: [],
              verificationState: { status: 'not-required' },
              auditRefs: ['execution-unit:EU-legacy-audit'],
              diagnostics: [],
            },
          },
        },
      }],
      executionUnits: [executionUnit({
        id: 'EU-legacy-audit',
        tool: 'legacy.raw.audit',
        status: 'repair-needed',
        failureReason: 'LEGACY_RAW_AUDIT_UNIT_SHOULD_NOT_RENDER',
      })],
    }),
    onObjectFocus: () => undefined,
  }));

  assert.equal(html, '');
});

test('execution process replays backend native stream without SciForge summary folds', () => {
  const html = renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-native-stream',
    session: {
      ...session([]),
      runs: [{
        id: 'run-native-stream',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'native stream please',
        response: 'done',
        createdAt: '2026-05-25T00:00:00.000Z',
        raw: {
          streamProcess: {
            eventCount: 4,
            events: [
              nativeEvent('text-delta', 'Assistant text', { rawType: 'text-delta', text: 'Reading PROJECT.md directly from the backend stream.' }),
              nativeEvent('tool-call', 'Tool call', { rawType: 'tool_started', toolName: 'read_file', status: 'running' }),
              nativeEvent('tool-result', 'Tool result', { rawType: 'tool_completed', toolName: 'read_file', status: 'completed', filePath: 'PROJECT.md', fileRef: 'file:PROJECT.md', text: 'PROJECT.md loaded' }),
              nativeEvent('human-approval-required', 'Approval', { rawType: 'approval_requested', text: 'Continue with native presentation?' }),
            ],
          },
        },
      }],
      executionUnits: [executionUnit({
        id: 'EU-legacy',
        tool: 'legacy.summary',
        status: 'repair-needed',
        failureReason: 'LEGACY_SUMMARY_SHOULD_NOT_RENDER',
      })],
    },
    onObjectFocus: () => undefined,
  }));

  assert.match(html, /data-process-source="native-event-stream"/);
  assert.doesNotMatch(html, /Work replay|Agent process replay|badge-muted&quot;>replay|badge-muted">replay/);
  assert.match(html, /Worked for/);
  assert.match(html, /Explored/);
  assert.match(html, /Read PROJECT\.md/);
  assert.match(html, /cursor-agent-action-focus/);
  assert.match(html, /Approval Continue with native presentation/);
  assert.doesNotMatch(html, /Reading PROJECT\.md directly from the backend stream/);
  assert.doesNotMatch(html, /<span class="cursor-step-kind">(?:过程|验证|恢复线索|诊断)<\/span>/);
  assert.doesNotMatch(html, /LEGACY_SUMMARY_SHOULD_NOT_RENDER|legacy\.summary/);
});

test('execution process derives trusted preview refs from structured read paths', () => {
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', { rawType: 'tool_completed', toolName: 'read_file', status: 'completed', filePath: 'PROJECT.md', text: 'PROJECT.md loaded' }),
  ]);

  assert.match(html, /Read PROJECT\.md/);
  assert.match(html, /cursor-agent-action-focus/);
  assert.match(html, /data-sciforge-run-id="run-native-stream-test"/);
  assert.doesNotMatch(html, /\/Applications\/workspace|\/tmp\/secret|trace:read/i);
});

test('execution process derives missing read previews from safe runtime command text', () => {
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', { rawType: 'tool_completed', toolName: 'read_file', itemId: 'read-project', status: 'completed', text: 'file loaded' }),
    nativeEvent('tool-result', 'Tool result', { rawType: 'tool_completed', toolName: 'read_file', itemId: 'read-architecture', status: 'completed', text: 'file loaded' }),
  ], undefined, 'Read only. Read PROJECT.md, docs/Architecture.md. Answer in Chinese.');

  assert.match(html, /Read PROJECT\.md/);
  assert.match(html, /Read docs\/Architecture\.md/);
  assert.equal((html.match(/cursor-agent-action-focus/g) ?? []).length, 2);
  assert.doesNotMatch(html, /PROJECT\.md\./);
  assert.doesNotMatch(html, /\/Applications\/workspace|\/tmp\/secret|trace:read/i);
});

test('execution process does not derive missing read previews from unsafe runtime command paths', () => {
  const html = renderNativeStream([
    nativeEvent('workspace-runtime-event', 'Runtime event', {
      rawType: 'run_started',
      commandText: 'Read /tmp/secret.md and .sciforge/raw/provider.json.',
    }),
    nativeEvent('tool-result', 'Tool result', { rawType: 'tool_completed', toolName: 'read_file', status: 'completed', text: 'file loaded' }),
  ]);

  assert.match(html, /Read file/);
  assert.doesNotMatch(html, /cursor-agent-action-focus/);
  assert.doesNotMatch(html, /\/tmp\/secret|\.sciforge\/raw|file:\.sciforge/i);
});

test('execution process localizes Cursor-style process labels to Chinese when requested', () => {
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', { rawType: 'tool_completed', toolName: 'read_file', status: 'completed', filePath: 'PROJECT.md', text: 'PROJECT.md loaded' }),
    nativeEvent('tool-result', 'Tool result', { rawType: 'tool_completed', toolName: 'shell', status: 'completed', command: 'npm test', exitCode: 0 }),
  ], 'zh-CN');

  assert.match(html, /查看了 1 个文件/);
  assert.match(html, /读取 PROJECT\.md/);
  assert.match(html, /cursor-agent-action-focus/);
  assert.match(html, /运行 npm test · 退出码 0/);
  assert.doesNotMatch(html, /Worked for|Explored|Preview file|Ran npm test/);
});

test('execution process folds generic runtime lifecycle rows out of Cursor-style actions', () => {
  const html = renderNativeStream([
    nativeEvent('workspace-runtime-event', 'Runtime event', { rawType: 'run_started', status: 'running', message: 'Runtime Codex started with configured runtime' }),
    nativeEvent('tool-result', 'Tool result', { rawType: 'tool_completed', toolName: 'read_file', status: 'completed', filePath: 'PROJECT.md', text: 'PROJECT.md loaded' }),
    nativeEvent('workspace-runtime-event', 'Runtime event', { rawType: 'done', status: 'done', message: 'Runtime Codex completed successfully.' }),
  ]);

  assert.match(html, /Read PROJECT\.md/);
  assert.doesNotMatch(html, /Runtime Codex started with configured runtime|Runtime Codex completed successfully/);
  assert.doesNotMatch(html, /status-running/);
});

test('execution process folds app-server transport statuses and keeps long research anchors', () => {
  const events = [
    nativeEventAt('2026-05-25T00:00:00.000Z', 'operation-progress', 'Progress', {
      rawType: 'process-progress',
      progress: {
        title: 'Codex app-server 正在运行',
        waitingFor: '下一条 Codex app-server rich-client 事件',
        nextStep: '收到事件后继续按顺序展示执行轨迹。',
      },
    }),
    nativeEventAt('2026-05-25T00:00:01.000Z', 'tool-result', 'Search', {
      rawType: 'tool_completed',
      toolName: 'search',
      status: 'completed',
      text: 'arxiv agentic RL 2026-05-30',
      sourceRefs: ['artifact:arxiv-search-results'],
    }),
    nativeEventAt('2026-05-25T00:00:02.000Z', 'tool-result', 'PDF extract', {
      rawType: 'tool_completed',
      toolName: 'pdf_extract',
      status: 'completed',
      filePath: 'reports/arxiv-agentic-rl/paper.pdf',
      pdfRefs: ['file:reports/arxiv-agentic-rl/paper.pdf'],
      text: 'Extracted PDF text for paper.pdf',
    }),
    ...Array.from({ length: 24 }, (_, index) => nativeEventAt(`2026-05-25T00:00:${String(index + 3).padStart(2, '0')}.000Z`, 'tool-result', 'Command', {
      rawType: 'tool_completed',
      toolName: 'exec_command',
      status: 'completed',
      command: `/bin/zsh -lc 'echo command-${index}'`,
      exitCode: 0,
      text: `command-${index}`,
    })),
    nativeEventAt('2026-05-25T00:00:40.000Z', 'tool-result', 'Write report', {
      rawType: 'tool_completed',
      toolName: 'write_file',
      status: 'completed',
      filePath: 'reports/arxiv-agentic-rl/summary-report.md',
      outputSummary: '+285',
      resultRef: 'file:reports/arxiv-agentic-rl/summary-report.md',
      text: 'Created summary-report.md',
    }),
  ];
  const html = renderNativeStream(events);
  const exploredIndex = html.indexOf('Explored');
  const workedIndex = html.indexOf('Worked for');

  assert.ok(exploredIndex >= 0 && workedIndex >= 0 && exploredIndex < workedIndex);
  assert.match(html, /Searched arxiv agentic RL 2026-05-30/);
  assert.match(html, /Read reports\/arxiv-agentic-rl\/paper\.pdf/);
  assert.match(html, /paper\.pdf/);
  assert.match(html, /Ran \/bin\/zsh -lc &#x27;echo command-23&#x27; · exit 0/);
  assert.match(html, /24 commands run/);
  assert.match(html, /earlier actions hidden/);
  assert.match(html, /summary-report\.md/);
  assert.doesNotMatch(html, /file:reports\/arxiv-agentic-rl/);
  assert.doesNotMatch(html, /Codex app-server|rich-client|收到事件后继续|Runtime event recorded|disabled|starting|ready|folded low-level events/i);
});

test('execution process folds user prompt echoes and runtime metadata placeholders out of actions', () => {
  const html = renderNativeStream([
    nativeEvent('message', 'User message', { rawType: 'message', role: 'user', text: 'run diff -u old.ts new.ts' }),
    nativeEvent('workspace-runtime-event', 'Prompt echo', { rawType: 'workspace-runtime-event', text: 'Use the shell tool to run exactly this command: diff -u old.ts new.ts. Do not edit files. After the command runs, report the exit code.' }),
    nativeEvent('operation-progress', '上下文窗口', { rawType: 'operation_progress', text: '上下文窗口' }),
    nativeEvent('operation-progress', 'Workspace Runtime', { rawType: 'operation_progress', text: 'Workspace Runtime' }),
    nativeEvent('tool-result', 'Tool result', { rawType: 'tool_completed', toolName: 'read_file', status: 'completed', filePath: 'PROJECT.md', text: 'PROJECT.md loaded' }),
  ]);

  assert.match(html, /Read PROJECT\.md/);
  assert.doesNotMatch(html, /Diff old\.ts|Use the shell tool|上下文窗口|Workspace Runtime/);
});

test('execution process folds tool-labeled prompt command echoes without rendering action summary', () => {
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'run_command',
      status: 'completed',
      text: 'Use the shell tool to run exactly this command: diff -u old.ts new.ts. Do not edit files. After the command runs, report the exit code.',
    }),
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'read_file',
      status: 'completed',
      filePath: 'PROJECT.md',
      text: 'PROJECT.md loaded',
    }),
  ]);

  assert.match(html, /Read PROJECT\.md/);
  assert.doesNotMatch(html, /Use the shell tool|run exactly|Do not edit|After the command runs|Diff old\.ts|Ran Use/);
});

test('execution process folds Chinese instruction echoes that are mislabeled as read tools', () => {
  const prompt = '请不要读取文件、不要运行命令、不要修改任何文件。仅用中文回答：SciForge 的聊天回复要怎样更像 Cursor Agent？';
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'read_file',
      status: 'completed',
      filePath: 'file',
      outputSummary: prompt,
      text: prompt,
    }),
  ], 'zh-CN');

  assert.equal(html, '');
});

test('execution process folds prompt echoes that are mislabeled as check actions', () => {
  const prompt = '请只读，不要修改文件。请阅读 PROJECT.md 和 src/ui/src/app/chat/RunExecutionProcess.tsx，然后用中文回答：先用两句结论说明 SciForge 的回复体验该如何更像 Cursor Agent；不要表格。';
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'check',
      status: 'completed',
      text: prompt,
      outputSummary: prompt,
    }),
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'read_file',
      status: 'completed',
      filePath: 'PROJECT.md',
      text: 'PROJECT.md loaded',
    }),
  ], 'zh-CN');

  assert.match(html, /读取 PROJECT\.md/);
  assert.doesNotMatch(html, /Checked|请只读|不要修改文件|Cursor Agent/);
});

test('execution process folds tool-name-only lifecycle rows but keeps real read evidence', () => {
  const lifecycleOnly = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'read_file',
      status: 'completed',
    }),
  ]);
  const realRead = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'read_file',
      status: 'completed',
      filePath: 'PROJECT.md',
      text: 'PROJECT.md loaded',
    }),
  ]);

  assert.equal(lifecycleOnly, '');
  assert.match(realRead, /Read PROJECT\.md/);
});

test('execution process replaces redacted path placeholders with readable action targets', () => {
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'read_file',
      status: 'failed',
      filePath: '[redacted-path]',
      text: 'Read [redacted-path] failed',
    }),
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'search',
      status: 'completed',
      text: 'Searched [redacted-path] 5 PROJECT.md 2>/dev/null',
    }),
  ]);

  assert.match(html, /Read file failed/);
  assert.match(html, /Searched PROJECT\.md/);
  assert.doesNotMatch(html, /\[redacted-path\]|\[local path\]/i);
});

test('execution process hides backend result envelopes from action details', () => {
  const backendEnvelope = JSON.stringify({
    item: {
      type: 'commandExecution',
      command: '/bin/zsh -lc "head -80 PROJECT.md"',
      cwd: '/Applications/workspace/private',
      processId: '123',
      source: 'unifiedExec',
      completedAtMs: 1780123227337,
    },
  });
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'exec_command',
      status: 'completed',
      command: '/bin/zsh -lc "head -80 PROJECT.md"',
      exitCode: 0,
      outputSummary: backendEnvelope,
      resultSummary: backendEnvelope,
      summary: backendEnvelope,
    }),
  ]);

  assert.match(html, /Read PROJECT\.md/);
  assert.doesNotMatch(html, /\/bin\/zsh -lc/);
  assert.doesNotMatch(html, /commandExecution|unifiedExec|processId|completedAtMs|Result\{|\[redacted-path\].*source/i);
});

test('execution process keeps trusted file preview on the row without section chrome', () => {
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'read_file',
      status: 'completed',
      filePath: 'PROJECT.md',
      fileRef: 'file:PROJECT.md',
      resultRef: 'artifact:project-read-summary',
      text: 'PROJECT.md loaded',
    }),
  ]);

  assert.match(html, /cursor-agent-action-focus/);
  assert.match(html, /project-read-summary/);
  assert.doesNotMatch(html, /artifact:project-read-summary/);
  assert.doesNotMatch(html, /Preview file|Details|<div class="cursor-agent-detail-section-title">/);
  assert.ok(html.indexOf('cursor-agent-action-focus') < html.indexOf('project-read-summary'), 'row click target should precede supporting refs');
});

test('execution process expands thought text as prose instead of a log block', () => {
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Thought', {
      rawType: 'tool_completed',
      toolName: 'process_summary',
      status: 'completed',
      outputSummary: 'The user wants responses to feel like a single document with lightweight process rows.',
    }),
  ]);

  assert.match(html, /cursor-agent-prose-output/);
  assert.match(html, /The user wants responses/);
  assert.doesNotMatch(html, /<pre class="cursor-agent-prose-output"/);
});

test('execution process reads nested runtime raw paths without trusting prompt text', () => {
  const html = renderNativeStream([{
    type: 'tool-result',
    label: 'Tool result',
    detail: 'Tool completed: read_file',
    createdAt: '2026-05-25T00:00:01.000Z',
    native: {
      backend: 'codex-app-server',
      raw: {
        type: 'tool_completed',
        toolName: 'read_file',
        status: 'completed',
        filePath: 'PROJECT.md',
        text: 'PROJECT.md loaded',
      },
    },
  }]);

  assert.match(html, /Read PROJECT\.md/);
  assert.match(html, /cursor-agent-action-focus/);
});

test('execution process derives trusted preview refs from read work evidence', () => {
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'read_file',
      status: 'completed',
      workEvidence: [{ kind: 'read', input: { path: 'PROJECT.md' } }],
    }),
  ]);

  assert.match(html, /cursor-agent-action-focus/);
  assert.doesNotMatch(html, /file:PROJECT\.md/);
});

test('execution process rejects unsafe read preview paths and audit refs', () => {
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'read_file',
      status: 'completed',
      filePath: '/tmp/secret.md',
      rawRef: 'file:.sciforge/logs/stdout.log',
      ref: 'trace:read-file',
      text: 'secret loaded',
    }),
  ]);

  assert.match(html, /Read secret\.md/);
  assert.doesNotMatch(html, /cursor-agent-action-focus/);
  assert.doesNotMatch(html, /file:\.sciforge\/logs\/stdout\.log|trace:read-file/);
});

test('execution process rejects unsafe direct file preview refs', () => {
  for (const fileRef of [
    'file:.sciforge/logs/stdout.log',
    'file:.sciforge/raw/provider.json',
    'file:C:/repo/PROJECT.md',
    'file:../secret.md',
    'file:https://example.test/a.md',
    'file:[local-path]/secret.md',
    'file:bad<name>.md',
    'file:bad?name.md',
    'artifact:/tmp/private-report',
    'artifact:../secret',
    'artifact:.sciforge/raw/provider',
    'artifact:~/secret',
    'artifact:reports/private-report',
  ]) {
    const html = renderNativeStream([
      nativeEvent('tool-result', 'Tool result', {
        rawType: 'tool_completed',
        toolName: 'read_file',
        status: 'completed',
        fileRef,
      }),
    ]);

    assert.doesNotMatch(html, /cursor-agent-action-focus/, fileRef);
    assert.doesNotMatch(html, /file:\.sciforge|file:C:|file:\.\.|example\.test|\[local-path\]|bad[<?]|artifact:\/tmp|artifact:\.\.|artifact:\.sciforge|artifact:~|reports\/private/, fileRef);
  }
});

test('execution process does not expose internal stdout stderr diff or transcript refs', () => {
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'shell',
      command: 'npm test',
      status: 'completed',
      stdoutRef: '.sciforge/logs/stdout.log',
      stderrRef: 'audit:codex-runtime:run-1:stderr',
      diffRef: 'trace:run-1-diff',
      transcriptRef: '.sciforge/raw/transcript.json',
      outputSummary: 'tests completed',
    }),
  ]);

  assert.match(html, /Ran npm test/);
  assert.doesNotMatch(html, /\.sciforge\/logs|\.sciforge\/raw|audit:|trace:|stdout\.log|stderr|transcript\.json/i);
});

test('execution process does not synthesize previews from non-file command targets', () => {
  for (const command of ['pwd', 'ls src']) {
    const html = renderNativeStream([
      nativeEvent('tool-result', 'Tool result', {
        rawType: 'tool_completed',
        toolName: 'shell',
        command,
        status: 'completed',
      }),
    ]);

    assert.match(html, command === 'pwd' ? /Read current workspace/ : /Read src/);
    assert.doesNotMatch(html, /cursor-agent-action-focus/);
    assert.doesNotMatch(html, /file:current workspace|file:src/);
  }
});

test('execution process promotes diff-like stdout into bounded diff detail', () => {
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'shell',
      command: "diff -u old.ts new.ts",
      status: 'completed',
      stdout: [
        '--- old.ts',
        '+++ new.ts',
        '@@ -1 +1 @@',
        '-const value = 1;',
        '+const value = 2;',
      ].join('\n'),
    }),
  ]);

  assert.match(html, /Diff new\.ts/);
  assert.match(html, /cursor-agent-diff/);
  assert.match(html, /@@ -1 \+1 @@/);
  assert.doesNotMatch(html, /Stdout:/);
});

test('execution process promotes diff-like output summary into diff detail', () => {
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'shell',
      command: "diff -u old.ts new.ts",
      status: 'failed',
      exitCode: 1,
      outputSummary: [
        '--- old.ts',
        '+++ new.ts',
        '@@ -1 +1 @@',
        '-before',
        '+after',
      ].join('\n'),
    }),
  ]);

  assert.match(html, /Diff new\.ts/);
  assert.doesNotMatch(html, /Diff new\.ts failed/);
  assert.match(html, /cursor-agent-diff/);
  assert.match(html, /@@ -1 \+1 @@/);
});

test('execution process renders structured diff text from completed command events', () => {
  const html = renderNativeStream([
    nativeEvent('tool-call', 'Tool call', {
      rawType: 'tool_started',
      toolName: 'shell',
      command: "diff -u old.ts new.ts",
      itemId: 'item-diff',
      status: 'running',
    }),
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'shell',
      command: "diff -u old.ts new.ts",
      itemId: 'item-diff',
      status: 'failed',
      exitCode: 1,
      outputSummary: '--- old.ts +++ new.ts @@ -1 +1 @@ -before +after',
      diff: [
        '--- old.ts',
        '+++ new.ts',
        '@@ -1 +1 @@',
        '-before',
        '+after',
      ].join('\n'),
    }),
  ]);

  assert.equal((html.match(/cursor-agent-action-diff/g) ?? []).length, 1);
  assert.match(html, /Diff new\.ts/);
  assert.match(html, /done/);
  assert.doesNotMatch(html, /Diff new\.ts running|Diff new\.ts failed/);
  assert.match(html, /cursor-agent-diff/);
  assert.match(html, /@@ -1 \+1 @@/);
});

test('execution process merges completed diff events that only carry lifecycle id and diff text', () => {
  const html = renderNativeStream([
    nativeEvent('tool-call', 'Tool call', {
      rawType: 'tool_started',
      toolName: 'shell',
      command: "diff -u old.ts new.ts",
      itemId: 'item-diff-only',
      status: 'running',
    }),
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      itemId: 'item-diff-only',
      status: 'failed',
      exitCode: 1,
      diff: [
        '--- old.ts',
        '+++ new.ts',
        '@@ -1 +1 @@',
        '-before',
        '+after',
      ].join('\n'),
    }),
  ]);

  assert.equal((html.match(/cursor-agent-action-diff/g) ?? []).length, 1);
  assert.match(html, /Diff new\.ts/);
  assert.match(html, /done/);
  assert.doesNotMatch(html, /Diff new\.ts running|Tool result|failed/);
  assert.match(html, /cursor-agent-diff/);
  assert.match(html, /@@ -1 \+1 @@/);
});

test('execution process treats no-output diff exit one as differences for quiet diff commands', () => {
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'shell',
      command: 'git diff --quiet -- src/ui/src/app.ts',
      status: 'failed',
      exitCode: 1,
    }),
  ]);

  assert.match(html, /Diff src\/ui\/src\/app\.ts/);
  assert.match(html, /done/);
  assert.doesNotMatch(html, /failed/);
});

test('execution process keeps failed non-diff commands failed even when output contains diff text', () => {
  const html = renderNativeStream([
    nativeEvent('tool-result', 'Tool result', {
      rawType: 'tool_completed',
      toolName: 'shell',
      command: 'npm test',
      status: 'failed',
      exitCode: 1,
      outputSummary: [
        'Snapshot mismatch:',
        '--- expected.snap',
        '+++ actual.snap',
        '@@ -1 +1 @@',
        '-before',
        '+after',
      ].join('\n'),
    }),
  ]);

  assert.equal((html.match(/cursor-agent-action-diff/g) ?? []).length, 0);
  assert.match(html, /Ran npm test · exit 1/);
  assert.match(html, /failed/);
  assert.doesNotMatch(html, /Diff actual\.snap|done/);
});

test('execution process merges sub-agent lifecycle and shows transcript affordance', () => {
  const html = renderNativeStream([
    nativeEvent('tool-call', 'Sub agent started', {
      rawType: 'tool_started',
      toolName: 'multi_agent_v1.spawn_agent',
      status: 'running',
      agentId: 'worker-7',
      parentAgentId: 'root-agent',
    }),
    nativeEvent('tool-result', 'Sub agent completed', {
      rawType: 'tool_completed',
      toolName: 'multi_agent_v1.spawn_agent',
      status: 'completed',
      agentId: 'worker-7',
      parentAgentId: 'root-agent',
      transcriptRef: 'artifact:subagent-transcript-1',
      resultSummary: 'Checked diff presentation gaps.',
      refs: ['artifact:subagent-transcript-1', 'trace:unsafe-subagent'],
    }),
  ]);

  assert.equal((html.match(/cursor-agent-action-subagent/g) ?? []).length, 1);
  assert.match(html, /1 sub agent/);
  assert.match(html, /Sub agent/);
  assert.match(html, /done/);
  assert.match(html, /Transcript/);
  assert.match(html, /subagent-transcript-1/);
  assert.doesNotMatch(html, /artifact:subagent-transcript-1/);
  assert.match(html, /Checked diff presentation gaps/);
  assert.ok(html.indexOf('subagent-transcript-1') < html.indexOf('Checked diff presentation gaps'));
  assert.doesNotMatch(html, /trace:unsafe-subagent|parentAgentId/);
});

test('execution process treats explicit app-server sub-agent MCP lifecycle as one action', () => {
  const html = renderNativeStream([
    nativeEvent('tool-call', 'Tool started', {
      rawType: 'tool_started',
      toolName: 'sciforge_subagents.multi_agent_v1.spawn_agent',
      status: 'inProgress',
      refs: ['file:PROJECT.md'],
      itemId: 'explicit-subagent-tool',
    }),
    nativeEvent('tool-result', 'Tool completed', {
      rawType: 'tool_completed',
      toolName: 'sciforge_subagents.multi_agent_v1.spawn_agent',
      status: 'completed',
      itemId: 'explicit-subagent-tool',
      agentId: 'explorer-42fc45dcfc3f',
      transcriptRef: 'artifact:subagent-transcript-42fc45dcfc3f',
      resultRef: 'artifact:subagent-result-42fc45dcfc3f',
      resultSummary: 'Read-only delegated worker completed. Request summary: call multi_agent_v1.spawn_agent once. Read only. read PROJECT.md only. Sub agent reads PROJECT.md. Main agent summarize. Do not use shell substitute. ... ll substitute.',
      outputSummary: '{ "ok": true, "resultSummary": "Request summary should stay folded" }',
      refs: ['artifact:subagent-result-42fc45dcfc3f', 'artifact:subagent-transcript-42fc45dcfc3f', 'file:PROJECT.md'],
    }),
    nativeEvent('text-delta', 'Assistant delta', {
      rawType: 'message_delta',
      text: 'agentId: explorer-42fc45dcfc3f\ntranscriptRef: artifact:subagent-transcript-42fc45dcfc3f\nresultRef: artifact:subagent-result-42fc45dcfc3f',
    }),
  ]);

  assert.equal((html.match(/cursor-agent-action-subagent/g) ?? []).length, 1);
  assert.match(html, /1 sub agent/);
  assert.doesNotMatch(html, /3 sub agents/);
  assert.match(html, /Sub agent/);
  assert.doesNotMatch(html, /Sub agent sub agent/);
  assert.match(html, /Read-only delegated worker completed/);
  assert.match(html, /subagent-result-42fc45dcfc3f/);
  assert.match(html, /subagent-transcript-42fc45dcfc3f/);
  assert.match(html, /PROJECT\.md/);
  assert.doesNotMatch(html, /artifact:subagent-result-42fc45dcfc3f|artifact:subagent-transcript-42fc45dcfc3f|file:PROJECT\.md/);
  assert.ok(html.indexOf('subagent-transcript-42fc45dcfc3f') < html.indexOf('Read-only delegated worker completed'));
  assert.ok(html.indexOf('subagent-result-42fc45dcfc3f') < html.indexOf('Read-only delegated worker completed'));
  assert.ok(html.indexOf('PROJECT.md') < html.indexOf('Read-only delegated worker completed'));
  assert.doesNotMatch(html, /Request summary|read PROJECT\.md only|Sub agent reads|Main agent summarize|Do not use shell substitute|ll substitute|should stay folded/);
});

test('execution process replaces sub-agent input refs with terminal result refs and aliases', () => {
  const html = renderNativeStream([
    nativeEvent('tool-call', 'Sub agent started', {
      rawType: 'tool_started',
      toolName: 'multi_agent_v1.spawn_agent',
      status: 'running',
      agentId: 'worker-result',
      refs: ['artifact:input-brief', 'file:notes/input.md'],
    }),
    nativeEvent('tool-result', 'Sub agent completed', {
      rawType: 'tool_completed',
      toolName: 'multi_agent_v1.spawn_agent',
      status: 'completed',
      agentId: 'worker-result',
      resultSummary: 'Produced a cleaned result bundle.',
      resultRef: 'artifact:subagent-result',
      result_ref: 'artifact:subagent-result-snake',
      artifactRef: 'subagent-artifact',
      outputRef: 'reports/subagent-output.md',
      evidenceRefs: ['artifact:subagent-evidence', 'file:reports/subagent-evidence.md', 'trace:unsafe-evidence'],
      refs: ['artifact:subagent-terminal-ref'],
    }),
  ]);

  assert.equal((html.match(/cursor-agent-action-subagent/g) ?? []).length, 1);
  assert.match(html, /Result/);
  assert.match(html, /Produced a cleaned result bundle/);
  assert.match(html, /subagent-result/);
  assert.match(html, /subagent-result-snake/);
  assert.match(html, /subagent-artifact/);
  assert.match(html, /subagent-output\.md/);
  assert.match(html, /subagent-evidence/);
  assert.match(html, /subagent-evidence\.md/);
  assert.match(html, /subagent-terminal-ref/);
  assert.doesNotMatch(html, /artifact:input-brief|file:notes\/input\.md|trace:unsafe-evidence|artifact:subagent-result|file:reports\/subagent/);
});

test('execution process keeps failed sub-agent terminal payloads failed instead of completed', () => {
  const okFalseHtml = renderNativeStream([
    nativeEvent('tool-result', 'Sub agent completed', {
      rawType: 'tool_completed',
      toolName: 'multi_agent_v1.spawn_agent',
      status: 'completed',
      agentId: 'worker-ok-false',
      ok: false,
      message: 'ok false sub-agent terminal',
      resultSummary: 'Worker rejected the requested result.',
    }),
  ]);
  const nestedFailedHtml = renderNativeStream([
    nativeEvent('tool-result', 'Sub agent completed', {
      rawType: 'tool_completed',
      toolName: 'multi_agent_v1.spawn_agent',
      status: 'completed',
      agentId: 'worker-nested-failed',
      message: 'nested failed sub-agent terminal',
      result: { status: 'failed', reason: 'contract validation failed' },
      resultSummary: 'Nested result reported failure.',
    }),
  ]);

  for (const html of [okFalseHtml, nestedFailedHtml]) {
    assert.equal((html.match(/cursor-agent-action-subagent/g) ?? []).length, 1);
    assert.match(html, /status-failed/);
    assert.match(html, /failed/);
    assert.doesNotMatch(html, />done</);
  }
});

test('stream process persistence drops internal refs and unsafe paths', () => {
  const response = attachStreamProcessToResponse({
    message: { id: 'msg-unsafe-stream', role: 'assistant', content: 'done', createdAt: '2026-05-25T00:00:02.000Z' },
    run: {
      id: 'run-unsafe-stream',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'read project',
      response: 'done',
      createdAt: '2026-05-25T00:00:00.000Z',
    },
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
  } as never, [agentStreamEvent({
    type: 'tool-result',
    label: 'Tool result',
    detail: 'Tool completed: read_file',
    raw: {
      type: 'tool_completed',
      toolName: 'read_file',
      status: 'completed',
      filePath: '/tmp/private-note.md',
      fileRef: 'trace:read-file',
      ref: 'trace:read-file',
      stdoutRef: '.sciforge/logs/stdout.log',
      stderrRef: 'audit:codex-runtime:run-unsafe-stream:stderr',
      diffRef: 'trace:run-unsafe-stream-diff',
      transcriptRef: '.sciforge/raw/transcript.json',
      workEvidence: [{ kind: 'read', input: { path: '/tmp/private-note.md' }, evidenceRefs: ['.sciforge/logs/stdout.log', 'trace:read-file'] }],
    },
  })]);
  const event = (((response as never as { run: { raw?: { streamProcess?: { events?: Array<{ native?: Record<string, unknown> }> } } } }).run.raw?.streamProcess?.events) ?? [])[0]?.native ?? {};

  assert.equal(event.filePath, undefined);
  assert.equal(event.fileRef, undefined);
  assert.equal(event.ref, undefined);
  assert.equal(event.stdoutRef, undefined);
  assert.equal(event.stderrRef, undefined);
  assert.equal(event.diffRef, undefined);
  assert.equal(event.transcriptRef, undefined);
  assert.equal(event.workEvidence, undefined);
});

test('stream process persistence redacts native text fields before storing replay records', () => {
  const response = attachStreamProcessToResponse({
    message: { id: 'msg-redacted-stream', role: 'assistant', content: 'done', createdAt: '2026-05-25T00:00:02.000Z' },
    run: {
      id: 'run-redacted-stream',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'check secrets',
      response: 'done',
      createdAt: '2026-05-25T00:00:00.000Z',
    },
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
  } as never, [agentStreamEvent({
    type: 'tool-result',
    label: 'Tool result Authorization: Bearer sk-label-secret-1234567890 https://provider.example/label',
    detail: 'Tool completed with Authorization: Bearer sk-detail-secret-1234567890',
    raw: {
      rawType: 'https://provider.example/raw-type?api_key=sk-rawtype-secret-1234567890',
      backend: 'https://provider.example/backend?token=sk-backend-secret-1234567890',
      toolName: 'shell/Authorization:Bearer-sk-tool-secret-1234567890',
      command: 'curl https://provider.example/v1 -H "Authorization: Bearer sk-command-secret-1234567890" /Applications/private/file',
      outputSummary: 'token=sk-output-secret-1234567890 https://provider.example/logs',
      resultSummary: 'Authorization: Bearer sk-result-secret-1234567890',
      text: '/Applications/private/text.txt sk-text-secret-1234567890',
      message: 'https://provider.example/message?token=secret-123456',
      status: 'Authorization: Bearer sk-status-secret-1234567890',
      itemId: 'https://provider.example/item?token=sk-item-secret-1234567890',
      traceStepId: '/Users/private/trace-step',
    },
  })]);
  const stored = JSON.stringify(response.run.raw);

  assert.doesNotMatch(stored, /provider\.example|sk-label-secret|sk-command-secret|sk-output-secret|sk-result-secret|sk-text-secret|sk-detail-secret|sk-rawtype-secret|sk-backend-secret|sk-tool-secret|sk-status-secret|sk-item-secret|\/Applications\/private|\/Users\/private|Authorization: Bearer sk-/);
  assert.match(stored, /redacted/);
});

test('stream process persistence drops backend result envelopes from replay summaries', () => {
  const backendEnvelope = JSON.stringify({
    item: {
      type: 'commandExecution',
      command: '/bin/zsh -lc "head PROJECT.md"',
      cwd: '/Applications/workspace/private',
      processId: '123',
      source: 'unifiedExec',
    },
  });
  const response = attachStreamProcessToResponse({
    message: { id: 'msg-envelope-stream', role: 'assistant', content: 'done', createdAt: '2026-05-25T00:00:02.000Z' },
    run: {
      id: 'run-envelope-stream',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'read project',
      response: 'done',
      createdAt: '2026-05-25T00:00:00.000Z',
    },
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
  } as never, [agentStreamEvent({
    type: 'tool-result',
    label: 'Tool result',
    detail: 'Tool completed: shell',
    raw: {
      type: 'tool_completed',
      toolName: 'exec_command',
      command: '/bin/zsh -lc "head PROJECT.md"',
      outputSummary: backendEnvelope,
      resultSummary: backendEnvelope,
      summary: backendEnvelope,
    },
  })]);
  const event = (((response as never as { run: { raw?: { streamProcess?: { events?: Array<{ native?: Record<string, unknown> }> } } } }).run.raw?.streamProcess?.events) ?? [])[0]?.native ?? {};

  assert.equal(event.outputSummary, undefined);
  assert.equal(event.resultSummary, undefined);
  assert.doesNotMatch(JSON.stringify(event), /commandExecution|unifiedExec|processId|\/Applications\/workspace/);
});

test('stream process persistence keeps safe sub-agent lifecycle fields', () => {
  const response = attachStreamProcessToResponse({
    message: { id: 'msg-subagent-stream', role: 'assistant', content: 'done', createdAt: '2026-05-25T00:00:02.000Z' },
    run: {
      id: 'run-subagent-stream',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'delegate audit',
      response: 'done',
      createdAt: '2026-05-25T00:00:00.000Z',
    },
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
  } as never, [agentStreamEvent({
    type: 'tool-result',
    label: 'Tool result',
    detail: 'Tool completed: multi_agent_v1.spawn_agent',
    raw: {
      type: 'tool_completed',
      toolName: 'multi_agent_v1.spawn_agent',
      status: 'completed',
      agentId: 'worker-7',
      parentAgentId: 'root-agent',
      transcriptRef: 'artifact:subagent-transcript-1',
      resultSummary: 'Checked diff presentation gaps.',
      refs: ['artifact:subagent-transcript-1', 'trace:unsafe-subagent', '.sciforge/raw/transcript.json'],
    },
  })]);
  const event = (((response as never as { run: { raw?: { streamProcess?: { events?: Array<{ native?: Record<string, unknown> }> } } } }).run.raw?.streamProcess?.events) ?? [])[0]?.native ?? {};

  assert.equal(event.agentId, 'worker-7');
  assert.equal(event.parentAgentId, 'root-agent');
  assert.equal(event.transcriptRef, 'artifact:subagent-transcript-1');
  assert.equal(event.resultSummary, 'Checked diff presentation gaps.');
  assert.deepEqual(event.refs, ['artifact:subagent-transcript-1']);
});

test('stream process persistence keeps redacted unified diff text for replay detail', () => {
  const response = attachStreamProcessToResponse({
    message: { id: 'msg-diff-stream', role: 'assistant', content: 'done', createdAt: '2026-05-25T00:00:02.000Z' },
    run: {
      id: 'run-diff-stream',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'show diff',
      response: 'done',
      createdAt: '2026-05-25T00:00:00.000Z',
    },
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
  } as never, [agentStreamEvent({
    type: 'tool-result',
    label: 'Tool result',
    detail: 'Tool completed: shell',
    raw: {
      type: 'tool_completed',
      toolName: 'shell',
      command: 'diff -u old.ts new.ts',
      status: 'completed',
      stdout: [
        '--- /tmp/private/old.ts',
        '+++ new.ts',
        '@@ -1 +1 @@',
        '-const token = sk-super-secret-value-1234567890;',
        '+const token = ok;',
      ].join('\n'),
    },
  })]);
  const streamEvents = (((response as never as { run: { raw?: { streamProcess?: { events?: Array<{ native?: Record<string, unknown> }> } } } }).run.raw?.streamProcess?.events) ?? []);

  assert.match(String(streamEvents[0]?.native?.diff), /@@ -1 \+1 @@/);
  assert.doesNotMatch(String(streamEvents[0]?.native?.diff), /\/tmp\/private|sk-super-secret/);
  const html = renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-diff-stream',
    session: { ...session([]), runs: [response.run] as never, executionUnits: [] },
    onObjectFocus: () => undefined,
  }));
  assert.match(html, /cursor-agent-diff/);
  assert.match(html, /redacted/);
});

test('stream process persistence keeps nested raw paths and work evidence aliases for replay previews', () => {
  const response = attachStreamProcessToResponse({
    message: { id: 'msg-nested-stream', role: 'assistant', content: 'done', createdAt: '2026-05-25T00:00:02.000Z' },
    run: {
      id: 'run-nested-stream',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'read project',
      response: 'done',
      createdAt: '2026-05-25T00:00:00.000Z',
    },
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
  } as never, [agentStreamEvent({
    type: 'tool-result',
    label: 'Tool result',
    detail: 'Tool completed: read_file',
    raw: {
      native: {
        raw: { type: 'tool_completed', toolName: 'read_file', status: 'completed', filePath: 'PROJECT.md' },
      },
      workEvidence: [{ kind: 'read', input: { filename: 'PROJECT.md' } }],
    },
  })]);
  const streamEvents = (((response as never as { run: { raw?: { streamProcess?: { events?: Array<{ native?: Record<string, unknown> }> } } } }).run.raw?.streamProcess?.events) ?? []);

  assert.equal(streamEvents[0]?.native?.filePath, 'PROJECT.md');
  assert.deepEqual(streamEvents[0]?.native?.workEvidence, [{ kind: 'read', input: { path: 'PROJECT.md' } }]);
  const html = renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-nested-stream',
    session: { ...session([]), runs: [response.run] as never, executionUnits: [] },
    onObjectFocus: () => undefined,
  }));
  assert.match(html, /cursor-agent-action-focus/);
});

test('stream process persistence keeps safe read file paths for replay previews', () => {
  const response = attachStreamProcessToResponse({
    message: { id: 'msg-run', role: 'assistant', content: 'done', createdAt: '2026-05-25T00:00:02.000Z' },
    run: {
      id: 'run-persisted-stream',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'read project',
      response: 'done',
      createdAt: '2026-05-25T00:00:00.000Z',
    },
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
  } as never, [agentStreamEvent({
    type: 'tool-result',
    label: 'Tool result',
    detail: 'Tool completed: read_file',
    raw: { type: 'tool_completed', toolName: 'read_file', status: 'completed', filePath: 'PROJECT.md' },
  })]);
  const streamEvents = (((response as never as { run: { raw?: { streamProcess?: { events?: Array<{ native?: Record<string, unknown> }> } } } }).run.raw?.streamProcess?.events) ?? []);

  assert.equal(streamEvents[0]?.native?.filePath, 'PROJECT.md');
  assert.equal(streamEvents[0]?.native?.fileRef, undefined);
  const html = renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-persisted-stream',
    session: { ...session([]), runs: [response.run] as never, executionUnits: [] },
    onObjectFocus: () => undefined,
  }));
  assert.match(html, /Read PROJECT\.md/);
  assert.match(html, /cursor-agent-action-focus/);
});

test('execution process distinguishes verification states from execution success', () => {
  const html = renderProcess([
    executionUnit({ id: 'ordinary', status: 'done' }),
    executionUnit({ id: 'unverified', status: 'done', verificationVerdict: 'unverified', verificationRef: 'verification:unverified' }),
    executionUnit({ id: 'verifying', status: 'running', outputRef: 'artifact:partial-report' }),
    executionUnit({ id: 'verify-failed', status: 'done', verificationVerdict: 'fail', verificationRef: 'verification:failed' }),
    executionUnit({ id: 'verify-passed', status: 'done', verificationVerdict: 'pass', verificationRef: 'verification:passed' }),
  ]);

  assert.equal(html, '');
});

test('execution process keeps final Runtime Codex metadata out of the default process stream', () => {
  const html = renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-runtime-metadata',
    session: withMaterializedProjectionFixture({
      ...session([]),
      runs: [{
        id: 'run-runtime-metadata',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'runtime metadata visible',
        response: 'done',
        createdAt: '2026-05-25T00:00:00.000Z',
        raw: {
          displayIntent: {
            conversationProjection: {
              schemaVersion: 'sciforge.conversation-projection.v1',
              conversationId: 'runtime-metadata',
              visibleAnswer: { status: 'satisfied', text: 'Runtime answer rendered.', artifactRefs: [] },
              artifacts: [],
              executionProcess: [{
                eventId: 'runtime-metadata:gui-present',
                type: 'GuiPresent',
                summary: 'Runtime Codex answer rendered through gui.present.',
                timestamp: '2026-05-25T00:00:01.000Z',
              }],
              recoverActions: [],
              verificationState: { status: 'unverified' },
              runtimeMetadata: {
                provider: 'sciforge-deepseek-proxy',
                model: 'bailian/deepseek-v4-flash',
                profile: 'sciforge-runtime-deepseek',
                workspace: '/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p1',
                commandId: 'codex-command-visible',
                attemptId: 'codex-command-visible-attempt-1',
                auditRefs: ['audit:codex-runtime:codex-command-visible:codex-command-visible-attempt-1:raw-jsonl'],
                foldedAudit: true,
              },
              auditRefs: ['audit:codex-runtime:codex-command-visible:codex-command-visible-attempt-1:raw-jsonl'],
              diagnostics: [],
            },
          },
        },
      }],
      executionUnits: [],
    }),
    onObjectFocus: () => undefined,
  }));

  assert.equal(html, '');
  assert.doesNotMatch(html, /Agent runtime|service|configured|local workspace|trace|诊断引用已收起/);
  assert.doesNotMatch(html, /sciforge-deepseek-proxy|bailian\/deepseek-v4-flash|sciforge-runtime-deepseek|\/Applications\/workspace|codex-command-visible|RAW_JSONL|RAW_STDERR|RAW_STDOUT|stderr|stdout/i);
});

function renderProcess(executionUnits: RuntimeExecutionUnit[]) {
  return renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-1',
    session: session(executionUnits),
    onObjectFocus: () => undefined,
  }));
}

function renderNativeStream(events: Array<Record<string, unknown>>, locale?: 'zh-CN' | 'en-US', prompt = 'native stream please') {
  return renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-native-stream-test',
    session: {
      ...session([]),
      runs: [{
        id: 'run-native-stream-test',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt,
        response: 'done',
        createdAt: '2026-05-25T00:00:00.000Z',
        raw: { streamProcess: { eventCount: events.length, events } },
      }],
      executionUnits: [],
    },
    onObjectFocus: () => undefined,
    locale,
  }));
}

function session(executionUnits: RuntimeExecutionUnit[]): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-1',
    scenarioId: 'literature-evidence-review',
    title: 'test session',
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-1',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'make report',
      response: 'done',
      createdAt: '2026-05-12T00:00:00.000Z',
      raw: { payload: { executionUnits } },
    }],
    uiManifest: [],
    claims: [],
    executionUnits,
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
  };
}

function withMaterializedProjectionFixture(session: SciForgeSession): SciForgeSession {
  const projection = session.runs.map(conversationProjectionMigrationAuditFixtureForRun).find(Boolean);
  return projection ? { ...session, materializedConversationProjection: projection } as SciForgeSession : session;
}

function executionUnit(overrides: Partial<RuntimeExecutionUnit>): RuntimeExecutionUnit {
  return {
    id: 'unit',
    tool: 'validator',
    params: '',
    status: 'done',
    hash: 'hash',
    runId: 'run-1',
    ...overrides,
  };
}

function nativeEvent(type: string, label: string, native: Record<string, unknown>) {
  return nativeEventAt('2026-05-25T00:00:01.000Z', type, label, native);
}

function nativeEventAt(createdAt: string, type: string, label: string, native: Record<string, unknown>) {
  return {
    type,
    label,
    detail: typeof native.text === 'string' ? native.text : undefined,
    createdAt,
    native: {
      backend: 'codex-app-server',
      ...native,
    },
  };
}

function agentStreamEvent(overrides: Partial<AgentStreamEvent>): AgentStreamEvent {
  return {
    id: 'evt-read-path',
    type: 'workspace-runtime-event',
    label: 'Runtime event',
    createdAt: '2026-05-25T00:00:01.000Z',
    ...overrides,
  };
}

function assertNoInternalTerms(html: string) {
  for (const pattern of [
    /\bConversationProjection\b/,
    /\bExecutionUnit\b/,
    /\bArtifactDelivery\b/,
    /\bnative-message\b/i,
    /\blive-runtime-codex\b/i,
    /\braw\s+JSONL\b/i,
    /\bSSE\b/,
    /\bstdout\b/i,
    /\bstderr\b/i,
  ]) {
    assert.doesNotMatch(html, pattern);
  }
}
