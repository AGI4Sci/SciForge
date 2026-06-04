import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codexSessionIdFromRaw,
  exitEvent,
  normalizeCodexJsonlEvent,
  stderrAuditEvent,
  type CodexRuntimeMetadata,
} from './codex-event-normalizer.js';

const metadata: CodexRuntimeMetadata = {
  provider: 'sciforge-deepseek-proxy',
  model: 'bailian/deepseek-v4-flash',
  profile: 'sciforge-runtime-deepseek',
  workspace: '/tmp/sciforge-workspace',
  commandId: 'codex-test',
  attemptId: 'codex-test-attempt-1',
  evidenceRefs: ['audit:codex-runtime:codex-test:codex-test-attempt-1:normalized-events'],
  resumeRequested: false,
};

test('normalizes stdout JSONL into stable GUI-facing events with runtime metadata', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'agent_message_delta',
    delta: 'hello',
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[0]?.status, 'raw-jsonl');
  assert.equal(events[1]?.type, 'message_delta');
  assert.equal(events[1]?.text, 'hello');
  assert.equal(events[1]?.provider, metadata.provider);
  assert.equal(events[1]?.model, metadata.model);
  assert.equal(events[1]?.profile, metadata.profile);
  assert.equal(events[1]?.workspace, metadata.workspace);
  assert.equal(events[1]?.commandId, metadata.commandId);
});

test('maps Codex tool activity into normalized tool lifecycle events', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.started',
    item: { id: 'item-1', name: 'exec_command' },
  }, metadata);

  assert.equal(events.at(-1)?.type, 'tool_started');
  assert.equal(events.at(-1)?.toolName, 'exec_command');
  assert.equal(events.at(-1)?.itemId, 'item-1');
});

test('promotes safe structured file tool paths into trusted preview refs', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.completed',
    item: {
      id: 'item-read',
      type: 'function_call',
      name: 'read_file',
      arguments: JSON.stringify({ path: 'PROJECT.md' }),
      status: 'completed',
    },
  }, metadata);

  const toolEvent = events.at(-1);
  assert.equal(toolEvent?.type, 'tool_completed');
  assert.equal(toolEvent?.toolName, 'read_file');
  assert.equal(toolEvent?.filePath, 'PROJECT.md');
  assert.equal(toolEvent?.fileRef, 'file:PROJECT.md');
});

test('promotes safe sub-agent lifecycle refs without exposing transcript bodies', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.completed',
    item: {
      id: 'subagent-call-1',
      type: 'function_call',
      name: 'multi_agent_v1.spawn_agent',
      arguments: JSON.stringify({
        agentId: '019e7649-worker',
        parentAgentId: 'root-agent',
        ref: 'artifact:input-placeholder',
        transcriptRef: 'transcript:input-placeholder',
        refs: ['artifact:input-placeholder'],
      }),
      result: JSON.stringify({
        agentId: '019e7649-worker',
        parentAgentId: 'root-agent',
        ref: 'artifact:subagent-result',
        transcriptRef: 'transcript:worker-1',
        resultSummary: 'Read-only diff audit completed.',
        transcript: 'RAW TRANSCRIPT BODY SHOULD STAY RAW-ONLY',
        refs: ['artifact:subagent-result', 'trace:unsafe-ref'],
      }),
      status: 'completed',
    },
  }, metadata);

  const toolEvent = events.at(-1);
  assert.equal(toolEvent?.type, 'tool_completed');
  assert.equal(toolEvent?.toolName, 'multi_agent_v1.spawn_agent');
  assert.equal(toolEvent?.agentId, '019e7649-worker');
  assert.equal(toolEvent?.parentAgentId, 'root-agent');
  assert.equal(toolEvent?.ref, 'artifact:subagent-result');
  assert.equal(toolEvent?.transcriptRef, 'transcript:worker-1');
  assert.deepEqual(toolEvent?.refs, ['artifact:subagent-result']);
  assert.match(toolEvent?.resultSummary ?? '', /Read-only diff audit/);
  assert.doesNotMatch(JSON.stringify(toolEvent), /RAW TRANSCRIPT BODY|trace:unsafe-ref|input-placeholder/);
  assert.doesNotMatch(JSON.stringify(events), /RAW TRANSCRIPT BODY|trace:unsafe-ref|input-placeholder/);
});

