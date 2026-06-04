import type { BackendNormalizedEvent } from './backend-event-normalization.js';
import type { CodexRuntimeMetadata, NormalizedAgentEvent, NormalizedAgentEventType } from './codex-event-normalizer.js';
import type { ModulePipelineTraceStep } from '@sciforge-ui/runtime-contract/modules';

export function backendEventToNormalizedAgentEvent(
  event: BackendNormalizedEvent,
  metadata: CodexRuntimeMetadata,
  traceSteps: ModulePipelineTraceStep[] = [],
): NormalizedAgentEvent {
  const type = agentEventType(event);
  const raw = {
    boundary: 'backend-neutral-normalized-event',
    backend: event.backend,
    event,
    pipelineTrace: traceSteps,
  };
  if (event.type === 'approval_requested') {
    const title = event.message ?? event.text ?? 'Approval requested';
    const text = formatApprovalText(event);
    return baseEvent(metadata, 'gui_ask_user', event, {
      status: 'needs-confirmation',
      message: text,
      text,
      raw: {
        ...raw,
        boundary: 'backend-neutral-approval-request',
        askUser: {
          source: `${event.backend}:approval:${event.approvalId ?? event.traceStepId ?? metadata.commandId}`,
          kind: 'confirmation',
          title,
          message: event.text,
          text,
          approvalRequest: {
            id: event.approvalId,
            backend: event.backend,
            status: event.status,
            traceStepId: event.traceStepId,
          },
        },
      },
    });
  }
  return baseEvent(metadata, type, event, { raw });
}

function baseEvent(
  metadata: CodexRuntimeMetadata,
  type: NormalizedAgentEventType,
  event: BackendNormalizedEvent,
  extra: Partial<NormalizedAgentEvent>,
): NormalizedAgentEvent {
  return {
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type,
    timestamp: event.timestamp,
    provider: metadata.provider,
    model: metadata.model,
    profile: metadata.profile,
    workspace: metadata.workspace,
    commandId: metadata.commandId,
    attemptId: metadata.attemptId,
    codexSessionId: event.threadId ?? metadata.codexSessionId,
    evidenceRefs: metadata.evidenceRefs,
    itemId: event.itemId,
    toolName: event.toolName,
    text: event.text,
    message: event.message ?? event.text,
    status: event.status,
    ...extra,
    command: event.command,
    diff: event.diff,
    outputSummary: event.outputSummary,
    resultSummary: event.resultSummary,
    exitCode: event.exitCode,
    filePath: event.filePath,
    fileRef: event.fileRef,
    ref: event.ref,
    agentId: event.agentId,
    parentAgentId: event.parentAgentId,
    agentType: event.agentType,
    resultRef: event.resultRef,
    transcriptRef: event.transcriptRef,
    refs: event.refs,
    durationMs: event.durationMs,
    background: event.background,
    resume: event.resume,
    traceStepId: event.traceStepId,
  };
}

function agentEventType(event: BackendNormalizedEvent): NormalizedAgentEventType {
  if (event.type === 'message_delta') return 'message_delta';
  if (event.type === 'message') return 'message';
  if (event.type === 'thread_started') return 'thread_started';
  if (event.type === 'turn_started') return 'turn_started';
  if (event.type === 'item_started') return 'item_started';
  if (event.type === 'item_completed') return 'item_completed';
  if (event.type === 'gui_present') return 'gui_present';
  if (event.type === 'gui_ask_user') return 'gui_ask_user';
  if (event.type === 'tool_started') return 'tool_started';
  if (event.type === 'tool_completed') return 'tool_completed';
  if (event.type === 'operation_progress') return 'operation_progress';
  if (event.type === 'done') return 'done';
  if (event.type === 'failed') return 'failed';
  if (event.type === 'cancelled') return 'cancelled';
  return 'audit';
}

function formatApprovalText(event: BackendNormalizedEvent): string {
  const title = event.message ?? event.text ?? (event.approvalId ? `Confirmation required ${event.approvalId}` : 'Confirmation required');
  return [
    `## ${title}`,
    'Confirm before continuing.',
  ].filter(Boolean).join('\n\n');
}
