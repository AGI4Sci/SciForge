import { parseGenericActions } from '../computer-use/actions.js';
import {
  VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE,
  type VirtualScreenCanvasInputIntentCommand,
} from '../computer-use/input-intent-command.js';
import {
  runVirtualAppScreenInputRuntime,
  tryRunVirtualAppScreenInputRuntimeNativeHost,
  type VirtualAppScreenInputRuntimeProjection,
} from '../computer-use/virtual-app-screen-input-runtime.js';
import type { GenericVisionAction } from '../computer-use/types.js';
import { readVirtualAppScreenNativeHostSessionRecord, type VirtualAppScreenNativeHostSessionRecord } from '../computer-use/virtual-app-screen-native-host-session-store.js';
import { readVirtualAppScreenProviderSessionRecord, type VirtualAppScreenProviderSessionRecord } from '../computer-use/virtual-app-screen-provider-session-store.js';
import {
  runComputerUseCodexTextPlanner,
  type ComputerUseTextPlannerOptions,
} from './computer-use-text-planner.js';
import type {
  CodexAgentHostComputerUseActMaterializer,
  CodexAgentHostComputerUseActMaterializerInput,
  CodexAgentHostComputerUseActMaterializerResult,
} from './agent-host-turn-loop.js';

const TOOL_ID = 'virtual-app-screen.computer-use-act-materializer';
const NATIVE_HOST_PROVIDER_ID = 'native-virtual-app-screen-host';
const OBSERVATION_MAX_AGE_MS = 60_000;

export type VirtualAppScreenComputerUseActionPlannerResult =
  | {
      status: 'planned';
      message: string;
      actions: GenericVisionAction[];
      evidenceRefs?: string[];
    }
  | {
      status: 'done' | 'blocked';
      message: string;
      actions?: GenericVisionAction[];
      evidenceRefs?: string[];
    };

export type VirtualAppScreenComputerUseActionPlanner =
  (input: CodexAgentHostComputerUseActMaterializerInput) =>
    Promise<VirtualAppScreenComputerUseActionPlannerResult> | VirtualAppScreenComputerUseActionPlannerResult;

