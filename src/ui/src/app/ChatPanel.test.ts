import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PROCESS_PROGRESS_EVENT_TYPE, PROCESS_PROGRESS_PHASE, PROCESS_PROGRESS_STATUS } from '@sciforge-ui/runtime-contract';
import { defaultSciForgeConfig } from '../config';
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
  assert.match(content, /读 \/structured\/read\.csv/);
  assert.match(content, /等 structured backend event/);
  assert.match(content, /下一步 structured next step/);
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

  assert.match(processHtml, /GUI intent summarized the durable report ref/);
  assert.doesNotMatch(processHtml, /ConversationProjection/);
  assert.match(processHtml, /状态：完成/);
  assert.doesNotMatch(processHtml, /LEGACY_EXECUTION_UNIT_SHOULD_NOT_RENDER/);
  assert.doesNotMatch(processHtml, /legacy\.raw/);
  assert.match(keyInfoHtml, /本轮结果/);
  assert.match(keyInfoHtml, /Projection Report/);
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

  assert.match(html, /1 objects · 0 claims/);
  assert.match(html, /file:p6-mini-grant\/timeline-budget\.md/);
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
  const session: SciForgeSession = {
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
  };
  const html = renderToStaticMarkup(createElement(ChatPanel, {
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
      id: 'live-runtime-message',
      role: 'scenario',
      content: 'live answer',
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

  const html = renderToStaticMarkup(createElement(ChatPanel, {
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
  assert.match(html, /data-message-id="live-runtime-message"/);
  assert.match(html, /data-message-provenance="assistant-result"/);
  assert.match(html, /data-live-acceptance-eligible="true"/);
  assert.match(html, /data-message-id="native-runtime-message"/);
  assert.match(html, /data-message-provenance="assistant-result"/);
  assert.doesNotMatch(html, /native-message/);
  assert.doesNotMatch(html, /codex-command-native-message/);
  assert.doesNotMatch(html, /codex-command-live/);
  assert.doesNotMatch(html, /live-runtime-codex|live Runtime Codex|运行结果/);
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
  const chatHtml = renderToStaticMarkup(createElement(ChatPanel, {
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

  assert.match(chatHtml, /Ask SciForge/);
  assert.match(chatHtml, /当前上下文/);
  assert.match(chatHtml, /模型在线|模型待配置/);
  assert.match(chatHtml, /可写工作区/);
  assert.doesNotMatch(chatHtml, /workspace-write/);
  assert.doesNotMatch(chatHtml, /sciforge-runtime-deepseek/);
  assert.doesNotMatch(chatHtml, /GUI tools|gui\.present|\/runtime-codex|data-terminal-command-text/);
  assert.doesNotMatch(chatHtml, /used\/window|Codex Runtime owns|provider unset|model unset/);
  assert.doesNotMatch(chatHtml, /文献证据评估场景/);
  assert.doesNotMatch(chatHtml, /Scenario Runtime/);
  assert.match(topbarHtml, /SciForge · ready/);
  assert.match(topbarHtml, /搜索文件、报告、运行、问题/);
  assert.doesNotMatch(topbarHtml, /Execution Unit/);
  assert.equal(navItems.find((item) => item.id === 'workbench')?.label, '聊天工作台');
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
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
  };
  const html = renderToStaticMarkup(createElement(ChatPanel, {
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
    'used/window',
    'raw output',
    'run-codex',
  ]) {
    assert.doesNotMatch(html, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(html, /已按 subagent 风格整理/);
  assert.match(html, /过程/);
});

test('selected-reference follow-up messages show compact continuity context', () => {
  const pickedReport = {
    id: 'obj-picked-report',
    kind: 'artifact' as const,
    title: 'Selected research report',
    ref: 'artifact:selected-report',
    status: 'available' as const,
    runId: 'run-selected',
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
  const html = renderToStaticMarkup(createElement(ChatPanel, {
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

  assert.match(html, /继续基于当前对话/);
  assert.match(html, /Selected research report/);
  assert.match(html, /session-selected-followup|selected-/);
});