test('promotes expanded safe sub-agent lifecycle metadata for process projection', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.completed',
    item: {
      id: 'subagent-call-expanded',
      type: 'function_call',
      name: 'multi_agent_v1.spawn_agent',
      result: JSON.stringify({
        ok: true,
        agentId: 'review-worker-abc123',
        parentAgentId: 'parent-command-1',
        agentType: 'review-worker',
        status: 'completed',
        resultSummary: 'Safe sub-agent lifecycle summary.',
        resultRef: 'artifact:subagent-result-abc123',
        transcriptRef: 'artifact:subagent-transcript-abc123',
        refs: [
          'artifact:subagent-result-abc123',
          'artifact:subagent-transcript-abc123',
          'subagent:review-worker-abc123',
          'trace:unsafe-ref',
        ],
        durationMs: 42,
        background: {
          runInBackground: true,
          stateRef: 'subagent:review-worker-abc123',
          providerUrl: 'https://provider.example/v1',
        },
        resume: {
          resumeRequested: true,
          resumeRef: 'subagent:resume-candidate',
          resumeBoundary: 'explicit',
          apiKey: 'sk-secret-123456789',
        },
        rawTranscript: 'RAW TRANSCRIPT BODY SHOULD STAY RAW-ONLY',
      }),
      status: 'completed',
    },
  }, metadata);

  const toolEvent = events.at(-1);
  assert.equal(toolEvent?.type, 'tool_completed');
  assert.equal(toolEvent?.agentId, 'review-worker-abc123');
  assert.equal(toolEvent?.parentAgentId, 'parent-command-1');
  assert.equal(toolEvent?.agentType, 'review-worker');
  assert.equal(toolEvent?.status, 'completed');
  assert.equal(toolEvent?.resultRef, 'artifact:subagent-result-abc123');
  assert.equal(toolEvent?.transcriptRef, 'artifact:subagent-transcript-abc123');
  assert.equal(toolEvent?.durationMs, 42);
  assert.deepEqual(toolEvent?.background, {
    runInBackground: true,
    stateRef: 'subagent:review-worker-abc123',
  });
  assert.deepEqual(toolEvent?.resume, {
    resumeRequested: true,
    resumeRef: 'subagent:resume-candidate',
    resumeBoundary: 'explicit',
  });
  assert.deepEqual(toolEvent?.refs, [
    'artifact:subagent-result-abc123',
    'artifact:subagent-transcript-abc123',
    'subagent:review-worker-abc123',
  ]);
  assert.doesNotMatch(JSON.stringify(toolEvent), /RAW TRANSCRIPT BODY|trace:unsafe-ref|provider\.example|sk-secret|apiKey/i);
});

test('normalizes MCP structuredContent sub-agent output into safe lifecycle refs', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.completed',
    item: {
      id: 'subagent-call-mcp-wrapper',
      type: 'function_call',
      name: 'multi_agent_v1.spawn_agent',
      output: {
        structuredContent: {
          agentId: '019e7649-worker',
          parentAgentId: 'root-agent',
          agentType: 'review-worker',
          status: 'completed',
          resultSummary: 'MCP structured sub-agent completed.',
          resultRef: 'artifact:subagent-result-mcp',
          transcriptRef: 'transcript:worker-mcp',
          refs: [
            'artifact:subagent-result-mcp',
            'transcript:worker-mcp',
            'trace:unsafe-ref',
          ],
          background: {
            runInBackground: true,
            stateRef: 'subagent:019e7649-worker',
            providerUrl: 'https://provider.example/v1',
          },
          resume: {
            resumeRequested: true,
            resumeRef: 'subagent:resume-mcp',
            resumeBoundary: 'explicit',
            apiKey: 'sk-secret-123456789',
          },
          rawTranscript: 'RAW TRANSCRIPT BODY SHOULD STAY RAW-ONLY',
        },
      },
      status: 'completed',
    },
  }, metadata);

  const toolEvent = events.at(-1);
  assert.equal(toolEvent?.type, 'tool_completed');
  assert.equal(toolEvent?.toolName, 'multi_agent_v1.spawn_agent');
  assert.equal(toolEvent?.agentId, '019e7649-worker');
  assert.equal(toolEvent?.parentAgentId, 'root-agent');
  assert.equal(toolEvent?.agentType, 'review-worker');
  assert.equal(toolEvent?.status, 'completed');
  assert.equal(toolEvent?.ref, 'artifact:subagent-result-mcp');
  assert.equal(toolEvent?.resultRef, 'artifact:subagent-result-mcp');
  assert.equal(toolEvent?.transcriptRef, 'transcript:worker-mcp');
  assert.deepEqual(toolEvent?.refs, [
    'artifact:subagent-result-mcp',
    'transcript:worker-mcp',
  ]);
  assert.deepEqual(toolEvent?.background, {
    runInBackground: true,
    stateRef: 'subagent:019e7649-worker',
  });
  assert.deepEqual(toolEvent?.resume, {
    resumeRequested: true,
    resumeRef: 'subagent:resume-mcp',
    resumeBoundary: 'explicit',
  });
  assert.match(toolEvent?.resultSummary ?? '', /MCP structured sub-agent/);
  assert.doesNotMatch(JSON.stringify(toolEvent), /RAW TRANSCRIPT BODY|trace:unsafe-ref|provider\.example|sk-secret|apiKey/i);
  assert.doesNotMatch(JSON.stringify(events), /RAW TRANSCRIPT BODY|trace:unsafe-ref|provider\.example|sk-secret|apiKey/i);
});