export function createDefaultVirtualAppScreenComputerUseActMaterializer(options: {
  actionPlanner?: VirtualAppScreenComputerUseActionPlanner;
  textPlannerOptions?: Partial<ComputerUseTextPlannerOptions>;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
} = {}): CodexAgentHostComputerUseActMaterializer {
  const planner = options.actionPlanner ?? createRuntimeCodexVirtualAppScreenActionPlanner({
    ...options.textPlannerOptions,
    env: options.env ?? options.textPlannerOptions?.env,
  });
  const now = options.now ?? (() => new Date());
  return async (input) => {
    const notReady = preflightNotReady(input);
    if (notReady) return blockedResult(input, notReady, ['runtime-truth:act-materializer/virtual-app-screen-preflight-not-ready']);

    const binding = virtualAppScreenBindingFromInput(input);
    if (!binding) {
      return blockedResult(input, 'Computer Use Act materializer blocked: runtime-owned NativeHost/VirtualAppScreen target binding is missing.', [
        'runtime-truth:act-materializer/virtual-app-screen-target-missing',
      ]);
    }
    const bindingBlocked = bindingNotExecutable(binding.nativeHostSession, now());
    if (bindingBlocked) {
      return blockedResult(input, `Computer Use Act materializer blocked: ${bindingBlocked}.`, [
        'runtime-truth:act-materializer/virtual-app-screen-binding-not-executable',
        ...bindingEvidenceRefs(binding),
      ]);
    }

    const plan = await planner(input);
    const planRefs = runtimeOwnedRefs(plan.evidenceRefs ?? []);
    if (plan.status === 'blocked') return blockedResult(input, plan.message, ['action-ledger:planner/blocked', ...planRefs, ...bindingEvidenceRefs(binding)]);
    if (plan.status === 'done') {
      return {
        status: 'completed',
        message: plan.message,
        confidence: 0.74,
        claimType: 'runtime-action',
        reasoningTrace: 'Computer Use planner determined the VirtualAppScreen target already satisfied the requested low-risk GUI action.',
        evidenceRefs: runtimeOwnedRefs([
          `action-ledger:virtual-app-screen/${binding.nativeHostSession.sessionId}/planner-done`,
          ...planRefs,
          ...bindingEvidenceRefs(binding),
        ]),
        executionUnits: [executionUnit(input, binding.nativeHostSession, 'done', 'planner-done')],
        claims: [claim(input, plan.message, [`action-ledger:virtual-app-screen/${binding.nativeHostSession.sessionId}/planner-done`, ...planRefs])],
      };
    }

    const actions = plan.actions ?? [];
    if (actions.length !== 1) return blockedResult(input, 'Computer Use Act materializer blocked: planner must return exactly one next VirtualAppScreen action.', ['action-ledger:planner/action-count-invalid', ...planRefs]);
    const action = actions[0];
    if (!action) return blockedResult(input, 'Computer Use Act materializer blocked: planner returned no executable VirtualAppScreen action.', ['action-ledger:planner/action-missing', ...planRefs]);

    const command = inputIntentCommandFromAction(action, binding);
    if ('reason' in command) {
      return blockedResult(input, `Computer Use Act materializer blocked before VirtualAppScreen execution: ${command.reason}`, [
        'action-ledger:planner/grounding-required',
        ...planRefs,
        ...bindingEvidenceRefs(binding),
      ]);
    }

    const nativeHostResult = await tryRunVirtualAppScreenInputRuntimeNativeHost(command.command, {
      executorId: 'input-runtime:native-virtual-app-screen-host',
      providerId: NATIVE_HOST_PROVIDER_ID,
    });
    const result = nativeHostResult ?? await runVirtualAppScreenInputRuntime(command.command);
    if (result.status !== 'executed') {
      return blockedResult(input, `Computer Use Act materializer blocked during VirtualAppScreen execution: ${result.message}`, [
        ...inputRuntimeEvidenceRefs(result),
        ...planRefs,
        ...bindingEvidenceRefs(binding),
      ]);
    }

    const evidenceRefs = runtimeOwnedRefs([
      ...commandEvidenceRefs(command.command),
      ...inputRuntimeEvidenceRefs(result),
      ...planRefs,
      ...permissionRefs(input),
    ]);
    return {
      status: 'completed',
      message: result.message,
      confidence: 0.82,
      claimType: 'runtime-action',
      reasoningTrace: 'SciForge executed one low-risk Computer Use action through the runtime-owned VirtualAppScreen input runtime after Guard readiness passed.',
      evidenceRefs,
      executionUnits: [executionUnit(input, binding.nativeHostSession, 'done', action.type, result.runId, evidenceRefs[0])],
      artifacts: [{
        id: `virtual-app-screen-computer-use-action-${safeToken(result.runId) || 'action'}`,
        type: 'computer-use-action-result',
        metadata: {
          source: TOOL_ID,
          providerId: result.providerId ?? NATIVE_HOST_PROVIDER_ID,
          sessionRef: binding.nativeHostSession.sessionRef,
        },
        data: {
          schemaVersion: 'sciforge.virtual-app-screen.computer-use-action-summary.v1',
          inputChannel: 'virtual-app-screen-input-runtime',
          actionType: action.type,
          sharedSystemInputUsed: false,
          singleInteractiveTruth: true,
          evidenceRefs,
        },
      }],
      claims: [claim(input, `VirtualAppScreen executed ${action.type}.`, evidenceRefs)],
    };
  };
}

