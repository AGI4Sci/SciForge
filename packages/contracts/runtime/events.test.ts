import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACCEPTANCE_REPAIR_RERUN_TOOL_ID,
  BACKGROUND_COMPLETION_CONTRACT_ID,
  BACKGROUND_COMPLETION_TOOL_ID,
  CONTEXT_COMPACTION_EVENT_TYPE,
  DIRECT_CONTEXT_FAST_PATH_EVENT_TYPE,
  GUIDANCE_QUEUED_EVENT_TYPE,
  GUIDANCE_QUEUE_RUN_ORCHESTRATION_CONTRACT,
  LATENCY_DIAGNOSTICS_EVENT_TYPE,
  LATENCY_DIAGNOSTICS_REF,
  PROCESS_EVENTS_SCHEMA_VERSION,
  PROCESS_PROGRESS_EVENT_TYPE,
  PROJECT_TOOL_DONE_EVENT_TYPE,
  PROJECT_TOOL_FAILED_EVENT_TYPE,
  PROJECT_TOOL_STARTED_EVENT_TYPE,
  TARGET_ISSUE_LOOKUP_FAILED_EVENT_TYPE,
  TARGET_ISSUE_READ_EVENT_TYPE,
  TARGET_REPAIR_MODIFYING_EVENT_TYPE,
  TARGET_REPAIR_WRITTEN_BACK_EVENT_TYPE,
  TARGET_WORKTREE_PREPARING_EVENT_TYPE,
  USER_INTERRUPT_EVENT_TYPE,
  WORKSPACE_RUNTIME_EVENT_TYPE,
  agentServerConvergenceGuardEvent,
  agentServerContextWindowRecoverySucceededEvent,
  agentServerDispatchEvent,
  agentServerGenerationRecoveryEventType,
  agentServerGenerationRecoveryStartEvent,
  agentServerGenerationRetrySucceededEvent,
  agentServerSilentStreamGuardEvent,
  acceptanceRepairRerunToolId,
  backgroundCompletionContractId,
  backgroundCompletionToolId,
  compactRuntimePromptSummary,
  conversationPolicyStartedEvent,
  directContextFastPathEvent,
  gatewayRequestReceivedEvent,
  guidanceQueuedEvent,
  latencyDiagnosticsCachePolicy,
  normalizeRuntimeContextCompactionStatus,
  normalizeRuntimeContextWindowStatus,
  normalizeRuntimeWorkspaceEventType,
  projectToolDoneEvent,
  projectToolFailedEvent,
  projectToolStartedEvent,
  projectToolFailureDetail,
  repairAttemptResultEvent,
  repairAttemptStartEvent,
  runtimeDetailIndicatesAbort,
  runtimeEventIsBackend,
  runtimeEventIsUserVisible,
  runtimeRecoverActionLabel,
  runtimeRequestAcceptedProgressCopy,
  runtimeStreamEventLabel,
  runtimeTextLooksLikeGeneratedWorkDetail,
  runtimeToolEventActionKind,
  summarizeRuntimeGeneratedTaskFiles,
  targetIssueLookupFailedEvent,
  targetIssueReadEvent,
  targetRepairModifyingEvent,
  targetRepairWrittenBackEvent,
  targetWorktreePreparingEvent,
  userInterruptEvent,
  workspaceRuntimeResultCompletion,
} from './events';

test('workspace runtime completion is derived from contract-level result status policy', () => {
  assert.deepEqual(workspaceRuntimeResultCompletion({
    executionUnits: [{ id: 'unit-1', status: 'done' }],
    artifacts: [{ id: 'artifact-1', type: 'any-output' }],
  }), { status: 'completed' });

  assert.deepEqual(workspaceRuntimeResultCompletion({
    executionUnits: [{ id: 'unit-2', status: 'failed-with-reason', failureReason: 'missing required input ref' }],
    artifacts: [{ id: 'artifact-2', type: 'any-output' }],
  }), { status: 'failed', reason: 'missing required input ref' });

  assert.deepEqual(workspaceRuntimeResultCompletion({
    message: 'result-bundle status=repair-needed',
  }), { status: 'failed', reason: 'result-bundle status=repair-needed' });
});