test('drops unsafe sub-agent transcript refs', () => {
  for (const transcriptRef of [
    '.sciforge/raw/transcript.json',
    'trace:subagent-transcript',
    'audit:subagent-transcript',
    '/tmp/subagent-transcript.json',
    'artifact:../secret',
  ]) {
    const events = normalizeCodexJsonlEvent({
      type: 'item.completed',
      item: {
        id: 'subagent-call-unsafe',
        type: 'function_call',
        name: 'spawn_agent',
        result: JSON.stringify({ agentId: 'worker-safe', transcriptRef }),
        status: 'completed',
      },
    }, metadata);

    const toolEvent = events.at(-1);
    assert.equal(toolEvent?.agentId, 'worker-safe');
    assert.equal(toolEvent?.transcriptRef, undefined, transcriptRef);
  }
});

test('promotes safe file paths from started and payload-shaped tool events', () => {
  const started = normalizeCodexJsonlEvent({
    type: 'item.started',
    payload: {
      item: {
        id: 'item-start-read',
        type: 'function_call',
        name: 'read_file',
        input: { file_path: 'docs/agent-desktop-alignment-evidence/live-ledger-2026-05-30.json' },
        status: 'in_progress',
      },
    },
  }, metadata);
  const edited = normalizeCodexJsonlEvent({
    type: 'item.completed',
    item: {
      id: 'item-edit',
      type: 'function_call',
      name: 'edit',
      parameters: { input: { filename: 'src/ui/src/app/chat/cursorAgentProcess.ts' } },
      status: 'completed',
    },
  }, metadata);

  assert.equal(started.at(-1)?.type, 'tool_started');
  assert.equal(started.at(-1)?.filePath, 'docs/agent-desktop-alignment-evidence/live-ledger-2026-05-30.json');
  assert.equal(started.at(-1)?.fileRef, 'file:docs/agent-desktop-alignment-evidence/live-ledger-2026-05-30.json');
  assert.equal(edited.at(-1)?.toolName, 'edit');
  assert.equal(edited.at(-1)?.filePath, 'src/ui/src/app/chat/cursorAgentProcess.ts');
  assert.equal(edited.at(-1)?.fileRef, 'file:src/ui/src/app/chat/cursorAgentProcess.ts');
});

test('does not promote unsafe file tool paths or opaque refs into previews', () => {
  for (const ref of [
    'trace:read-file',
    'file:.sciforge/logs/stdout.log',
    'artifact:/tmp/private-report',
    'artifact:../secret',
    'artifact:.sciforge/raw/provider',
    'artifact:~/secret',
    'artifact:reports/private-report',
  ]) {
    const events = normalizeCodexJsonlEvent({
      type: 'item.completed',
      item: {
        id: 'item-read-unsafe',
        type: 'function_call',
        name: 'read_file',
        arguments: JSON.stringify({
          path: '/tmp/private-note.md',
          ref,
          fileRef: ref,
        }),
        status: 'completed',
      },
    }, metadata);

    const toolEvent = events.at(-1);
    assert.equal(toolEvent?.type, 'tool_completed');
    assert.equal(toolEvent?.filePath, undefined, ref);
    assert.equal(toolEvent?.fileRef, undefined, ref);
  }
});