export function createRuntimeCodexVirtualAppScreenActionPlanner(
  options: Partial<ComputerUseTextPlannerOptions> = {},
): VirtualAppScreenComputerUseActionPlanner {
  return async (input) => {
    const run = await runComputerUseCodexTextPlanner({
      task: input.commandText,
      observation: {
        schemaVersion: 'sciforge.agent-host.virtual-app-screen-compact-observation.v1',
        target: input.runtimeTruth?.target ?? input.preflight.target,
        observation: input.runtimeTruth?.observation,
        evidenceRefs: runtimeOwnedRefs([
          ...input.preflight.evidenceRefs,
          ...(input.runtimeTruth?.refs ?? []),
        ]).slice(0, 12),
      },
      recentActions: runtimeOwnedRefs(input.runtimeTruth?.refs ?? [])
        .filter((ref) => ref.startsWith('action-ledger:'))
        .slice(0, 8)
        .join('\n'),
      verifierFeedback: 'No verifier feedback yet for this Agent Host turn.',
      desktopPlatform: process.platform,
      maxStepsRemaining: 1,
    }, {
      workspace: input.workspacePath,
      commandId: `${input.commandId}-virtual-app-screen-planner`,
      attemptId: `${input.attemptId}-virtual-app-screen-planner`,
      abortSignal: options.abortSignal,
      profile: options.profile,
      adapter: options.adapter,
      env: options.env,
      allowOpenAiRuntime: options.allowOpenAiRuntime,
    });
    if (!run.ok) {
      return {
        status: 'blocked',
        message: run.reason,
        evidenceRefs: ['action-ledger:planner/runtime-codex-blocked'],
      };
    }
    return plannerResultFromText(run.text);
  };
}

function plannerResultFromText(text: string): VirtualAppScreenComputerUseActionPlannerResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 'blocked', message: 'Computer Use planner returned non-JSON output.', evidenceRefs: ['action-ledger:planner/non-json-output'] };
  }
  if (!isRecord(parsed)) {
    return { status: 'blocked', message: 'Computer Use planner returned an invalid JSON shape.', evidenceRefs: ['action-ledger:planner/invalid-json-shape'] };
  }
  const reason = stringField(parsed.reason) ?? 'Computer Use planner result.';
  const actions = parseGenericActions(parsed.actions) as GenericVisionAction[];
  if (parsed.done === true) return { status: 'done', message: reason, actions: [], evidenceRefs: ['action-ledger:planner/done'] };
  if (isRecord(parsed.failure) || actions.length === 0) return { status: 'blocked', message: reason, actions, evidenceRefs: ['action-ledger:planner/no-safe-action'] };
  return { status: 'planned', message: reason, actions: actions.slice(0, 1), evidenceRefs: ['action-ledger:planner/next-action'] };
}

function preflightNotReady(input: CodexAgentHostComputerUseActMaterializerInput): string | undefined {
  if (input.preflight.status !== 'ready') return `preflight status is ${input.preflight.status}`;
  if (input.preflight.risk.decision !== 'auto') return `risk decision is ${input.preflight.risk.decision}`;
  if (!input.runtimeTruth?.permissions?.refs?.length) return 'runtime permission refs are missing';
  if (input.runtimeTruth.permissions.stopCancelPath !== true) return 'runtime stop/cancel path is missing';
  const readiness = input.runtimeTruth.readiness ?? {};
  for (const key of ['nativeBridge', 'nativeSurface', 'windowActionSession', 'computerUseAdapter'] as const) {
    if (readiness[key] !== 'ready') return `${key} is not runtime-ready`;
  }
  return undefined;
}