test('runtime context status normalization stays in runtime contract policy', () => {
  assert.equal(normalizeRuntimeContextWindowStatus(undefined, 0.9, 0.82), 'near-limit');
  assert.equal(normalizeRuntimeContextWindowStatus('window overflow', 0.4, 0.82), 'exceeded');
  assert.equal(normalizeRuntimeContextCompactionStatus('compressed'), 'completed');
  assert.equal(normalizeRuntimeContextCompactionStatus(undefined, { ok: false, message: 'backend error' }), 'failed');
});

test('runtime event projection exports stable fallback types and diagnostics', () => {
  assert.equal(WORKSPACE_RUNTIME_EVENT_TYPE, 'workspace-runtime-event');
  assert.equal(PROJECT_TOOL_STARTED_EVENT_TYPE, 'project-tool-start');
  assert.equal(PROJECT_TOOL_DONE_EVENT_TYPE, 'project-tool-done');
  assert.equal(PROJECT_TOOL_FAILED_EVENT_TYPE, 'project-tool-failed');
  assert.equal(runtimeStreamEventLabel('tool-call', 'workspace-runtime', 'read_artifact'), '调用 read_artifact');
  assert.equal(runtimeDetailIndicatesAbort('request cancelled by user'), true);
  assert.equal(projectToolFailureDetail('network down'), 'SciForge project tool unavailable: network down');
});

test('runtime events policy owns background completion tool ids and helper labels', () => {
  assert.equal(BACKGROUND_COMPLETION_CONTRACT_ID, 'sciforge.background-completion.v1');
  assert.equal(BACKGROUND_COMPLETION_TOOL_ID, 'sciforge.background-completion');
  assert.equal(ACCEPTANCE_REPAIR_RERUN_TOOL_ID, 'sciforge.acceptance-repair-rerun');
  assert.equal(backgroundCompletionContractId(), BACKGROUND_COMPLETION_CONTRACT_ID);
  assert.equal(backgroundCompletionToolId(), BACKGROUND_COMPLETION_TOOL_ID);
  assert.equal(acceptanceRepairRerunToolId(), ACCEPTANCE_REPAIR_RERUN_TOOL_ID);

  assert.equal(runtimeRecoverActionLabel('run-current-scenario'), '运行当前场景');
  assert.equal(runtimeRecoverActionLabel('inspect-artifact-schema:paper-list'), '检查 paper-list schema');
  assert.equal(runtimeRecoverActionLabel('import-package:literature-review'), '导入 literature-review package');
  assert.equal(runtimeRecoverActionLabel('custom-manual-step'), 'custom-manual-step');
});

test('runtime generated-work helpers identify task files and action kinds', () => {
  const payload = JSON.stringify({
    taskFiles: [
      { path: '.sciforge/tasks/generated/report.py' },
      { path: '.sciforge/tasks/generated/report.py' },
      { path: '.sciforge/tasks/generated/run.sh' },
      { path: '.sciforge/notes/readme.md' },
    ],
    entrypoint: '.sciforge/tasks/generated/report.py',
  });

  assert.equal(runtimeTextLooksLikeGeneratedWorkDetail(payload), true);
  assert.equal(runtimeTextLooksLikeGeneratedWorkDetail('plain backend heartbeat'), false);
  assert.equal(
    summarizeRuntimeGeneratedTaskFiles(payload),
    '生成任务文件：.sciforge/tasks/generated/report.py、.sciforge/tasks/generated/run.sh',
  );
  assert.equal(summarizeRuntimeGeneratedTaskFiles('no task marker'), '');
  assert.equal(runtimeToolEventActionKind({ detail: 'write_file .sciforge/tasks/generated/report.py' }), 'script-write');
  assert.equal(runtimeToolEventActionKind({ toolName: 'run_command', detail: 'python -m pytest' }), 'command');
});