test('maps Codex command_execution items into shell lifecycle details', () => {
  const started = normalizeCodexJsonlEvent({
    type: 'item.started',
    item: {
      id: 'item-shell',
      type: 'command_execution',
      command: "/bin/zsh -lc 'cat PROJECT.md | head -20'",
      status: 'in_progress',
    },
  }, metadata);
  const completed = normalizeCodexJsonlEvent({
    type: 'item.completed',
    item: {
      id: 'item-shell',
      type: 'command_execution',
      command: "/bin/zsh -lc 'cat PROJECT.md | head -20'",
      aggregated_output: 'PROJECT heading and protocol summary\nsecond line',
      exit_code: 0,
      status: 'completed',
    },
  }, metadata);

  assert.equal(started.at(-1)?.type, 'tool_started');
  assert.equal(started.at(-1)?.toolName, 'shell');
  assert.equal(started.at(-1)?.command, "/bin/zsh -lc 'cat PROJECT.md | head -20'");
  assert.match(started.at(-1)?.message ?? '', /Shell command started/);
  assert.equal(completed.at(-1)?.type, 'tool_completed');
  assert.equal(completed.at(-1)?.toolName, 'shell');
  assert.equal(completed.at(-1)?.exitCode, 0);
  assert.match(completed.at(-1)?.message ?? '', /output=PROJECT heading/);
});

test('preserves command_execution unified diff output as structured diff detail', () => {
  const completed = normalizeCodexJsonlEvent({
    type: 'item.completed',
    item: {
      id: 'item-diff',
      type: 'command_execution',
      command: "/bin/zsh -lc 'diff -u old.ts new.ts'",
      aggregated_output: [
        '--- old.ts',
        '+++ new.ts',
        '@@ -1 +1 @@',
        '-before',
        '+after',
      ].join('\n'),
      exit_code: 1,
      status: 'failed',
    },
  }, metadata);

  const event = completed.at(-1);
  assert.equal(event?.type, 'tool_completed');
  assert.equal(event?.exitCode, 1);
  assert.match(event?.diff ?? '', /@@ -1 \+1 @@/);
  assert.match(event?.outputSummary ?? '', /^--- old\.ts \+\+\+ new\.ts/);
});

test('maps native Codex response_item function calls into tool lifecycle events', () => {
  const started = normalizeCodexJsonlEvent({
    type: 'response_item',
    payload: {
      id: 'fc-1',
      type: 'function_call',
      call_id: 'call-shell-1',
      name: 'shell',
      arguments: JSON.stringify({ cmd: "diff -u old.ts new.ts" }),
      status: 'in_progress',
    },
  }, metadata);
  const completed = normalizeCodexJsonlEvent({
    type: 'response_item',
    payload: {
      type: 'function_call_output',
      call_id: 'call-shell-1',
      output: [
        '--- old.ts',
        '+++ new.ts',
        '@@ -1 +1 @@',
        '-before',
        '+after',
      ].join('\n'),
    },
  }, metadata);

  assert.equal(started.at(-1)?.type, 'tool_started');
  assert.equal(started.at(-1)?.itemId, 'call-shell-1');
  assert.equal(started.at(-1)?.toolName, 'shell');
  assert.equal(started.at(-1)?.command, 'diff -u old.ts new.ts');
  assert.equal(completed.at(-1)?.type, 'tool_completed');
  assert.equal(completed.at(-1)?.itemId, 'call-shell-1');
  assert.match(completed.at(-1)?.diff ?? '', /@@ -1 \+1 @@/);
});

test('maps Codex item.completed agent_message into a visible message event', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.completed',
    item: {
      id: 'item-2',
      type: 'agent_message',
      text: 'SCIFORGE-MT-5173',
    },
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[1]?.type, 'message');
  assert.equal(events[1]?.text, 'SCIFORGE-MT-5173');
  assert.equal(events[1]?.itemId, 'item-2');
});

