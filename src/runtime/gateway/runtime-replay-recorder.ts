import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { createRuntimeEventRecorder } from '../runtime-event-recorder.js';
import { sessionBundleRelForRequest } from '../session-bundle.js';
import { isRecord } from '../gateway-utils.js';

export const RUNTIME_REPLAY_RECORDER_OPTION_SCHEMA_VERSION = 'sciforge.runtime-replay-recorder-option.v1' as const;
export const RUNTIME_REPLAY_RECORDER_LOG_KIND = 'runtime-replay-recorder' as const;
export const RUNTIME_REPLAY_RECORDER_PROVIDER = 'sciforge-runtime' as const;

export interface RuntimeReplayRecorderOptions {
  enabled?: boolean;
  runId?: string;
  sessionId?: string;
  sessionBundleRef?: string;
  runtimeEventsRef?: string;
  now?: () => Date;
}

export interface RuntimeReplayRecorderPlan {
  enabled: boolean;
  reason?: 'not-enabled' | 'missing-workspace';
  runtimeEventsRef?: string;
  sessionBundleRef?: string;
}

export interface RuntimeReplayRecorderApplication extends RuntimeReplayRecorderPlan {
  callbacks: WorkspaceRuntimeCallbacks;
  plan: RuntimeReplayRecorderPlan;
  flush?: () => Promise<void>;
}

export function attachRuntimeReplayRecorderRefs(
  payload: ToolPayload,
  recorder: RuntimeReplayRecorderApplication,
): ToolPayload {
  if (!recorder.enabled || !recorder.runtimeEventsRef || !recorder.sessionBundleRef) return payload;
  const data = {
    schemaVersion: RUNTIME_REPLAY_RECORDER_OPTION_SCHEMA_VERSION,
    enabled: true,
    runtimeEventsRef: recorder.runtimeEventsRef,
    sessionBundleRef: recorder.sessionBundleRef,
  };
  return {
    ...payload,
    logs: [
      ...(payload.logs ?? []),
      {
        kind: RUNTIME_REPLAY_RECORDER_LOG_KIND,
        ref: recorder.runtimeEventsRef,
        data,
      },
    ],
    workEvidence: [
      ...(payload.workEvidence ?? []),
      {
        kind: 'other',
        status: 'success',
        provider: RUNTIME_REPLAY_RECORDER_PROVIDER,
        input: { enabled: true },
        resultCount: 1,
        outputSummary: 'Runtime replay recorder captured gateway events for explicit opt-in audit replay.',
        evidenceRefs: [recorder.runtimeEventsRef, recorder.sessionBundleRef],
        recoverActions: [],
        diagnostics: [`runtimeEventsRef=${recorder.runtimeEventsRef}`, `sessionBundleRef=${recorder.sessionBundleRef}`],
        rawRef: recorder.runtimeEventsRef,
      },
    ],
  };
}

export function runtimeReplayRecorderOptionsFromRequest(request: GatewayRequest): RuntimeReplayRecorderOptions {
  const config = isRecord(request.uiState?.runtimeReplayRecorder) ? request.uiState.runtimeReplayRecorder : {};
  const sessionId = stringField(request.uiState?.sessionId);
  const runId = stringField(config.runId)
    ?? stringField(request.uiState?.activeRunId)
    ?? stringField(request.uiState?.runId)
    ?? fallbackRunId(request);
  return {
    enabled: config.enabled === true,
    runId,
    sessionId,
  };
}

export function applyRuntimeReplayRecorder(
  callbacks: WorkspaceRuntimeCallbacks = {},
  request: GatewayRequest,
  options: RuntimeReplayRecorderOptions = runtimeReplayRecorderOptionsFromRequest(request),
): RuntimeReplayRecorderApplication {
  if (options.enabled !== true) {
    const plan = { enabled: false, reason: 'not-enabled' as const };
    return { ...plan, plan, callbacks };
  }
  if (!request.workspacePath) {
    const plan = { enabled: false, reason: 'missing-workspace' as const };
    return { ...plan, plan, callbacks };
  }

  const sessionBundleRef = options.sessionBundleRef ?? sessionBundleRelForRequest(request);
  const recorder = createRuntimeEventRecorder(callbacks, {
    workspacePath: request.workspacePath,
    sessionBundleRef,
    sessionId: options.sessionId,
    runId: options.runId,
    recordRel: options.runtimeEventsRef,
    now: options.now,
  });
  const plan = {
    enabled: true,
    runtimeEventsRef: recorder.runtimeEventsRef,
    sessionBundleRef,
  };
  return {
    ...plan,
    plan,
    callbacks: recorder.callbacks,
    async flush() {
      try {
        await recorder.flush();
      } catch {
        // Runtime replay capture is opt-in audit data; it must not change gateway success/failure semantics.
      }
    },
  };
}

function fallbackRunId(request: GatewayRequest) {
  const sessionId = stringField(request.uiState?.sessionId);
  return `run:${sessionId ?? request.skillDomain}:runtime-replay`;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