function virtualAppScreenBindingFromInput(input: CodexAgentHostComputerUseActMaterializerInput): {
  nativeHostSession: VirtualAppScreenNativeHostSessionRecord;
  providerSession?: VirtualAppScreenProviderSessionRecord;
} | undefined {
  for (const ref of candidateRefs(input)) {
    const nativeBySession = readVirtualAppScreenNativeHostSessionRecord({ sessionRef: ref });
    const nativeByScreen = readVirtualAppScreenNativeHostSessionRecord({ screenRef: ref });
    const providerBySession = readVirtualAppScreenProviderSessionRecord({ sessionRef: ref });
    const providerByScreen = readVirtualAppScreenProviderSessionRecord({ screenRef: ref });
    const providerSession = providerBySession ?? providerByScreen;
    const nativeFromProvider = providerSession
      ? readVirtualAppScreenNativeHostSessionRecord({ sessionRef: providerSession.sessionRef, screenRef: providerSession.screenRef })
      : undefined;
    const nativeHostSession = nativeBySession ?? nativeByScreen ?? nativeFromProvider;
    if (!nativeHostSession) continue;
    return {
      nativeHostSession,
      providerSession: providerSession
        ?? readVirtualAppScreenProviderSessionRecord({ sessionRef: nativeHostSession.sessionRef })
        ?? (nativeHostSession.screenRef ? readVirtualAppScreenProviderSessionRecord({ screenRef: nativeHostSession.screenRef }) : undefined),
    };
  }
  return undefined;
}

function bindingNotExecutable(record: VirtualAppScreenNativeHostSessionRecord, now: Date): string | undefined {
  if (record.owner !== 'NativeVirtualAppScreenHost') return 'target is not owned by NativeVirtualAppScreenHost';
  if (record.diagnosticOnly !== false) return 'NativeHost session is diagnostic-only';
  if (record.singleInteractiveTruth !== true || record.secondInteractiveSurfacePresent !== false || record.currentSessionOnly !== true) {
    return 'NativeHost session does not prove single current-session interactive truth';
  }
  if (!record.currentFrameRef || !record.currentFrameReadAt) return 'current frame evidence is missing';
  const readAt = Date.parse(record.currentFrameReadAt);
  if (!Number.isFinite(readAt) || now.getTime() - readAt > OBSERVATION_MAX_AGE_MS) return 'current frame evidence is stale';
  const requiredRefs = [
    record.sessionRef,
    record.screenRef,
    record.targetWindowRef,
    record.liveSurfaceRef,
    record.frameStreamRef,
    record.liveBindingAttachGrantRef,
    record.grantValidationRef,
    record.currentRunRef,
    record.currentRunPointerRef,
    record.adapterReadinessRef,
    record.evidenceLedgerRef,
    record.inputLeaseRef,
    record.actionAdapterRef,
  ];
  if (requiredRefs.some((ref) => !runtimeOwnedRef(ref ?? ''))) return 'runtime-owned session, frame, grant, lease, or adapter refs are missing';
  if (!(record.permissionRefs ?? []).some((ref) => /^permission:/i.test(ref) && runtimeOwnedRef(ref))) return 'NativeHost permission refs are missing';
  const liveBindingAttachGrantRef = record.liveBindingAttachGrantRef;
  if (!liveBindingAttachGrantRef) return 'NativeHost live binding grant ref is missing';
  const grant = record.host.validateGrant(liveBindingAttachGrantRef);
  if (!grant.ok) return `NativeHost grant validation failed: ${grant.issues.join(' ')}`;
  if (record.grantValidationRef && grant.validationLedgerEntryRef !== record.grantValidationRef) return 'NativeHost grant validation ref does not match current session';
  return undefined;
}

