import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RuntimeExecutionUnit, SciForgeSession } from '../../domain';
import { RunExecutionProcess } from './RunExecutionProcess';
import { conversationProjectionMigrationAuditFixtureForRun } from '../conversation-projection-view-model';

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

  assert.match(html, /<span class="cursor-step-kind">过程<\/span>/);
  assert.match(html, /<span class="cursor-step-kind">恢复线索<\/span>/);
  assert.match(html, /<span class="cursor-step-kind">诊断<\/span>/);
  assert.doesNotMatch(html, /<span class="cursor-step-kind">(?:Failed|Repair|Needs Human|Checked)<\/span>/);
  assert.match(html, /Regenerate the report artifact with schemaVersion=1\./);
  assert.match(html, /下一步：Retry artifact materialization before presenting success\./);
  assert.match(html, /失败边界：3 条记录需要关注/);
  assert.match(html, /可追溯摘要：2 条文件记录、1 条产物记录、2 条执行日志/);
  assertNoInternalTerms(html);
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

  assert.match(html, /old report/);
  assert.match(html, /old-report/);
  assert.doesNotMatch(html, /new report|new-report|old\.tool|new\.tool/);
  assertNoInternalTerms(html);
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

  assert.match(html, /接收任务：old/);
  assert.doesNotMatch(html, /new\.tool/);
  assertNoInternalTerms(html);
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

  assert.match(html, /失败边界：1 条记录需要关注/);
  assert.match(html, /失败摘要：probe failed before rendering/);
  assert.doesNotMatch(html, /EU-failed-payload|web\.probe/);
  assertNoInternalTerms(html);
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

  assert.match(html, /<span class="cursor-step-kind">过程<\/span>/);
  assert.match(html, /<span class="cursor-step-kind">验证<\/span>/);
  assert.match(html, /<span class="cursor-step-kind">诊断<\/span>/);
  assert.match(html, /产物：产物已保存/);
  assert.match(html, /可追溯摘要：1 条执行记录/);
  assert.doesNotMatch(html, /Projection 事件/);
  assert.doesNotMatch(html, /legacy\.raw\.audit/);
  assert.doesNotMatch(html, /LEGACY_RAW_AUDIT_UNIT_SHOULD_NOT_RENDER/);
  assertNoInternalTerms(html);
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
              nativeEvent('tool-result', 'Tool result', { rawType: 'tool_completed', toolName: 'read_file', status: 'completed', text: 'PROJECT.md loaded' }),
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
  assert.match(html, /Codex native stream/);
  assert.match(html, /Codex assistant/);
  assert.match(html, /Codex tool/);
  assert.match(html, /Codex result/);
  assert.match(html, /Codex approval/);
  assert.match(html, /Reading PROJECT\.md directly from the backend stream/);
  assert.doesNotMatch(html, /<span class="cursor-step-kind">(?:过程|验证|恢复线索|诊断)<\/span>/);
  assert.doesNotMatch(html, /LEGACY_SUMMARY_SHOULD_NOT_RENDER|legacy\.summary/);
});

test('execution process distinguishes verification states from execution success', () => {
  const html = renderProcess([
    executionUnit({ id: 'ordinary', status: 'done' }),
    executionUnit({ id: 'unverified', status: 'done', verificationVerdict: 'unverified', verificationRef: 'verification:unverified' }),
    executionUnit({ id: 'verifying', status: 'running', outputRef: 'artifact:partial-report' }),
    executionUnit({ id: 'verify-failed', status: 'done', verificationVerdict: 'fail', verificationRef: 'verification:failed' }),
    executionUnit({ id: 'verify-passed', status: 'done', verificationVerdict: 'pass', verificationRef: 'verification:passed' }),
  ]);

  assert.match(html, /<span class="cursor-step-kind">验证<\/span>/);
  assert.match(html, /验证状态：未请求额外验证/);
  assert.match(html, /验证状态：未验证/);
  assert.match(html, /验证状态：验证中/);
  assert.match(html, /验证状态：未通过/);
  assert.match(html, /验证状态：已验证/);
  assertNoInternalTerms(html);
});

test('execution process renders final Runtime Codex metadata without raw audit streams', () => {
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

  assert.match(html, /Runtime Codex/);
  assert.match(html, /provider/);
  assert.match(html, /sciforge-deepseek-proxy/);
  assert.match(html, /bailian\/deepseek-v4-flash/);
  assert.match(html, /sciforge-runtime-deepseek/);
  assert.match(html, /\/Applications\/workspace\/ailab\/research\/app\/SciForge\/workspace\/parallel\/p1/);
  assert.match(html, /codex-command-visible/);
  assert.match(html, /raw audit folded/);
  assert.doesNotMatch(html, /RAW_JSONL|RAW_STDERR|RAW_STDOUT|stderr|stdout/i);
});

function renderProcess(executionUnits: RuntimeExecutionUnit[]) {
  return renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-1',
    session: session(executionUnits),
    onObjectFocus: () => undefined,
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

function nativeEvent(type: string, label: string, native: Record<string, string>) {
  return {
    type,
    label,
    detail: native.text,
    createdAt: '2026-05-25T00:00:01.000Z',
    native: {
      backend: 'codex-app-server',
      ...native,
    },
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
