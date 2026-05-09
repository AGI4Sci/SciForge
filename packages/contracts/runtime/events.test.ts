import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONTEXT_COMPACTION_EVENT_TYPE,
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
  WORKSPACE_RUNTIME_EVENT_TYPE,
  latencyDiagnosticsCachePolicy,
  normalizeRuntimeContextCompactionStatus,
  normalizeRuntimeContextWindowStatus,
  normalizeRuntimeWorkspaceEventType,
  projectToolDoneEvent,
  projectToolFailedEvent,
  projectToolStartedEvent,
  projectToolFailureDetail,
  runtimeDetailIndicatesAbort,
  runtimeEventIsBackend,
  runtimeEventIsUserVisible,
  runtimeStreamEventLabel,
  targetIssueLookupFailedEvent,
  targetIssueReadEvent,
  targetRepairModifyingEvent,
  targetRepairWrittenBackEvent,
  targetWorktreePreparingEvent,
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