function inputIntentCommandFromAction(
  action: GenericVisionAction,
  binding: { nativeHostSession: VirtualAppScreenNativeHostSessionRecord; providerSession?: VirtualAppScreenProviderSessionRecord },
): { command: VirtualScreenCanvasInputIntentCommand } | { reason: string } {
  const record = binding.nativeHostSession;
  if (action.type === 'open_app' || action.type === 'save' || action.type === 'wait' || action.type === 'open_menu') {
    return { reason: `VirtualAppScreen input runtime does not execute action type "${action.type}" in this materializer.` };
  }
  const frame = frameFromAction(action);
  if ((action.type === 'click' || action.type === 'double_click') && (action.x === undefined || action.y === undefined)) {
    return { reason: 'pointer action is ungrounded; x/y frame-space coordinates are required' };
  }
  if (action.type === 'drag' && (action.fromX === undefined || action.fromY === undefined || action.toX === undefined || action.toY === undefined)) {
    return { reason: 'drag action is ungrounded; from/to frame-space coordinates are required' };
  }
  if ((action.type === 'click' || action.type === 'double_click' || action.type === 'drag') && (!frame.width || !frame.height)) {
    return { reason: 'pointer action is ungrounded; frame width/height are required to project VirtualAppScreen ratios' };
  }
  return {
    command: {
      source: VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE,
      intentKind: action.type,
      action,
      refs: {
        sessionRef: record.sessionRef,
        currentRunPointerRef: record.currentRunPointerRef,
        frameRef: record.currentFrameRef!,
        inputLeaseRef: record.inputLeaseRef!,
        actionAdapterRef: record.actionAdapterRef!,
        adapterReadinessRef: record.adapterReadinessRef,
        screenRef: record.screenRef,
        targetAppRef: binding.providerSession?.targetAppRef,
        targetWindowRef: record.targetWindowRef,
        evidenceLedgerRef: record.evidenceLedgerRef,
      },
      frame,
      ratios: {},
    },
  };
}

