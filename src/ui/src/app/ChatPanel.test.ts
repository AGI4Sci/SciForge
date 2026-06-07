import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PROCESS_PROGRESS_EVENT_TYPE, PROCESS_PROGRESS_PHASE, PROCESS_PROGRESS_STATUS } from '@sciforge-ui/runtime-contract';
import { defaultSciForgeConfig } from '../config';
import { I18nProvider } from '../i18nContext';
import { navItems } from '../data';
import { ChatPanel } from './ChatPanel';
import { TopBar } from './appShell/ShellPanels';
import { composerReferenceForObjectReference } from './chat/composerReferences';
import { RunVerificationTag, runIdForMessage } from './chat/messageRunPresentation';
import { RunExecutionProcess, RunKeyInfo } from './chat/RunExecutionProcess';
import { runningMessageContentFromStream } from './chat/runStatusPresentation';
import type { AgentStreamEvent, SciForgeMessage, SciForgeRun, SciForgeSession } from '../domain';

const messages: SciForgeMessage[] = [
  { id: 'system-upload', role: 'system', content: '已上传 1 个文件', createdAt: '2026-05-07T00:00:00.000Z' },
  { id: 'user-current', role: 'user', content: '阅读理解这篇论文，写一份总结报告', createdAt: '2026-05-07T00:01:00.000Z' },
  { id: 'scenario-answer', role: 'scenario', content: '已生成总结报告', createdAt: '2026-05-07T00:02:00.000Z' },
];

const runs: SciForgeRun[] = [{
  id: 'run-current',
  scenarioId: 'literature-evidence-review',
  status: 'completed',
  prompt: '阅读理解这篇论文，写一份总结报告',
  response: '已生成总结报告',
  createdAt: '2026-05-07T00:02:00.000Z',
}];

function renderChatPanel(element: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(createElement(I18nProvider, { locale: 'en-US', children: element }));
}

test('run key info attaches to scenario answer, not system upload message', () => {
  assert.equal(runIdForMessage(messages[0], 0, messages, runs), undefined);
  assert.equal(runIdForMessage(messages[1], 1, messages, runs), 'run-current');
  assert.equal(runIdForMessage(messages[2], 2, messages, runs), 'run-current');
});

test('run key info follows repeated follow-up turns without prompt pollution', () => {
  const followupMessages: SciForgeMessage[] = [
    { id: 'user-1', role: 'user', content: '继续', createdAt: '2026-05-07T00:01:00.000Z' },
    { id: 'scenario-1', role: 'scenario', content: '第一轮继续完成', createdAt: '2026-05-07T00:02:00.000Z' },
    { id: 'user-2', role: 'user', content: '运行中引导：继续', createdAt: '2026-05-07T00:03:00.000Z' },
    { id: 'scenario-2', role: 'scenario', content: '第二轮继续完成', createdAt: '2026-05-07T00:04:00.000Z' },
  ];
  const followupRuns: SciForgeRun[] = [{
    id: 'run-followup-1',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: '继续',
    response: '第一轮继续完成',
    createdAt: '2026-05-07T00:02:00.000Z',
  }, {
    id: 'run-followup-2',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: '继续',
    response: '第二轮继续完成',
    createdAt: '2026-05-07T00:04:00.000Z',
  }];

  assert.equal(runIdForMessage(followupMessages[0], 0, followupMessages, followupRuns), 'run-followup-1');
  assert.equal(runIdForMessage(followupMessages[1], 1, followupMessages, followupRuns), 'run-followup-1');
  assert.equal(runIdForMessage(followupMessages[2], 2, followupMessages, followupRuns), 'run-followup-2');
  assert.equal(runIdForMessage(followupMessages[3], 3, followupMessages, followupRuns), 'run-followup-2');
});

