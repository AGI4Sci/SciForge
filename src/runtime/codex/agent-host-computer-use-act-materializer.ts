import {
  createDefaultBrowserHostComputerUseActMaterializer,
} from './agent-host-browser-computer-use-act-materializer.js';
import {
  createDefaultWindowActionSessionComputerUseActMaterializer,
} from './agent-host-window-action-computer-use-act-materializer.js';
import {
  requiresComputerUseProductCompletionEvidence,
} from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import {
  computerUseModelRouterCapabilityIds,
} from '../../../packages/actions/computer-use/provider-policy.js';
import {
  createComputerUseActLoopMaterializer,
} from './agent-host-computer-use-act-loop.js';
import type {
  CodexAgentHostComputerUseActMaterializer,
  CodexAgentHostComputerUseActMaterializerInput,
  CodexAgentHostComputerUseActMaterializerResult,
} from './agent-host-turn-loop.js';

export function createDefaultComputerUseActMaterializer(options: {
  browser?: Parameters<typeof createDefaultBrowserHostComputerUseActMaterializer>[0];
  windowAction?: Parameters<typeof createDefaultWindowActionSessionComputerUseActMaterializer>[0];
  env?: NodeJS.ProcessEnv;
  maxActLoopSteps?: number;
  hostPortContract?: Partial<Record<ComputerUseActMaterializerHostPortName, string>>;
} = {}): CodexAgentHostComputerUseActMaterializer {
  const browser = createDefaultBrowserHostComputerUseActMaterializer({
    ...options.browser,
    env: options.browser?.env ?? options.env,
  });
  const windowAction = createDefaultWindowActionSessionComputerUseActMaterializer({
    ...options.windowAction,
    env: options.windowAction?.env ?? options.env,
  });

  const hostPortContract = materializerHostPortContract(options.hostPortContract);
  const singleStep: CodexAgentHostComputerUseActMaterializer = async (input) => {
    const normalizedInput = normalizePlannerObjectiveInput(input);
    if (hasBrowserHostSessionRef(normalizedInput)) return browser(normalizedInput);
    if (hasWindowActionSessionRef(normalizedInput)) return windowAction(normalizedInput);
    return blockedTsOnlyResult(normalizedInput, {
      message: 'TS-only Computer Use Act materializer blocked: BrowserHostSession or WindowActionSession runtime-owned product target is missing.',
      evidenceRef: 'runtime-truth:computer-use-act-materializer/ts-product-target-missing',
    });
  };
  const actLoop = createComputerUseActLoopMaterializer({
    baseMaterializer: singleStep,
    maxSteps: options.maxActLoopSteps ?? 4,
    requireUserLevelCompletionTruth: true,
  });

  return async (input) => {
    const normalizedInput = normalizePlannerObjectiveInput(input);
    const shouldRunActLoop = requiresDefaultActLoop(input, normalizedInput);
    if (needsAgentHostApproval(normalizedInput)) {
      return attachDefaultBoundaryArtifacts(needsConfirmationResult(normalizedInput), normalizedInput, hostPortContract);
    }
    const result = shouldRunActLoop ? await actLoop(normalizedInput) : await singleStep(normalizedInput);
    return attachDefaultBoundaryArtifacts(result, normalizedInput, hostPortContract);
  };
}

export type ComputerUseActMaterializerHostPortName =
  | 'capture'
  | 'crop'
  | 'plan'
  | 'locate'
  | 'execute'
  | 'verify'
  | 'writeTrace'
  | 'emitEvent';

type ComputerUseActMaterializerHostPortContract = Record<ComputerUseActMaterializerHostPortName, {
  owner: string;
  route: string;
  refsOnly: boolean;
  directProvider: false;
}>;

function requiresDefaultActLoop(
  input: CodexAgentHostComputerUseActMaterializerInput,
  normalizedInput: CodexAgentHostComputerUseActMaterializerInput = input,
): boolean {
  return requiresComputerUseProductCompletionEvidence({ commandText: input.commandText })
    || requiresComputerUseProductCompletionEvidence({ commandText: normalizedInput.commandText });
}

function normalizePlannerObjectiveInput(
  input: CodexAgentHostComputerUseActMaterializerInput,
): CodexAgentHostComputerUseActMaterializerInput {
  const objective = normalizedLocalGuiObjective(input);
  return objective === input.commandText ? input : { ...input, commandText: objective };
}

function normalizedLocalGuiObjective(input: CodexAgentHostComputerUseActMaterializerInput): string {
  const intentText = input.agentHostInput.intentText?.trim();
  return intentText ? intentText.slice(0, 1_000) : input.commandText;
}

function needsAgentHostApproval(input: CodexAgentHostComputerUseActMaterializerInput): boolean {
  return input.preflight.status === 'needs-confirmation' || input.preflight.risk.decision === 'needs-confirmation';
}