test('runtime events policy owns gateway event classification and latency refs', () => {
  assert.equal(normalizeRuntimeWorkspaceEventType('context_compressor', {}), CONTEXT_COMPACTION_EVENT_TYPE);
  assert.equal(normalizeRuntimeWorkspaceEventType('provider-rate-limit', { rate_limit_reset_at: 'soon' }), 'rateLimit');
  assert.equal(runtimeEventIsUserVisible({ type: LATENCY_DIAGNOSTICS_EVENT_TYPE, message: 'done' }), false);
  assert.equal(runtimeEventIsUserVisible({ type: 'status', message: 'visible' }), true);
  assert.equal(runtimeEventIsBackend({ type: 'agentserver-stage-start' }), true);
  assert.equal(runtimeEventIsBackend({ type: 'status', source: 'workspace-runtime' }), false);
  assert.deepEqual(latencyDiagnosticsCachePolicy({
    reuseScenarioPlan: true,
    reuseUiPlan: false,
    unrelated: true,
  }), {
    hits: ['reuseScenarioPlan'],
    misses: ['reuseUiPlan'],
  });
  assert.equal(LATENCY_DIAGNOSTICS_REF, 'runtime://latency-diagnostics');
  assert.equal(PROCESS_EVENTS_SCHEMA_VERSION, 'sciforge.process-events.v1');
  assert.equal(runtimeStreamEventLabel(PROCESS_PROGRESS_EVENT_TYPE), '过程');
});

test('runtime events policy owns accepted prompt compaction copy', () => {
  assert.equal(compactRuntimePromptSummary('  first\n\nsecond\tthird  '), 'first second third');
  assert.equal(compactRuntimePromptSummary('x'.repeat(200)).length, 160);
  assert.deepEqual(runtimeRequestAcceptedProgressCopy('  compare\nartifacts  '), {
    detail: '正在把本轮请求交给 workspace runtime：compare artifacts',
    waitingFor: 'workspace runtime 首个事件',
    nextStep: '收到后端事件后继续展示读取、执行、写入和验证进展。',
    reason: 'request-accepted-before-backend-stream',
  });
  assert.match(runtimeRequestAcceptedProgressCopy('').detail, /workspace runtime。/);
});

test('project tool event projection owns stable ids and user-visible copy', () => {
  const identity = { id: 'evt-project', createdAt: '2026-05-07T00:00:00.000Z' };
  assert.deepEqual(projectToolStartedEvent(identity, 'literature-evidence-review'), {
    id: 'evt-project',
    type: PROJECT_TOOL_STARTED_EVENT_TYPE,
    label: '项目工具',
    detail: 'SciForge literature-evidence-review project tool started',
    createdAt: identity.createdAt,
    raw: {
      type: PROJECT_TOOL_STARTED_EVENT_TYPE,
      detail: 'SciForge literature-evidence-review project tool started',
    },
  });
  assert.equal(
    projectToolDoneEvent(identity, 'literature-evidence-review', { status: 'failed', reason: 'repair-needed' }).detail,
    'SciForge literature-evidence-review 未完成：repair-needed',
  );
  assert.deepEqual(projectToolFailedEvent(identity, 'network down').raw, { error: 'network down' });
});

test('chat shell event projection owns guidance and interrupt contracts', () => {
  const identity = { id: 'evt-chat', createdAt: '2026-05-08T00:01:00.000Z' };
  const guidance = {
    id: 'guidance-1',
    prompt: 'skip broad web fetches',
    status: 'queued' as const,
    receivedAt: identity.createdAt,
    activeRunId: 'run-active',
    reason: 'backend run is active',
  };

  assert.deepEqual(guidanceQueuedEvent(identity, guidance), {
    id: identity.id,
    type: GUIDANCE_QUEUED_EVENT_TYPE,
    label: '引导已排队',
    detail: `${guidance.prompt}\n状态：已排队，等待当前 run 结束后合并到下一轮。`,
    createdAt: identity.createdAt,
    raw: {
      guidanceQueue: guidance,
      contract: GUIDANCE_QUEUE_RUN_ORCHESTRATION_CONTRACT,
    },
  });
  assert.deepEqual(userInterruptEvent(identity), {
    id: identity.id,
    type: USER_INTERRUPT_EVENT_TYPE,
    label: '中断请求',
    detail: '用户请求中断当前 backend 运行；已关闭当前 HTTP stream，并清空排队引导。',
    createdAt: identity.createdAt,
  });
});