test('running message follows structured progress fields instead of prompt or scenario semantics', () => {
  const events: AgentStreamEvent[] = [{
    id: 'evt-structured-progress',
    type: PROCESS_PROGRESS_EVENT_TYPE,
    label: '过程',
    detail: 'PROMPT_TEXT_SHOULD_NOT_DECIDE search write failed approval',
    createdAt: '2026-05-08T00:00:00.000Z',
    raw: {
      prompt: 'PROMPT_TEXT_SHOULD_NOT_DECIDE search write failed approval',
      scenario: 'SCENARIO_TEXT_SHOULD_NOT_DECIDE retrieval repair blocked',
      progress: {
        phase: PROCESS_PROGRESS_PHASE.WAIT,
        title: '结构化等待状态',
        detail: 'structured progress detail wins',
        reading: ['/structured/read.csv'],
        waitingFor: 'structured backend event',
        nextStep: 'structured next step',
        status: PROCESS_PROGRESS_STATUS.RUNNING,
      },
    },
  }];

  const content = runningMessageContentFromStream('', events);

  assert.match(content, /结构化等待状态/);
  assert.match(content, /Reading \/structured\/read\.csv/);
  assert.match(content, /Waiting for structured backend event/);
  assert.match(content, /Next structured next step/);
  assert.doesNotMatch(content, /PROMPT_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(content, /SCENARIO_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(content, /search write failed approval/);
  assert.doesNotMatch(content, /retrieval repair blocked/);
});

test('chat run process and key info prefer projection over raw failed execution units', () => {
  const projection = {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: 'conversation-chat-projection',
    currentTurn: { id: 'turn-chat-projection', prompt: 'summarize projected artifacts' },
    visibleAnswer: {
      status: 'satisfied',
      text: 'Projection answer is ready.',
      artifactRefs: ['artifact:projection-report'],
    },
    artifacts: [{ ref: 'artifact:projection-report', label: 'Projection Report', mime: 'research-report' }],
    executionProcess: [{
      eventId: 'event-projection-summary',
      type: 'Satisfied',
      summary: 'GUI intent summarized the durable report ref.',
      timestamp: '2026-05-13T00:00:05.000Z',
    }],
    recoverActions: [],
    verificationState: { status: 'pass', verifierRef: 'verification:projection' },
    auditRefs: ['artifact:projection-report', 'execution-unit:EU-projection-audit'],
    diagnostics: [],
  };
  const session = {
    schemaVersion: 2,
    sessionId: 'session-chat-projection',
    scenarioId: 'literature-evidence-review',
    materializedConversationProjection: projection,
    title: 'chat projection',
    createdAt: '2026-05-13T00:00:00.000Z',
    updatedAt: '2026-05-13T00:00:10.000Z',
    messages: [],
    runs: [{
      id: 'run-chat-projection',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'summarize projected artifacts',
      response: 'legacy failed response',
      createdAt: '2026-05-13T00:00:00.000Z',
      raw: {
        resultPresentation: {
          conversationProjection: { ...projection, visibleAnswer: { status: 'failed', text: 'RAW_PROJECTION_SHOULD_NOT_RENDER', artifactRefs: [] } },
        },
      },
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [{
      id: 'EU-legacy-failed',
      tool: 'legacy.raw',
      params: '{}',
      status: 'repair-needed',
      hash: 'legacy',
      failureReason: 'LEGACY_EXECUTION_UNIT_SHOULD_NOT_RENDER',
    }],
    artifacts: [{
      id: 'projection-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: 'Projection Report', runId: 'run-chat-projection' },
      delivery: {
        contractId: 'sciforge.artifact-delivery.v1',
        ref: 'artifact:projection-report',
        role: 'primary-deliverable',
        declaredMediaType: 'text/markdown',
        declaredExtension: 'md',
        contentShape: 'raw-file',
        readableRef: '.sciforge/artifacts/projection-report.md',
        previewPolicy: 'inline',
      },
    }],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
  } as SciForgeSession;
  const processHtml = renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-chat-projection',
    session,
    onObjectFocus: () => undefined,
  }));
  const keyInfoHtml = renderToStaticMarkup(createElement(RunKeyInfo, {
    runId: 'run-chat-projection',
    session,
    onObjectFocus: () => undefined,
  }));

  assert.equal(processHtml, '');
  assert.match(keyInfoHtml, /Results/);
  assert.match(keyInfoHtml, /Projection Report/);
});

test('assistant message follows Codex-style answer, results, process, verification order', () => {
  const projection = {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: 'conversation-codex-style-order',
    currentTurn: { id: 'turn-codex-style-order', prompt: '整理报告并验证' },
    visibleAnswer: {
      status: 'satisfied',
      text: 'ORDER_MAIN_ANSWER',
      artifactRefs: ['artifact:codex-style-report'],
    },
    artifacts: [{ ref: 'artifact:codex-style-report', label: 'Codex Style Report', mime: 'research-report' }],
    executionProcess: [{
      eventId: 'event-codex-style-order',
      type: 'OutputMaterialized',
      summary: '报告已写入并准备验证。',
      timestamp: '2026-05-21T00:00:05.000Z',
    }],
    recoverActions: ['如需继续，基于当前报告追问即可。'],
    verificationState: { status: 'pass', verifierRef: 'verification:codex-style-order' },
    auditRefs: ['artifact:codex-style-report', 'execution-unit:EU-codex-style-order', 'file:.sciforge/logs/codex-style.stdout.log'],
    diagnostics: [{ message: '过程摘要已保留，原始执行日志不进入主回答。' }],
  };
  const session = {
    schemaVersion: 2,
    sessionId: 'session-codex-style-order',
    scenarioId: 'literature-evidence-review',
    materializedConversationProjection: projection,
    title: 'codex style order',
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:10.000Z',
    messages: [
      { id: 'msg-codex-style-user', role: 'user', content: '整理报告并验证', createdAt: '2026-05-21T00:00:00.000Z' },
      { id: 'msg-codex-style-assistant', role: 'scenario', content: 'ORDER_MAIN_ANSWER', createdAt: '2026-05-21T00:00:06.000Z' },
    ],
    runs: [{
      id: 'run-codex-style-order',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: '整理报告并验证',
      response: 'ORDER_MAIN_ANSWER',
      createdAt: '2026-05-21T00:00:01.000Z',
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [{
      id: 'codex-style-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: 'Codex Style Report', runId: 'run-codex-style-order' },
      delivery: {
        contractId: 'sciforge.artifact-delivery.v1',
        ref: 'artifact:codex-style-report',
        role: 'primary-deliverable',
        declaredMediaType: 'text/markdown',
        declaredExtension: 'md',
        contentShape: 'raw-file',
        readableRef: '.sciforge/artifacts/codex-style-report.md',
        previewPolicy: 'inline',
      },
    }],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
  } as SciForgeSession;
  const html = renderChatPanel(createElement(ChatPanel, {
    scenarioId: 'literature-evidence-review',
    role: 'Researcher',
    config: defaultSciForgeConfig,
    session,
    input: '',
    savedScrollTop: 0,
    onInputChange: () => undefined,
    onScrollTopChange: () => undefined,
    onSessionChange: () => undefined,
    onNewChat: () => undefined,
    onDeleteChat: () => undefined,
    archivedSessions: [],
    onRestoreArchivedSession: () => undefined,
    onDeleteArchivedSessions: () => undefined,
    onClearArchivedSessions: () => undefined,
    onEditMessage: () => undefined,
    onDeleteMessage: () => undefined,
    archivedCount: 0,
    onAutoRunConsumed: () => undefined,
    onConfigChange: () => undefined,
    onTimelineEvent: () => undefined,
    onActiveRunChange: () => undefined,
    onMarkReusableRun: () => undefined,
    onObjectFocus: () => undefined,
    runtimeHealth: [],
  }));

  const mainAnswerIndex = html.indexOf('ORDER_MAIN_ANSWER');
  const keyInfoIndex = html.indexOf('Results');
  const processIndex = html.indexOf('data-testid="chat-process-thread"');
  assert.ok(mainAnswerIndex >= 0);
  assert.match(html, /class="message scenario assistant-message(?: [^"]*)?"/);
  assert.match(html, /final-answer-prose/);
  assert.ok(keyInfoIndex > mainAnswerIndex);
  assert.equal(processIndex, -1);
  assert.doesNotMatch(html, /ConversationProjection|ExecutionUnit|ArtifactDelivery|native-message|live-runtime-codex|raw JSONL|SSE|stdout|stderr|provider|run id/);
});

test('assistant message presents recorded agent process before the final answer', () => {
  const session = {
    schemaVersion: 2,
    sessionId: 'session-process-first',
    scenarioId: 'literature-evidence-review',
    title: 'process first',
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:10.000Z',
    messages: [
      { id: 'msg-process-user', role: 'user', content: '检查 actions 包', createdAt: '2026-05-31T00:00:00.000Z' },
      { id: 'msg-process-assistant', role: 'scenario', content: 'FINAL_ANSWER_AFTER_PROCESS', createdAt: '2026-05-31T00:00:06.000Z' },
    ],
    runs: [{
      id: 'run-process-first',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: '检查 actions 包',
      response: 'FINAL_ANSWER_AFTER_PROCESS',
      createdAt: '2026-05-31T00:00:01.000Z',
      raw: {
        streamProcess: {
          events: [{
            type: 'tool-result',
            label: 'Tool result',
            createdAt: '2026-05-31T00:00:02.000Z',
            native: {
              backend: 'codex-app-server',
              rawType: 'tool_completed',
              toolName: 'read_file',
              status: 'completed',
              filePath: 'packages/actions/README.md',
              text: 'actions package loaded',
            },
          }],
        },
      },
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
  } as SciForgeSession;
  const html = renderChatPanel(createElement(ChatPanel, {
    scenarioId: 'literature-evidence-review',
    role: 'Researcher',
    config: defaultSciForgeConfig,
    session,
    input: '',
    savedScrollTop: 0,
    onInputChange: () => undefined,
    onScrollTopChange: () => undefined,
    onSessionChange: () => undefined,
    onNewChat: () => undefined,
    onDeleteChat: () => undefined,
    archivedSessions: [],
    onRestoreArchivedSession: () => undefined,
    onDeleteArchivedSessions: () => undefined,
    onClearArchivedSessions: () => undefined,
    onEditMessage: () => undefined,
    onDeleteMessage: () => undefined,
    archivedCount: 0,
    onAutoRunConsumed: () => undefined,
    onConfigChange: () => undefined,
    onTimelineEvent: () => undefined,
    onActiveRunChange: () => undefined,
    onMarkReusableRun: () => undefined,
    onObjectFocus: () => undefined,
    runtimeHealth: [],
  }));

  const processIndex = html.indexOf('data-testid="chat-process-thread"');
  const answerIndex = html.indexOf('message-content final-answer-prose');
  assert.ok(processIndex >= 0);
  assert.ok(answerIndex > processIndex);
  assert.match(html, /FINAL_ANSWER_AFTER_PROCESS/);
  assert.match(html, /Read packages\/actions\/README\.md/);
});

test('run key info counts durable file refs as user-visible objects', () => {
  const html = renderToStaticMarkup(createElement(RunKeyInfo, {
    runId: 'run-file-writeback',
    session: {
      schemaVersion: 2,
      sessionId: 'session-file-writeback',
      scenarioId: 'literature-evidence-review',
      title: 'file writeback',
      createdAt: '2026-05-13T00:00:00.000Z',
      updatedAt: '2026-05-13T00:00:00.000Z',
      messages: [],
      runs: [{
        id: 'run-file-writeback',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'rewrite selected artifact',
        response: 'wrote files',
        createdAt: '2026-05-13T00:00:00.000Z',
        objectReferences: [{
          id: 'file-timeline-budget',
          kind: 'file',
          title: 'timeline-budget.md',
          ref: 'file:p6-mini-grant/timeline-budget.md',
          status: 'available',
        }],
      }],
      uiManifest: [],
      claims: [],
      executionUnits: [],
      artifacts: [],
      notebook: [],
      versions: [],
      hiddenResultSlotIds: [],
    } as SciForgeSession,
    onObjectFocus: () => undefined,
  }));

  assert.match(html, /1 objects · 0 findings/);
  assert.match(html, /file:p6-mini-grant\/timeline-budget\.md/);
});

test('run key info keeps scientific claims refs-first and hides internal evidence refs', () => {
  const html = renderToStaticMarkup(createElement(RunKeyInfo, {
    runId: 'run-scientific-artifacts',
    session: {
      schemaVersion: 2,
      sessionId: 'session-scientific-artifacts',
      scenarioId: 'literature-evidence-review',
      title: 'scientific artifacts',
      createdAt: '2026-05-13T00:00:00.000Z',
      updatedAt: '2026-05-13T00:00:05.000Z',
      messages: [],
      runs: [{
        id: 'run-scientific-artifacts',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'summarize evidence',
        response: 'done',
        createdAt: '2026-05-13T00:00:00.000Z',
        completedAt: '2026-05-13T00:00:04.000Z',
        objectReferences: [{
          id: 'obj-evidence-table',
          kind: 'artifact',
          title: 'Evidence table',
          ref: 'artifact:evidence-table',
          status: 'available',
          presentationRole: 'supporting-evidence',
        }],
      }],
      uiManifest: [],
      claims: [{
        id: 'claim-evidence-supported',
        text: 'Treatment B increased the median signal.',
        type: 'inference',
        confidence: 0.87,
        evidenceLevel: 'experimental',
        supportingRefs: [
          'artifact:evidence-table',
          'reports/support.csv',
          'stderr:.sciforge/logs/stderr.log',
          'artifact:.sciforge/raw-provider-payload',
        ],
        opposingRefs: [],
        dependencyRefs: [],
        updatedAt: '2026-05-13T00:00:02.000Z',
      }],
      executionUnits: [],
      artifacts: [{
        id: 'evidence-table',
        type: 'data-table',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        metadata: { title: 'Evidence table', runId: 'run-scientific-artifacts' },
        delivery: {
          contractId: 'sciforge.artifact-delivery.v1',
          ref: 'artifact:evidence-table',
          role: 'supporting-evidence',
          declaredMediaType: 'text/csv',
          declaredExtension: 'csv',
          contentShape: 'raw-file',
          readableRef: '.sciforge/artifacts/evidence-table.csv',
          previewPolicy: 'inline',
        },
      }],
      notebook: [],
      versions: [],
      hiddenResultSlotIds: [],
    } as SciForgeSession,
    onObjectFocus: () => undefined,
  }));

  assert.match(html, /1 objects · 1 findings/);
  assert.match(html, /Treatment B increased the median signal/);
  assert.match(html, /data-claim-ref-count="2"/);
  assert.match(html, /evidence-table/);
  assert.match(html, /support\.csv/);
  assert.doesNotMatch(html, /\.sciforge|stderr|raw-provider-payload/);
});

test('chat verification badge is projection-only and ignores raw verification fallback', () => {
  const rawOnly = renderToStaticMarkup(createElement(RunVerificationTag, {
    runId: 'run-raw-verification',
    session: {
      schemaVersion: 2,
      sessionId: 'session-raw-verification',
      scenarioId: 'literature-evidence-review',
      title: 'raw verification',
      createdAt: '2026-05-13T00:00:00.000Z',
      updatedAt: '2026-05-13T00:00:00.000Z',
      messages: [],
      runs: [{
      id: 'run-raw-verification',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'raw verification',
      response: 'done',
      createdAt: '2026-05-13T00:00:00.000Z',
      raw: {
        verificationResult: { verdict: 'pass', critique: 'RAW_VERIFICATION_SHOULD_NOT_RENDER' },
        displayIntent: { verification: { verdict: 'fail' } },
      },
    }],
      uiManifest: [],
      claims: [],
      executionUnits: [],
      artifacts: [],
      notebook: [],
      versions: [],
    } as SciForgeSession,
  }));
  const projectedProjection = {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: 'conversation-projected-verification',
    visibleAnswer: { status: 'satisfied', text: 'Projection answer.', artifactRefs: [] },
    artifacts: [],
    executionProcess: [],
    recoverActions: [],
    verificationState: { status: 'pass', verifierRef: 'verification:projection' },
    auditRefs: [],
    diagnostics: [],
  };
  const projected = renderToStaticMarkup(createElement(RunVerificationTag, {
    runId: 'run-projected-verification',
    session: {
      schemaVersion: 2,
      sessionId: 'session-projected-verification',
      scenarioId: 'literature-evidence-review',
      materializedConversationProjection: projectedProjection,
      title: 'projected verification',
      createdAt: '2026-05-13T00:00:00.000Z',
      updatedAt: '2026-05-13T00:00:00.000Z',
      messages: [],
      runs: [{
      id: 'run-projected-verification',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'projected verification',
      response: 'done',
      createdAt: '2026-05-13T00:00:00.000Z',
      raw: {
        resultPresentation: {
          conversationProjection: { ...projectedProjection, verificationState: { status: 'fail', verifierRef: 'RAW_VERIFICATION_SHOULD_NOT_RENDER' } },
        },
      },
    }],
      uiManifest: [],
      claims: [],
      executionUnits: [],
      artifacts: [],
      notebook: [],
      versions: [],
    } as SciForgeSession,
  }));

  assert.equal(rawOnly, '');
  assert.match(projected, /验证：已验证/);
  assert.match(projected, /verification:projection/);
});

test('chat verification badge hides internal projection states', () => {
  const html = renderToStaticMarkup(createElement(RunVerificationTag, {
    runId: 'run-internal-verification',
    session: {
      schemaVersion: 2,
      sessionId: 'session-internal-verification',
      scenarioId: 'literature-evidence-review',
      materializedConversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        conversationId: 'conversation-internal-verification',
        visibleAnswer: { status: 'satisfied', text: 'Projection answer.', artifactRefs: [] },
        artifacts: [],
        executionProcess: [],
        recoverActions: [],
        verificationState: { status: 'native-message', verifierRef: 'codex-command-internal-verifier' },
        auditRefs: [],
        diagnostics: [],
      },
      title: 'internal verification',
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
      messages: [],
      runs: [{
        id: 'run-internal-verification',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'internal verification',
        response: 'done',
        createdAt: '2026-05-21T00:00:00.000Z',
      }],
      uiManifest: [],
      claims: [],
      executionUnits: [],
      artifacts: [],
      notebook: [],
      versions: [],
    } as SciForgeSession,
  }));

  assert.equal(html, '');
  assert.doesNotMatch(html, /Verification: native-message/);
  assert.doesNotMatch(html, /native-message/);
  assert.doesNotMatch(html, /codex-command-internal-verifier/);
});

test('chat final message body ignores raw displayIntent resultPresentation', () => {
  const session = {
    schemaVersion: 2,
    sessionId: 'session-chat-display-intent',
    scenarioId: 'literature-evidence-review',
    title: 'chat display intent',
    createdAt: '2026-05-13T00:00:00.000Z',
    updatedAt: '2026-05-13T00:00:10.000Z',
    messages: [
      { id: 'msg-user-display-intent', role: 'user', content: 'show chat answer', createdAt: '2026-05-13T00:00:00.000Z' },
      { id: 'msg-scenario-display-intent', role: 'scenario', content: 'ORIGINAL_CHAT_BODY', createdAt: '2026-05-13T00:00:05.000Z' },
    ],
    runs: [{
      id: 'run-display-intent',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'show chat answer',
      response: 'ORIGINAL_CHAT_BODY',
      createdAt: '2026-05-13T00:00:05.000Z',
      raw: {
        displayIntent: {
          resultPresentation: {
            answerBlocks: [{ id: 'answer-raw', text: 'DISPLAY_INTENT_SHOULD_NOT_RENDER' }],
            keyFindings: [],
          },
        },
      },
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
  } as SciForgeSession;
  const html = renderChatPanel(createElement(ChatPanel, {
    scenarioId: 'literature-evidence-review',
    role: 'Researcher',
    config: defaultSciForgeConfig,
    session,
    input: '',
    savedScrollTop: 0,
    onInputChange: () => undefined,
    onScrollTopChange: () => undefined,
    onSessionChange: () => undefined,
    onNewChat: () => undefined,
    onDeleteChat: () => undefined,
    archivedSessions: [],
    onRestoreArchivedSession: () => undefined,
    onDeleteArchivedSessions: () => undefined,
    onClearArchivedSessions: () => undefined,
    onEditMessage: () => undefined,
    onDeleteMessage: () => undefined,
    archivedCount: 0,
    onAutoRunConsumed: () => undefined,
    onConfigChange: () => undefined,
    onTimelineEvent: () => undefined,
    onActiveRunChange: () => undefined,
    onMarkReusableRun: () => undefined,
    onObjectFocus: () => undefined,
    runtimeHealth: [],
  }));

  assert.match(html, /ORIGINAL_CHAT_BODY/);
  assert.doesNotMatch(html, /DISPLAY_INTENT_SHOULD_NOT_RENDER/);
});

test('chat message DOM and badges distinguish demo seed from live runtime answers without raw internal provenance', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-provenance-dom',
    scenarioId: 'literature-evidence-review',
    title: 'provenance dom',
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:10.000Z',
    messages: [{
      id: 'seed-demo-message',
      role: 'scenario',
      content: 'demo answer',
      createdAt: '2026-05-19T00:00:00.000Z',
      provenance: {
        kind: 'seed-demo',
        source: 'scenarioDemoData:literature-evidence-review',
        runtimeRequestEligible: false,
        liveAcceptanceEligible: false,
      },
    }, {
      id: 'runtime-failed-message',
      role: 'scenario',
      content: 'runtime failed diagnostic',
      createdAt: '2026-05-19T00:00:03.000Z',
      status: 'failed',
      provenance: {
        kind: 'live-runtime-codex',
        source: 'codex.runtime-failure:codex-command-failed',
        runtimeRequestEligible: false,
        liveAcceptanceEligible: false,
      },
    }, {
      id: 'system-runtime-status',
      role: 'system',
      content: 'background runtime did not finish',
      createdAt: '2026-05-19T00:00:03.500Z',
      provenance: {
        kind: 'system-ui',
        source: 'background-completion:run-incomplete',
        runtimeRequestEligible: false,
        liveAcceptanceEligible: false,
      },
    }, {
      id: 'legacy-live-runtime-message',
      role: 'scenario',
      content: 'legacy live answer',
      createdAt: '2026-05-19T00:00:04.000Z',
      status: 'completed',
      provenance: {
        kind: 'live-runtime-codex',
        source: 'background-completion:run-legacy-live',
        runtimeRequestEligible: false,
      },
    }, {
      id: 'live-runtime-message',
      role: 'scenario',
      content: 'live answer',
      confidence: 0.82,
      createdAt: '2026-05-19T00:00:05.000Z',
      status: 'completed',
      provenance: {
        kind: 'live-runtime-codex',
        source: 'gui.present:codex-command-live',
        runtimeRequestEligible: false,
        liveAcceptanceEligible: true,
      },
    }, {
      id: 'native-runtime-message',
      role: 'scenario',
      content: 'native answer',
      createdAt: '2026-05-19T00:00:06.000Z',
      status: 'completed',
      provenance: {
        kind: 'native-message',
        source: 'gui.present:codex-command-native-message',
        runtimeRequestEligible: false,
        liveAcceptanceEligible: false,
      },
    }],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
  };

  const html = renderChatPanel(createElement(ChatPanel, {
    scenarioId: 'literature-evidence-review',
    role: 'Researcher',
    config: defaultSciForgeConfig,
    session,
    input: '',
    savedScrollTop: 0,
    onInputChange: () => undefined,
    onScrollTopChange: () => undefined,
    onSessionChange: () => undefined,
    onNewChat: () => undefined,
    onDeleteChat: () => undefined,
    archivedSessions: [],
    onRestoreArchivedSession: () => undefined,
    onDeleteArchivedSessions: () => undefined,
    onClearArchivedSessions: () => undefined,
    onEditMessage: () => undefined,
    onDeleteMessage: () => undefined,
    archivedCount: 0,
    onAutoRunConsumed: () => undefined,
    onConfigChange: () => undefined,
    onTimelineEvent: () => undefined,
    onActiveRunChange: () => undefined,
    onMarkReusableRun: () => undefined,
    onObjectFocus: () => undefined,
    runtimeHealth: [],
  }));

  assert.match(html, /data-message-id="seed-demo-message"/);
  assert.match(html, /data-message-provenance="seed-demo"/);
  assert.match(html, /seed-demo/);
  assert.match(html, /data-message-id="runtime-failed-message"[^>]*data-message-provenance="assistant-result"/);
  assert.match(html, /data-message-id="system-runtime-status"[^>]*data-message-provenance="system-message"/);
  assert.doesNotMatch(html, /data-message-id="runtime-failed-message"[^>]*data-message-provenance="seed-demo"/);
  assert.doesNotMatch(html, /data-message-id="system-runtime-status"[^>]*data-message-provenance="seed-demo"/);
  assert.match(html, /data-message-id="live-runtime-message"/);
  assert.match(html, /data-message-provenance="assistant-result"/);
  assert.match(html, /data-live-acceptance-eligible="true"/);
  assert.match(html, /class="confidence"/);
  assert.match(html, /82%/);
  assert.match(html, /data-message-id="legacy-live-runtime-message"/);
  assert.match(html, /legacy live answer/);
  assert.match(html, /data-message-id="native-runtime-message"/);
  assert.match(html, /data-message-id="native-runtime-message"[^>]*data-message-provenance="assistant-result"[^>]*data-live-acceptance-eligible="true"/);
  assert.doesNotMatch(html, /native-message/);
  assert.doesNotMatch(html, /codex-command-native-message/);
  assert.doesNotMatch(html, /codex-command-live/);
  assert.doesNotMatch(html, /live-runtime-codex|live Runtime Codex|运行结果/);
});

test('chat renders external channel user messages from thread event metadata without Feishu imports', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-channel-message',
    scenarioId: 'literature-evidence-review',
    title: 'channel message',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:10.000Z',
    messages: [{
      id: 'channel-user-feishu',
      role: 'user',
      content: 'Please summarize the attached protocol.',
      createdAt: '2026-06-01T00:00:00.000Z',
      references: [{
        id: 'ref-feishu-message',
        kind: 'message',
        title: 'Feishu message',
        ref: 'feishu:message:om_1',
      }, {
        id: 'ref-feishu-attachment',
        kind: 'file',
        title: 'Feishu attachment 1',
        ref: 'feishu:file:file_1',
      }, {
        id: 'ref-feishu-audit',
        kind: 'message',
        title: 'Feishu audit',
        ref: 'audit:feishu:intake:om_1',
      }],
      provenance: {
        kind: 'channel-message',
        source: { channel: 'feishu' },
        channel: {
          channel: 'feishu',
          accountId: 'tenant-a',
          sender: { ref: 'feishu:user:ou_1', displayName: 'Dr. Chen' },
          conversationRef: 'feishu:chat:oc_1',
          externalMessageRef: 'feishu:message:om_1',
          attachmentRefs: ['feishu:file:file_1'],
          auditRef: 'audit:feishu:intake:om_1',
          rawEventRef: 'audit:feishu:raw:om_1',
          receivedAt: '2026-06-01T00:00:00.000Z',
          threadBindingStatus: 'bound',
        },
        runtimeRequestEligible: true,
        liveAcceptanceEligible: true,
      },
    }],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
  };

  const html = renderChatPanel(createElement(ChatPanel, {
    scenarioId: 'literature-evidence-review',
    role: 'Researcher',
    config: defaultSciForgeConfig,
    session,
    input: '',
    savedScrollTop: 0,
    onInputChange: () => undefined,
    onScrollTopChange: () => undefined,
    onSessionChange: () => undefined,
    onNewChat: () => undefined,
    onDeleteChat: () => undefined,
    archivedSessions: [],
    onRestoreArchivedSession: () => undefined,
    onDeleteArchivedSessions: () => undefined,
    onClearArchivedSessions: () => undefined,
    onEditMessage: () => undefined,
    onDeleteMessage: () => undefined,
    archivedCount: 0,
    onAutoRunConsumed: () => undefined,
    onConfigChange: () => undefined,
    onTimelineEvent: () => undefined,
    onActiveRunChange: () => undefined,
    onMarkReusableRun: () => undefined,
    onObjectFocus: () => undefined,
    runtimeHealth: [],
  }));

  assert.match(html, /data-message-id="channel-user-feishu"/);
  assert.match(html, /data-source-channel="feishu"/);
  assert.match(html, /external-channel-message/);
  assert.match(html, /Feishu/);
  assert.match(html, /Dr\. Chen/);
  assert.match(html, /feishu:chat:oc_1/);
  assert.match(html, /attachments 1/);
  assert.match(html, /audit:feishu:intake:om_1/);
  assert.match(html, /feishu:file:file_1/);
  assert.doesNotMatch(html, /lark-cli|@larksuite|connectors\/feishu|packages\/connectors\/feishu/);
});

test('default chat renders Computer Use confirmation panels without protocol command chrome', () => {
  const traceRef = '.sciforge/vision-runs/cu-risk/vision-trace.json';
  const screenshotRef = '.sciforge/vision-runs/cu-risk/step-001-before.png';
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-computer-use-gui',
    scenarioId: 'literature-evidence-review',
    title: 'computer use gui',
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:10.000Z',
    messages: [{
      id: 'msg-cu-user',
      role: 'user',
      content: '/computer-use click the guarded Submit button',
      createdAt: '2026-05-25T00:00:00.000Z',
    }, {
      id: 'msg-cu-assistant',
      role: 'scenario',
      content: '## Computer Use confirmation required\n\nAllow Computer Use to click the visible Submit button?',
      createdAt: '2026-05-25T00:00:05.000Z',
      provenance: {
        kind: 'live-runtime-codex',
        source: 'gui.ask_user:codex-command-computer-use',
        runtimeRequestEligible: false,
        liveAcceptanceEligible: true,
        requiresUserConfirmation: true,
      },
    }],
    runs: [{
      id: 'run-computer-use-gui',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: '/computer-use click the guarded Submit button',
      response: '## Computer Use confirmation required\n\nAllow Computer Use to click the visible Submit button?',
      createdAt: '2026-05-25T00:00:01.000Z',
      raw: {
        guiPresentation: {
          source: 'gui.present:codex-command-computer-use',
          title: 'Computer Use result',
          status: 'needs-confirmation',
          text: 'Computer Use stopped before the guarded action.',
          ref: traceRef,
          displayedRefs: [traceRef, screenshotRef],
        },
        guiAskUser: {
          source: 'gui.ask_user:codex-command-computer-use',
          title: 'Computer Use confirmation required',
          message: 'Allow Computer Use to click the visible Submit button?',
          approvalRequest: {
            id: 'approval-1',
            riskLevel: 'high',
            actionRef: 'ref:planned-action:submit',
          },
          relatedRefs: [traceRef, screenshotRef],
          choices: [
            { label: 'Approve', commandText: '/computer-use approve --approval-ref approval-1', style: 'primary' },
            { label: 'Cancel', commandText: '/computer-use reject --approval-ref approval-1', style: 'secondary' },
            { label: 'Unsafe legacy', commandText: 'deleteFile("report.md")', style: 'danger' },
          ],
        },
      },
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
  };
  const html = renderChatPanel(createElement(ChatPanel, {
    scenarioId: 'literature-evidence-review',
    role: 'Researcher',
    config: defaultSciForgeConfig,
    session,
    input: '',
    savedScrollTop: 0,
    onInputChange: () => undefined,
    onScrollTopChange: () => undefined,
    onSessionChange: () => undefined,
    onNewChat: () => undefined,
    onDeleteChat: () => undefined,
    archivedSessions: [],
    onRestoreArchivedSession: () => undefined,
    onDeleteArchivedSessions: () => undefined,
    onClearArchivedSessions: () => undefined,
    onEditMessage: () => undefined,
    onDeleteMessage: () => undefined,
    archivedCount: 0,
    onAutoRunConsumed: () => undefined,
    onConfigChange: () => undefined,
    onTimelineEvent: () => undefined,
    onActiveRunChange: () => undefined,
    onMarkReusableRun: () => undefined,
    onObjectFocus: () => undefined,
    runtimeHealth: [],
  }));

  assert.match(html, /data-testid="runtime-gui-present"/);
  assert.match(html, /data-gui-surface="presentation"/);
  assert.match(html, /the operation stopped before the guarded action/);
  assert.doesNotMatch(html, new RegExp(traceRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /data-testid="runtime-gui-ask-user"/);
  assert.match(html, /data-gui-surface="confirmation"/);
  assert.match(html, /Confirmation/);
  assert.match(html, /Confirm/);
  assert.match(html, /Cancel/);
  assert.doesNotMatch(html, /Computer Use|gui\.present|gui\.ask_user|approval-1|ref:planned-action:submit/);
  assert.doesNotMatch(html, /\/computer-use approve|\/computer-use reject|deleteFile|RAW_PROVIDER_MESSAGE|stdout|stderr/);
});

test('default chat shell uses universal workspace copy instead of scenario-first labels', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-universal-shell',
    scenarioId: 'literature-evidence-review',
    title: 'universal shell',
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
  };
  const chatHtml = renderChatPanel(createElement(ChatPanel, {
    scenarioId: 'literature-evidence-review',
    role: 'Researcher',
    config: defaultSciForgeConfig,
    session,
    input: '',
    savedScrollTop: 0,
    onInputChange: () => undefined,
    onScrollTopChange: () => undefined,
    onSessionChange: () => undefined,
    onNewChat: () => undefined,
    onDeleteChat: () => undefined,
    archivedSessions: [],
    onRestoreArchivedSession: () => undefined,
    onDeleteArchivedSessions: () => undefined,
    onClearArchivedSessions: () => undefined,
    onEditMessage: () => undefined,
    onDeleteMessage: () => undefined,
    archivedCount: 0,
    onAutoRunConsumed: () => undefined,
    onConfigChange: () => undefined,
    onTimelineEvent: () => undefined,
    onActiveRunChange: () => undefined,
    onMarkReusableRun: () => undefined,
    onObjectFocus: () => undefined,
    runtimeHealth: [],
  }));
  const topbarHtml = renderToStaticMarkup(createElement(TopBar, {
    onSearch: () => undefined,
    onSettingsOpen: () => undefined,
    theme: 'dark',
    onThemeToggle: () => undefined,
    healthItems: [],
  }));

  assert.match(chatHtml, /Ask/);
  assert.match(chatHtml, /Context/);
  assert.match(chatHtml, /Workspace/);
  assert.match(chatHtml, /Local environment/);
  assert.match(chatHtml, /Assistant connected|Connection not configured/);
  assert.doesNotMatch(chatHtml, /Permission not set|Permission set|Writable|Read-only/i);
  assert.match(topbarHtml, /Annotate/);
  assert.match(topbarHtml, /aria-pressed="false"/);
  assert.doesNotMatch(chatHtml, /workspace-write/);
  assert.doesNotMatch(chatHtml, /sciforge-runtime-deepseek/);
  assert.doesNotMatch(chatHtml, /sciforge-deepseek-proxy/);
  assert.doesNotMatch(chatHtml, /bailian\/deepseek-v4-flash/);
  assert.doesNotMatch(chatHtml, /GUI tools|gui\.present|\/runtime-codex|data-terminal-command-text/);
  assert.doesNotMatch(chatHtml, /used\/window|Codex Runtime owns|provider unset|model unset/);
  assert.doesNotMatch(chatHtml, /文献证据评估场景/);
  assert.doesNotMatch(chatHtml, /Scenario Runtime/);
  assert.match(topbarHtml, /SciForge · Ready/);
  assert.match(topbarHtml, /Search files, reports, questions/);
  assert.doesNotMatch(topbarHtml, />\d+ actions<|>ready</);
  assert.doesNotMatch(topbarHtml, /Execution Unit/);
  assert.equal(navItems.find((item) => item.id === 'workbench')?.label, 'Chat');
});

test('chat panel primary DOM omits runtime implementation terms', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-runtime-surface',
    scenarioId: 'literature-evidence-review',
    title: 'runtime surface',
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
    messages: [{
      id: 'msg-user-runtime-surface',
      role: 'user',
      content: '请总结当前 UI。',
      createdAt: '2026-05-21T00:00:00.000Z',
    }, {
      id: 'msg-assistant-runtime-surface',
      role: 'scenario',
      content: '已按 subagent 风格整理。',
      createdAt: '2026-05-21T00:00:05.000Z',
      provenance: {
        kind: 'native-message',
        source: 'gui.present:codex-command-native-message',
        runtimeRequestEligible: false,
        liveAcceptanceEligible: false,
      },
    }],
    runs: [{
      id: 'run-codex-runtime-surface',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: '请总结当前 UI。',
      response: '已按 subagent 风格整理。',
      createdAt: '2026-05-21T00:00:01.000Z',
      raw: {
        displayIntent: {
          conversationProjection: {
            schemaVersion: 'sciforge.conversation-projection.v1',
            conversationId: 'runtime-surface',
            visibleAnswer: {
              status: 'repair-needed',
              text: '已按 subagent 风格整理。',
              artifactRefs: [],
              diagnostic: 'Runtime Codex started with sciforge-deepseek-proxy/bailian/deepseek-v4-flash profile sciforge-runtime-deepseek.',
            },
            activeRun: { id: 'run-codex-runtime-surface', status: 'repair-needed' },
            artifacts: [],
            executionProcess: [],
            recoverActions: [
              'Retry or continue from this failed Runtime Codex run with the preserved command id, attempt id, profile, workspace, and audit refs.',
            ],
            verificationState: { status: 'failed' },
            auditRefs: [],
            diagnostics: [],
          },
        },
      },
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
  };
  const html = renderChatPanel(createElement(ChatPanel, {
    scenarioId: 'literature-evidence-review',
    role: 'Researcher',
    config: {
      ...defaultSciForgeConfig,
      runtimeProfile: 'sciforge-runtime-deepseek',
      modelProvider: 'sciforge-deepseek-proxy',
      modelName: 'bailian/deepseek-v4-flash',
    },
    session,
    input: '',
    savedScrollTop: 0,
    onInputChange: () => undefined,
    onScrollTopChange: () => undefined,
    onSessionChange: () => undefined,
    onNewChat: () => undefined,
    onDeleteChat: () => undefined,
    archivedSessions: [],
    onRestoreArchivedSession: () => undefined,
    onDeleteArchivedSessions: () => undefined,
    onClearArchivedSessions: () => undefined,
    onEditMessage: () => undefined,
    onDeleteMessage: () => undefined,
    archivedCount: 0,
    onAutoRunConsumed: () => undefined,
    onConfigChange: () => undefined,
    onTimelineEvent: () => undefined,
    onActiveRunChange: () => undefined,
    onMarkReusableRun: () => undefined,
    onObjectFocus: () => undefined,
    runtimeHealth: [],
  }));

  for (const term of [
    'user-authored',
    'live-runtime-codex',
    'Verification:',
    'native-message',
    'codex-command',
    '/runtime-codex',
    'workspace-write',
    'sciforge-runtime-deepseek',
    'sciforge-deepseek-proxy',
    'bailian/deepseek-v4-flash',
    'provider',
    'model',
    'profile',
    'command id',
    'attempt id',
    'used/window',
    'raw output',
    'run id',
    'run-codex',
  ]) {
    assert.doesNotMatch(html, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(html, /已按 subagent 风格整理/);
  assert.match(html, /Activity|过程/);
});

test('selected-reference follow-up messages show compact continuity context', () => {
  const pickedReport = {
    id: 'obj-picked-report',
    kind: 'artifact' as const,
    title: 'Selected research report',
    ref: 'artifact:selected-report',
    status: 'available' as const,
  };
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-selected-followup',
    scenarioId: 'literature-evidence-review',
    title: 'selected followup',
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
    messages: [{
      id: 'user-followup',
      role: 'user',
      content: '请继续解释这个 report 的证据。',
      createdAt: '2026-05-17T00:00:01.000Z',
      references: [composerReferenceForObjectReference(pickedReport)],
    }],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
  };
  const html = renderChatPanel(createElement(ChatPanel, {
    scenarioId: 'literature-evidence-review',
    role: 'Researcher',
    config: defaultSciForgeConfig,
    session,
    input: '',
    savedScrollTop: 0,
    onInputChange: () => undefined,
    onScrollTopChange: () => undefined,
    onSessionChange: () => undefined,
    onNewChat: () => undefined,
    onDeleteChat: () => undefined,
    archivedSessions: [],
    onRestoreArchivedSession: () => undefined,
    onDeleteArchivedSessions: () => undefined,
    onClearArchivedSessions: () => undefined,
    onEditMessage: () => undefined,
    onDeleteMessage: () => undefined,
    archivedCount: 0,
    onAutoRunConsumed: () => undefined,
    onConfigChange: () => undefined,
    onTimelineEvent: () => undefined,
    onActiveRunChange: () => undefined,
    onMarkReusableRun: () => undefined,
    onObjectFocus: () => undefined,
    runtimeHealth: [],
  }));

  assert.match(html, /Continuing with/);
  assert.match(html, /Selected research report/);
  assert.match(html, /session-selected-followup|selected-/);
});