function materializerHostPortContract(
  overrides: Partial<Record<ComputerUseActMaterializerHostPortName, string>> | undefined,
): ComputerUseActMaterializerHostPortContract {
  const runtime = (route: string) => ({
    owner: 'agent-host-runtime',
    route,
    refsOnly: true,
    directProvider: false as const,
  });
  const modelRouter = (route: string) => ({
    owner: 'model-router',
    route,
    refsOnly: true,
    directProvider: false as const,
  });
  const base = {
    capture: runtime('runtime-owned-capture-port'),
    crop: runtime('runtime-owned-crop-port'),
    plan: modelRouter(computerUseModelRouterCapabilityIds.computerUsePlanner),
    locate: modelRouter(computerUseModelRouterCapabilityIds.groundingTranslator),
    execute: runtime('runtime-owned-execute-port'),
    verify: modelRouter(computerUseModelRouterCapabilityIds.verifierTranslator),
    writeTrace: runtime('runtime-owned-write-trace-port'),
    emitEvent: runtime('runtime-owned-event-port'),
  };
  for (const [port, route] of Object.entries(overrides ?? {}) as Array<[ComputerUseActMaterializerHostPortName, string]>) {
    if (route.trim()) base[port] = {
      ...base[port],
      route: safeContractText(route),
    };
  }
  return base;
}

function attachDefaultBoundaryArtifacts(
  result: CodexAgentHostComputerUseActMaterializerResult | undefined,
  input: CodexAgentHostComputerUseActMaterializerInput,
  hostPortContract: ComputerUseActMaterializerHostPortContract,
): CodexAgentHostComputerUseActMaterializerResult | undefined {
  if (!result) return undefined;
  const boundaryRefs = runtimeOwnedRefs([
    `runtime-truth:computer-use-act-materializer/preflight/${safeToken(input.commandId) || 'command'}/${safeToken(input.attemptId) || 'attempt'}`,
    'runtime-truth:computer-use-act-materializer/host-port-contract',
  ]);
  const recoveryArtifacts = result.status === 'blocked' ? [recoveryDiagnosticsArtifact(input, result)] : [];
  const recoveryClaims = result.status === 'blocked' ? [recoveryDiagnosticsClaim(input, result)] : [];
  return {
    ...result,
    evidenceRefs: runtimeOwnedRefs([
      ...result.evidenceRefs,
      ...boundaryRefs,
    ]),
    artifacts: [
      ...(result.artifacts ?? []),
      readyPreflightContractArtifact(input),
      hostPortContractArtifact(hostPortContract),
      ...recoveryArtifacts,
    ],
    claims: [
      ...(result.claims ?? []),
      ...recoveryClaims,
    ],
  };
}

function readyPreflightContractArtifact(input: CodexAgentHostComputerUseActMaterializerInput): Record<string, unknown> {
  return {
    id: `computer-use-preflight-contract-${safeToken(input.attemptId) || 'attempt'}`,
    type: 'computer-use-ready-preflight-contract',
    metadata: {
      source: 'agent-host-guard',
      status: input.preflight.status,
    },
    data: {
      schemaVersion: 'sciforge.computer-use.ready-preflight-contract.v1',
      productSource: 'agent-host-guard',
      actsAfterGuardReadiness: input.preflight.status === 'ready',
      riskDecision: safeContractText(input.preflight.risk.decision),
      riskCategory: safeContractText(input.preflight.risk.category),
      targetRefs: runtimeOwnedRefs(input.preflight.target.refs),
      evidenceRefs: runtimeOwnedRefs(input.preflight.evidenceRefs),
      readiness: readyReadinessContract(input),
    },
  };
}

function hostPortContractArtifact(hostPortContract: ComputerUseActMaterializerHostPortContract): Record<string, unknown> {
  return {
    id: 'computer-use-host-port-contract',
    type: 'computer-use-host-port-contract',
    metadata: {
      source: 'agent-host-runtime',
    },
    data: {
      schemaVersion: 'sciforge.computer-use.host-port-contract.v1',
      contract: hostPortContract,
    },
  };
}

function readyReadinessContract(input: CodexAgentHostComputerUseActMaterializerInput): Record<string, unknown> {
  const readiness = input.runtimeTruth?.readiness ?? input.preflight.readiness ?? {};
  return {
    browserHostSession: readiness.browserHostSession,
    nativeBridge: readiness.nativeBridge,
    nativeSurface: readiness.nativeSurface,
    windowActionSession: readiness.windowActionSession,
    computerUseAdapter: readiness.computerUseAdapter,
  };
}