test('maps native Codex response_item payload messages into visible message events', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Report written to tasks/output/report.md' }],
    },
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[1]?.type, 'message');
  assert.equal(events[1]?.text, 'Report written to tasks/output/report.md');
});

test('keeps native Codex reconnecting provider errors as retry audit instead of failed', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'error',
    message: 'Reconnecting... 1/5 (unexpected status 502 Bad Gateway: Unknown error, url: http://127.0.0.1:3891/v1/responses)',
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[0]?.status, 'raw-jsonl');
  assert.equal(events[1]?.type, 'audit');
  assert.equal(events[1]?.status, 'provider-retry');
  assert.equal(events.some((event) => event.type === 'failed'), false);
});

test('maps terminal native Codex error payload messages into failed events', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'turn.failed',
    error: {
      message: 'unexpected status 502 Bad Gateway: Unknown error, url: http://127.0.0.1:3891/v1/responses',
    },
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[1]?.type, 'failed');
  assert.match(events[1]?.message ?? '', /502 Bad Gateway/);
});

test('maps completed gui.present tool calls into explicit completion events', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.completed',
    item: {
      id: 'item-gui-present',
      type: 'function_call',
      name: 'gui.present',
      arguments: JSON.stringify({
        intent: 'show-result',
        title: 'Runtime answer',
        content: { kind: 'markdown', value: 'VISIBLE_GUI_PRESENT_RESULT' },
        hint: 'markdown',
      }),
      result: JSON.stringify({
        ok: true,
        placement: { panel: 'chat', viewId: 'runtime-answer' },
      }),
    },
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[1]?.type, 'gui_present');
  assert.equal(events[1]?.text, 'VISIBLE_GUI_PRESENT_RESULT');
  assert.equal(events[1]?.message, 'VISIBLE_GUI_PRESENT_RESULT');
  assert.equal((events[1]?.raw as { boundary?: string }).boundary, 'gui-present-completion');
  assert.equal(((events[1]?.raw as { presentation?: { source?: string } }).presentation)?.source, 'gui.present:codex-test');
  assert.equal(((events[1]?.raw as { presentation?: { hint?: string } }).presentation)?.hint, 'markdown');
});

test('maps completed gui.ask_user tool calls into explicit confirmation events', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.completed',
    item: {
      id: 'item-gui-ask-user',
      type: 'function_call',
      name: 'gui.ask_user',
      arguments: JSON.stringify({
        kind: 'confirmation',
        title: 'Computer Use confirmation required',
        message: 'Allow Computer Use to click the visible Submit button?',
        choices: [
          { label: 'Approve', commandText: '/computer-use approve --approval-ref approval-1', style: 'primary' },
          { label: 'Cancel', commandText: '/computer-use reject --approval-ref approval-1' },
        ],
        relatedRefs: ['.sciforge/vision-runs/run-1/vision-trace.json'],
        approvalRequest: {
          id: 'approval-1',
          riskLevel: 'high',
          actionRef: 'ref:planned-action:submit',
        },
      }),
      result: JSON.stringify({
        ok: true,
        placement: { panel: 'modal', viewId: 'gui-ask-3' },
      }),
    },
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[1]?.type, 'gui_ask_user');
  assert.equal(events[1]?.status, 'needs-confirmation');
  assert.match(events[1]?.text ?? '', /Confirmation required/);
  assert.match(events[1]?.text ?? '', /Risk: High/);
  assert.doesNotMatch(events[1]?.text ?? '', /Computer Use|approval-1/);
  assert.equal((events[1]?.raw as { boundary?: string }).boundary, 'gui-ask-user-confirmation');
  const askUser = (events[1]?.raw as { askUser?: { source?: string; relatedRefs?: string[]; choices?: Array<{ commandText?: string }> } }).askUser;
  assert.equal(askUser?.source, 'gui.ask_user:codex-test');
  assert.deepEqual(askUser?.relatedRefs, ['.sciforge/vision-runs/run-1/vision-trace.json']);
  assert.equal(askUser?.choices?.[0]?.commandText, '/computer-use approve --approval-ref approval-1');
});