test('target issue event projection owns repair handoff event types and payloads', () => {
  const identity = { id: 'evt-target', createdAt: '2026-05-07T00:00:00.000Z' };
  assert.equal(targetIssueLookupFailedEvent(identity, 'missing', { status: 'failed' }).type, TARGET_ISSUE_LOOKUP_FAILED_EVENT_TYPE);
  assert.deepEqual(targetIssueReadEvent(identity, {
    peerName: 'Repair B',
    issueId: 'feedback-1',
    raw: { issueLookup: { matchedIssueId: 'feedback-1' } },
  }), {
    id: 'evt-target',
    type: TARGET_ISSUE_READ_EVENT_TYPE,
    label: '已读取 B issue',
    detail: '已从 Repair B 读取 issue bundle feedback-1。',
    createdAt: identity.createdAt,
    raw: { issueLookup: { matchedIssueId: 'feedback-1' } },
  });
  assert.equal(targetWorktreePreparingEvent(identity, { targetName: 'Repair B', issueRef: 'feedback-1' }).type, TARGET_WORKTREE_PREPARING_EVENT_TYPE);
  assert.equal(targetRepairModifyingEvent(identity, { targetName: 'Repair B', issueRef: 'feedback-1' }).type, TARGET_REPAIR_MODIFYING_EVENT_TYPE);
  assert.equal(targetRepairWrittenBackEvent(identity, { targetName: 'Repair B', issueRef: 'feedback-1' }).type, TARGET_REPAIR_WRITTEN_BACK_EVENT_TYPE);
});

test('gateway event projection owns runtime generation event ids and copy', () => {
  assert.deepEqual(gatewayRequestReceivedEvent('literature'), {
    type: 'gateway-request-received',
    source: 'workspace-runtime',
    status: 'running',
    message: 'Workspace runtime received the chat turn and is preparing policy and execution routing.',
    detail: 'literature',
  });
  assert.equal(conversationPolicyStartedEvent().type, 'conversation-policy-started');
  assert.equal(directContextFastPathEvent({ plan: 'direct' }).type, DIRECT_CONTEXT_FAST_PATH_EVENT_TYPE);
  assert.deepEqual(repairAttemptStartEvent({ attempt: 2, maxAttempts: 3, failureReason: 'schema mismatch' }), {
    type: 'repair-attempt-start',
    source: 'workspace-runtime',
    status: 'running',
    message: 'AgentServer repair attempt 2/3',
    detail: 'schema mismatch',
  });
  assert.equal(repairAttemptResultEvent({ attempt: 2, maxAttempts: 3, exitCode: 1, stderr: 'failed' }).status, 'failed');
  assert.equal(agentServerDispatchEvent({
    backend: 'codex',
    baseUrl: 'http://agent',
    normalizedBytes: 12,
    maxPayloadBytes: 100,
    rawRef: 'raw.json',
  }).type, 'agentserver-dispatch');
  assert.equal(agentServerConvergenceGuardEvent('guard tripped').type, 'agentserver-convergence-guard');
  assert.equal(agentServerSilentStreamGuardEvent('silent').type, 'agentserver-silent-stream-guard');
  assert.equal(agentServerGenerationRecoveryEventType(['context-window']), 'agentserver-context-window-recovery');
  assert.equal(agentServerGenerationRecoveryEventType(['rate-limit']), 'agentserver-generation-retry');
  assert.equal(agentServerGenerationRecoveryStartEvent({ categories: ['http-429'], detail: 'retry later', raw: {} }).type, 'agentserver-generation-retry');
  assert.equal(agentServerContextWindowRecoverySucceededEvent({ detail: 'ok', raw: {} }).type, 'agentserver-context-window-recovery');
  assert.equal(agentServerGenerationRetrySucceededEvent({ detail: 'ok', raw: {} }).type, 'agentserver-generation-retry');
});