function needsConfirmationResult(
  input: CodexAgentHostComputerUseActMaterializerInput,
): CodexAgentHostComputerUseActMaterializerResult {
  const confirmation = input.preflight.confirmation;
  const refs = runtimeOwnedRefs([
    ...(confirmation?.evidenceRefs ?? []),
    ...input.preflight.evidenceRefs,
    ...(input.runtimeTruth?.permissions?.refs ?? []),
    ...(input.runtimeTruth?.refs ?? []),
    'runtime-truth:computer-use-act-materializer/agent-host-approval-request',
  ]);
  const requestRef = refs[0] ?? 'runtime-truth:computer-use-act-materializer/agent-host-approval-request';
  const action = safeContractText(confirmation?.action ?? normalizedLocalGuiObjective(input));
  const target = safeContractText(confirmation?.target ?? input.preflight.target.summary);
  const impact = safeContractText(confirmation?.impact ?? input.preflight.risk.reason);
  return {
    status: 'needs-confirmation',
    message: 'Computer Use Act materializer needs Agent Host approval before executing this GUI action.',
    confidence: 0.74,
    claimType: 'agent-host-approval-request',
    reasoningTrace: 'SciForge stopped before Computer Use Act execution because Guard classified the local GUI action as hard-confirm.',
    evidenceRefs: refs.length ? refs : [requestRef],
    executionUnits: [{
      id: `EU-computer-use-approval-${safeToken(input.attemptId) || 'act'}`,
      tool: 'computer-use.agent-host-approval',
      status: 'needs-confirmation',
      outputRef: requestRef,
      hash: safeToken(input.attemptId) || 'computer-use-approval',
    }],
    artifacts: [
      {
        id: `computer-use-approval-request-${safeToken(input.attemptId) || 'act'}`,
        type: 'agent-host-approval-request',
        metadata: {
          source: 'agent-host-guard',
          requestRef,
        },
        data: {
          schemaVersion: 'sciforge.agent-host.approval-request.v1',
          action,
          target,
          impact,
          controls: confirmation?.controls ?? ['Confirm', 'Cancel'],
          evidenceRefs: refs.slice(0, 12),
        },
      },
      {
        id: `computer-use-gui-hard-confirm-${safeToken(input.attemptId) || 'act'}`,
        type: 'gui-hard-confirm-projection',
        metadata: {
          source: 'agent-host-runtime',
          requestRef,
        },
        data: {
          schemaVersion: 'sciforge.gui-hard-confirm-projection.v1',
          action,
          target,
          impact,
          evidenceRefs: refs.slice(0, 12),
        },
      },
    ],
    uiManifest: [{
      id: `ui-computer-use-hard-confirm-${safeToken(input.attemptId) || 'act'}`,
      type: 'gui-hard-confirm-projection',
      component: 'runtime-gui',
      requestRef,
      controls: confirmation?.controls ?? ['Confirm', 'Cancel'],
      evidenceRefs: refs.slice(0, 12),
    }],
    claims: [{
      id: `claim-computer-use-approval-${safeToken(input.attemptId) || 'act'}`,
      type: 'approval-request',
      text: 'Agent Host approval is required before Computer Use execution.',
      confidence: 0.74,
      evidenceLevel: 'runtime',
      supportingRefs: refs.slice(0, 12),
      opposingRefs: [],
    }],
    completionTruth: {
      schemaVersion: 'sciforge.computer-use.completion-truth.v1',
      scope: 'action',
      status: 'needs-confirmation',
      evidenceRefs: refs.slice(0, 12),
      reason: 'Agent Host hard confirmation is required before execution.',
    },
  };
}

function hasBrowserHostSessionRef(input: CodexAgentHostComputerUseActMaterializerInput): boolean {
  return runtimeOwnedRefs(allCandidateRefs(input)).some((ref) => /^browser-host-session:/i.test(ref));
}

function hasWindowActionSessionRef(input: CodexAgentHostComputerUseActMaterializerInput): boolean {
  return runtimeOwnedRefs(allCandidateRefs(input)).some((ref) => /^window-action-session:/i.test(ref));
}

function allCandidateRefs(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
  return [
    ...input.preflight.target.refs,
    ...input.preflight.evidenceRefs,
    ...(input.runtimeTruth?.target?.refs ?? []),
    ...(input.runtimeTruth?.observation?.refs ?? []),
    ...(input.runtimeTruth?.refs ?? []),
    ...input.agentHostInput.refs,
  ];
}