function frameFromAction(action: GenericVisionAction): { width?: number; height?: number } {
  const grounding = isRecord(action.grounding) ? action.grounding : undefined;
  const frame = isRecord(grounding?.frame) ? grounding.frame : undefined;
  return {
    width: positiveNumber(frame?.width),
    height: positiveNumber(frame?.height),
  };
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function candidateRefs(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
  return runtimeOwnedRefs([
    ...input.preflight.target.refs,
    ...input.preflight.evidenceRefs,
    ...(input.runtimeTruth?.target?.refs ?? []),
    ...(input.runtimeTruth?.observation?.refs ?? []),
    ...(input.runtimeTruth?.refs ?? []),
    ...input.agentHostInput.refs,
  ]).filter((ref) => /^(?:computer-use:native-host\/sessions\/|virtual-app-screen:|computer-use:provider-session\/)/i.test(ref));
}

function bindingEvidenceRefs(binding: { nativeHostSession: VirtualAppScreenNativeHostSessionRecord; providerSession?: VirtualAppScreenProviderSessionRecord }): string[] {
  const record = binding.nativeHostSession;
  return runtimeOwnedRefs([
    record.sessionRef,
    record.screenRef,
    record.targetWindowRef,
    record.liveSurfaceRef,
    record.liveBindingAttachGrantRef,
    record.grantValidationRef,
    record.currentFrameRef,
    record.currentRunPointerRef,
    record.inputLeaseRef,
    record.actionAdapterRef,
    record.adapterReadinessRef,
    record.evidenceLedgerRef,
    ...(record.permissionRefs ?? []),
    binding.providerSession?.providerSessionOwnerRef,
    binding.providerSession?.surfaceIdentityRef,
  ]);
}

function commandEvidenceRefs(command: VirtualScreenCanvasInputIntentCommand): string[] {
  return runtimeOwnedRefs(Object.values(command.refs).filter((ref): ref is string => typeof ref === 'string'));
}

function inputRuntimeEvidenceRefs(result: VirtualAppScreenInputRuntimeProjection): string[] {
  return runtimeOwnedRefs([
    ...result.evidence.evidenceRefs,
    stringField(result.routeDecision.inputLeaseRef),
    stringField(result.routeDecision.actionAdapterRef),
    stringField(result.routeDecision.adapterReadinessRef),
    stringField(result.routeDecision.currentRunPointerRef),
    stringField(result.routeDecision.evidenceLedgerRef),
    stringField(result.routeDecision.currentFrameRef),
  ]);
}

function blockedResult(
  input: CodexAgentHostComputerUseActMaterializerInput,
  message: string,
  evidenceRefs: string[],
): CodexAgentHostComputerUseActMaterializerResult {
  const safeEvidenceRefs = runtimeOwnedRefs([
    ...evidenceRefs,
    ...permissionRefs(input),
    ...(input.runtimeTruth?.refs ?? []),
  ]);
  return {
    status: 'blocked',
    message,
    confidence: 0.7,
    claimType: 'runtime-diagnostic',
    reasoningTrace: 'SciForge failed closed before non-browser Computer Use Act execution because the runtime-owned VirtualAppScreen action path was not fully materialized.',
    evidenceRefs: safeEvidenceRefs.length ? safeEvidenceRefs : ['runtime-truth:act-materializer/virtual-app-screen-blocked'],
    executionUnits: [executionUnit(input, undefined, 'failed-with-reason', 'blocked', undefined, safeEvidenceRefs[0], message)],
    claims: [claim(input, message, safeEvidenceRefs)],
  };
}

function permissionRefs(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
  return runtimeOwnedRefs(input.runtimeTruth?.permissions?.refs ?? []);
}

function executionUnit(
  input: CodexAgentHostComputerUseActMaterializerInput,
  record: VirtualAppScreenNativeHostSessionRecord | undefined,
  status: string,
  actionType: string,
  actionId?: string,
  outputRef?: string,
  failureReason?: string,
): Record<string, unknown> {
  return {
    id: `EU-virtual-app-screen-computer-use-${safeToken(actionId ?? input.attemptId) || 'act'}`,
    tool: TOOL_ID,
    status,
    params: JSON.stringify({
      providerId: NATIVE_HOST_PROVIDER_ID,
      sessionRef: record?.sessionRef,
      screenRef: record?.screenRef,
      actionType,
    }),
    ...(failureReason ? { failureReason } : {}),
    ...(outputRef ? { outputRef } : {}),
    hash: safeToken(actionId ?? input.attemptId) || 'virtual-app-screen-act',
  };
}

function claim(input: CodexAgentHostComputerUseActMaterializerInput, text: string, refs: string[]): Record<string, unknown> {
  return {
    id: `claim-virtual-app-screen-computer-use-${safeToken(input.attemptId) || 'act'}`,
    type: 'runtime-action',
    text,
    confidence: 0.78,
    evidenceLevel: 'runtime',
    supportingRefs: runtimeOwnedRefs(refs),
    opposingRefs: [],
  };
}

function runtimeOwnedRefs(refs: Array<string | undefined>): string[] {
  return [...new Set(refs.filter((ref): ref is string => typeof ref === 'string' && runtimeOwnedRef(ref)))].slice(0, 32);
}

function runtimeOwnedRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > 240) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('gui.')
    || lower.startsWith('gui:')
    || lower.startsWith('ui:')
    || lower.startsWith('fixture:')
    || lower.startsWith('replay:')
    || lower.startsWith('history:')
    || lower.includes('http://')
    || lower.includes('https://')
    || lower.includes('data:image')
    || lower.includes('base64')
    || lower.includes('<html')
    || lower.includes('secret')
    || lower.includes('token')
    || lower.includes('password')
    || lower.includes('api-key')
    || lower.includes('apikey')
    || lower.includes('bearer')
  ) return false;
  if (/^\.sciforge\/vision-runs\/[A-Za-z0-9._/-]+$/u.test(trimmed) && !trimmed.includes('..')) return true;
  return [
    'browser-host-session:',
    'window-action-session:',
    'computer-use:',
    'native-host:',
    'virtual-app-screen:',
    'action-ledger:',
    'evidence:',
    'workEvidence:',
    'runtime-truth:',
    'permission:',
    'cancel:',
    'adapter-registry:',
    'desktop-native:',
    'window:',
  ].some((prefix) => trimmed.startsWith(prefix));
}

function safeToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return undefined;
  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    const alpha = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const digit = code >= 48 && code <= 57;
    if (!alpha && !digit && char !== '.' && char !== '_' && char !== '-') return undefined;
  }
  return trimmed;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