test('maps completed module.invoke gui present into the same visible GUI event', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.completed',
    item: {
      id: 'item-module-gui-present',
      type: 'function_call',
      name: 'module.invoke',
      arguments: JSON.stringify({
        moduleId: 'gui',
        intent: 'present',
        input: {
          intent: 'show-result',
          title: 'Runtime answer',
          content: { kind: 'markdown', value: 'VISIBLE_MODULE_GUI_PRESENT_RESULT' },
          hint: 'markdown',
        },
      }),
      result: JSON.stringify({
        schemaVersion: 'sciforge.module-contract.v1',
        moduleId: 'gui',
        ok: true,
        value: {
          ok: true,
          placement: { panel: 'chat', viewId: 'runtime-answer' },
        },
      }),
    },
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[1]?.type, 'gui_present');
  assert.equal(events[1]?.text, 'VISIBLE_MODULE_GUI_PRESENT_RESULT');
  assert.equal(((events[1]?.raw as { presentation?: { source?: string } }).presentation)?.source, 'gui.present:module.invoke');
});

test('maps completed module.invoke gui ask_user into the same visible confirmation event', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.completed',
    item: {
      id: 'item-module-gui-ask',
      type: 'function_call',
      name: 'module.invoke',
      arguments: JSON.stringify({
        moduleId: 'gui',
        intent: 'ask_user',
        input: {
          kind: 'choice',
          title: 'Choose next step',
          message: 'Pick a terminal-equivalent action.',
          choices: [
            { label: 'Continue', commandText: '/continue', style: 'primary' },
          ],
        },
      }),
      result: JSON.stringify({
        schemaVersion: 'sciforge.module-contract.v1',
        moduleId: 'gui',
        ok: true,
        value: {
          ok: true,
          placement: { panel: 'modal', viewId: 'gui-ask-3' },
        },
      }),
    },
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[1]?.type, 'gui_ask_user');
  assert.match(events[1]?.text ?? '', /Choose next step/);
  assert.equal(((events[1]?.raw as { askUser?: { source?: string } }).askUser)?.source, 'gui.ask_user:module.invoke');
});

test('does not treat gui.present start as completion', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.started',
    item: {
      id: 'item-gui-present-start',
      type: 'function_call',
      name: 'gui.present',
      arguments: JSON.stringify({
        intent: 'show-result',
        content: { kind: 'markdown', value: 'SHOULD_NOT_COMPLETE_FROM_STARTED_TOOL' },
      }),
    },
  }, metadata);

  assert.equal(events.some((event) => event.type === 'gui_present'), false);
});

test('extracts native Codex session ids from session metadata', () => {
  const sessionMetadata = {
    type: 'session_meta',
    payload: { id: '019e3e82-164d-79b2-a5d4-b16241620b10' },
  };

  assert.equal(codexSessionIdFromRaw(sessionMetadata), '019e3e82-164d-79b2-a5d4-b16241620b10');

  const turnMetadata = { ...metadata };
  const events = normalizeCodexJsonlEvent(sessionMetadata, turnMetadata);

  assert.equal(turnMetadata.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
  assert.equal(events[0]?.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
});

test('includes native Codex session id on terminal events', () => {
  const event = exitEvent({
    ...metadata,
    codexSessionId: '019e3e82-164d-79b2-a5d4-b16241620b10',
  }, { exitCode: 0, signal: null });

  assert.equal(event.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
});

test('keeps stderr as audit/debug only', () => {
  const event = stderrAuditEvent(metadata, 'warning from codex\n');

  assert.equal(event.type, 'audit');
  assert.equal(event.status, 'stderr');
  assert.match(event.message ?? '', /warning/);
  assert.deepEqual(event.raw, { stream: 'stderr', chunk: 'warning from codex\n' });
});

test('maps exit code zero to done and nonzero to failed', () => {
  assert.equal(exitEvent(metadata, { exitCode: 0, signal: null }).type, 'done');
  const failed = exitEvent(metadata, { exitCode: 2, signal: null });
  assert.equal(failed.type, 'failed');
  assert.equal(failed.exitCode, 2);
});

test('maps signal exits to cancelled', () => {
  const event = exitEvent(metadata, { exitCode: null, signal: 'SIGTERM' });

  assert.equal(event.type, 'cancelled');
  assert.equal(event.signal, 'SIGTERM');
});