function blockedTsOnlyResult(
  input: CodexAgentHostComputerUseActMaterializerInput,
  reason: {
    message: string;
    evidenceRef: string;
  },
): CodexAgentHostComputerUseActMaterializerResult {
  const evidenceRefs = runtimeOwnedRefs([
    reason.evidenceRef,
    ...(input.runtimeTruth?.permissions?.refs ?? []),
    ...(input.runtimeTruth?.refs ?? []),
  ]);
  const outputRef = evidenceRefs[0] ?? reason.evidenceRef;
  return {
    status: 'blocked',
    message: reason.message,
    confidence: 0.68,
    claimType: 'runtime-diagnostic',
    reasoningTrace: 'SciForge failed closed because the default Computer Use product path is TypeScript-only and no executable TS runtime adapter was available for this target.',
    evidenceRefs: evidenceRefs.length ? evidenceRefs : [reason.evidenceRef],
    executionUnits: [{
      id: `EU-computer-use-ts-only-${safeToken(input.attemptId) || 'act'}`,
      tool: 'computer-use.ts-only-act-materializer',
      status: 'failed-with-reason',
      params: JSON.stringify({
        targetKinds: runtimeTargetKinds(input),
      }),
      failureReason: reason.message,
      outputRef,
      hash: safeToken(input.attemptId) || 'computer-use-ts-only-act',
    }],
    claims: [{
      id: `claim-computer-use-ts-only-${safeToken(input.attemptId) || 'act'}`,
      type: 'diagnostic',
      text: reason.message,
      confidence: 0.68,
      evidenceLevel: 'runtime',
      supportingRefs: evidenceRefs.slice(0, 12),
      opposingRefs: [],
    }],
  };
}

function recoveryDiagnosticsArtifact(
  input: CodexAgentHostComputerUseActMaterializerInput,
  result: CodexAgentHostComputerUseActMaterializerResult,
): Record<string, unknown> {
  const refs = runtimeOwnedRefs([
    ...result.evidenceRefs,
    ...input.preflight.evidenceRefs,
    ...(input.runtimeTruth?.refs ?? []),
  ]).slice(0, 12);
  return {
    id: `computer-use-recovery-diagnostics-${safeToken(input.attemptId) || 'act'}`,
    type: 'computer-use-recovery-diagnostics',
    metadata: {
      source: 'agent-host-runtime',
      status: result.status,
    },
    data: {
      schemaVersion: 'sciforge.computer-use.recovery-diagnostics.v1',
      status: result.status,
      category: safeContractText(result.claimType ?? 'runtime-diagnostic'),
      blockedReason: safeContractText(result.message),
      recovery: recoveryActions(input),
      evidenceRefs: refs,
    },
  };
}

function recoveryDiagnosticsClaim(
  input: CodexAgentHostComputerUseActMaterializerInput,
  result: CodexAgentHostComputerUseActMaterializerResult,
): Record<string, unknown> {
  const refs = runtimeOwnedRefs(result.evidenceRefs).slice(0, 12);
  return {
    id: `claim-computer-use-recovery-${safeToken(input.attemptId) || 'act'}`,
    type: 'recovery-diagnostic',
    text: safeContractText(result.message),
    confidence: Math.min(result.confidence ?? 0.65, 0.72),
    evidenceLevel: 'runtime',
    supportingRefs: refs,
    opposingRefs: [],
  };
}

function recoveryActions(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
  const actions = input.preflight.blockers
    .map((blocker) => safeContractText(blocker.recovery))
    .filter(Boolean);
  return actions.length ? actions.slice(0, 6) : ['Refresh Agent Host runtime truth and retry with runtime-owned target, observation, permission, and cancel refs.'];
}

function runtimeTargetKinds(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
  const refs = allCandidateRefs(input);
  const kinds = new Set<string>();
  if (refs.some((ref) => /^browser-host-session:/i.test(ref))) kinds.add('browser-host-session');
  if (refs.some((ref) => /^window-action-session:/i.test(ref))) kinds.add('window-action-session');
  return [...kinds];
}

function runtimeOwnedRefs(refs: Array<string | undefined>): string[] {
  return [...new Set(refs.filter((ref): ref is string => typeof ref === 'string' && runtimeOwnedRef(ref)))].slice(0, 24);
}

function runtimeOwnedRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > 240) return false;
  if (/^(?:gui(?:\.|:)|ui:|fixture:|replay:|history:)/i.test(trimmed)) return false;
  if (/^computer-use:(?:native-host\/sessions\/|provider-session\/)/i.test(trimmed)) return false;
  if (
    /https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(trimmed)
    || /(^|[:/._-])raw([:/._-]|$)/i.test(trimmed)
    || /provider[-_/]?(?:payload|input|request|response)/i.test(trimmed)
  ) return false;
  if (/^\.sciforge\/vision-runs\/[A-Za-z0-9._/-]+$/u.test(trimmed) && !trimmed.includes('..')) return true;
  return /^(?:runtime-truth:|browser-host-session:|window-action-session:|computer-use:|native-host:|action-ledger:|evidence:|workEvidence:|permission:|cancel:|stop:|lease:|adapter-registry:|desktop-native:|audit:)/i.test(trimmed);
}

function safeContractText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/https?:\/\/\S+/giu, '[ref]').replace(/\s+/gu, ' ').slice(0, 220)
    : '';
}

function safeToken(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80)
    : '';
}
