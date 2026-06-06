import type {
  CodexAgentHostComputerUseActMaterializer,
  CodexAgentHostComputerUseActMaterializerInput,
  CodexAgentHostComputerUseActMaterializerResult,
  CodexAgentHostComputerUseCompletionTruth,
  CodexAgentHostRuntimeTruth,
  NormalizedCodexAgentHostInput,
} from './agent-host-turn-loop.js';
import {
  evaluateComputerUsePreflight,
  type ComputerUsePreflightResult,
  type RuntimeReadinessValue,
} from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import { completionTruthFromPackageBridgeWorkEvidence } from './agent-host-package-bridge-completion-truth.js';

export interface ComputerUseActLoopMaterializerOptions {
  baseMaterializer?: CodexAgentHostComputerUseActMaterializer;
  maxSteps?: number;
  requireUserLevelCompletionTruth?: boolean;
  refreshRuntimeTruth?: (input: ComputerUseActLoopStepInput) => Promise<CodexAgentHostRuntimeTruth | undefined> | CodexAgentHostRuntimeTruth | undefined;
  evaluatePreflight?: (input: ComputerUseActLoopStepInput) => Promise<ComputerUsePreflightResult> | ComputerUsePreflightResult;
}

export interface ComputerUseActLoopStepInput {
  input: CodexAgentHostComputerUseActMaterializerInput;
  runtimeTruth?: CodexAgentHostRuntimeTruth;
  previousRuntimeTruth?: CodexAgentHostRuntimeTruth;
  previousResult?: CodexAgentHostComputerUseActMaterializerResult;
  evidenceRefs?: string[];
  step: number;
  maxSteps: number;
}

export function createComputerUseActLoopMaterializer(
  options: ComputerUseActLoopMaterializerOptions = {},
): CodexAgentHostComputerUseActMaterializer {
  const maxSteps = Math.max(1, Math.min(Math.floor(options.maxSteps ?? 1), 8));
  return async (input) => {
    if (!options.baseMaterializer) {
      return blockedLoopResult(input, 'Computer Use Act loop blocked: base materializer is missing.', [
        'runtime-truth:computer-use-act-loop/base-materializer-missing',
      ]);
    }
    const aggregate = createAggregate(input);
    let previousResult: CodexAgentHostComputerUseActMaterializerResult | undefined;
    let previousRuntimeTruth = input.runtimeTruth;
    for (let step = 1; step <= maxSteps; step += 1) {
      if (!options.refreshRuntimeTruth && !input.refreshRuntimeTruth && step > 1) {
        return blockedLoopResult(input, 'Computer Use Act loop blocked: refreshRuntimeTruth is required before continuing a multi-step Act loop.', [
          ...aggregate.evidenceRefs,
          'runtime-truth:computer-use-act-loop/refresh-missing',
        ]);
      }

      let runtimeTruth: CodexAgentHostRuntimeTruth | undefined;
      try {
        runtimeTruth = await refreshRuntimeTruth(options, input, previousResult, previousRuntimeTruth, step, maxSteps, aggregate.evidenceRefs);
      } catch (error) {
        return blockedLoopResult(input, `Computer Use Act loop blocked: runtime truth refresh failed closed: ${boundedDiagnosticText(error)}`, [
          ...aggregate.evidenceRefs,
          'runtime-truth:computer-use-act-loop/refresh-blocked',
        ]);
      }
      if (!runtimeTruth) {
        return blockedLoopResult(input, 'Computer Use Act loop blocked: runtime truth refresh returned no runtime-owned truth.', [
          ...aggregate.evidenceRefs,
          'runtime-truth:computer-use-act-loop/refresh-blocked',
        ]);
      }
      mergeRefs(aggregate, runtimeTruthRefs(runtimeTruth));
      let preflight: ComputerUsePreflightResult;
      try {
        preflight = options.evaluatePreflight
          ? await options.evaluatePreflight({
            input,
            runtimeTruth,
            previousRuntimeTruth,
            previousResult,
            evidenceRefs: aggregate.evidenceRefs.slice(),
            step,
            maxSteps,
          })
          : defaultEvaluatePreflight(input, runtimeTruth);
      } catch (error) {
        return blockedLoopResult(input, `Computer Use Act loop blocked: preflight evaluation failed closed: ${boundedDiagnosticText(error)}`, [
          ...aggregate.evidenceRefs,
          'runtime-truth:computer-use-act-loop/preflight-blocked',
        ]);
      }
      mergeRefs(aggregate, preflightRefs(preflight));
      const preflightBlocker = preflightBlockerMessage(preflight);
      if (preflightBlocker) {
        return blockedLoopResult(input, preflightBlocker, aggregate.evidenceRefs);
      }
      const runtimeBlocker = runtimeTruthBlocker(runtimeTruth);
      if (runtimeBlocker) {
        return blockedLoopResult(input, runtimeBlocker.message, [
          ...aggregate.evidenceRefs,
          ...runtimeBlocker.refs,
        ]);
      }
      let stepResult: CodexAgentHostComputerUseActMaterializerResult | undefined;
      try {
        stepResult = await options.baseMaterializer({
          ...input,
          runtimeTruth,
          preflight,
          attemptId: `${input.attemptId}-act-loop-step-${step}`,
        });
      } catch (error) {
        return blockedLoopResult(input, `Computer Use Act loop blocked: base materializer failed closed at step ${step}: ${boundedDiagnosticText(error)}`, [
          ...aggregate.evidenceRefs,
          'runtime-truth:computer-use-act-loop/base-blocked',
        ]);
      }
      if (!stepResult) {
        return blockedLoopResult(input, 'Computer Use Act loop blocked: base materializer returned no result.', [
          ...aggregate.evidenceRefs,
          'runtime-truth:computer-use-act-loop/base-result-missing',
        ]);
      }
      previousResult = stepResult;
      previousRuntimeTruth = runtimeTruth;
      mergeRefs(aggregate, [
        ...stepResult.evidenceRefs,
        ...(stepResult.completionTruth?.evidenceRefs ?? []),
        ...workEvidenceRefs(stepResult.workEvidence),
      ]);
      aggregate.executionUnits.push(...safeRecords(stepResult.executionUnits));
      aggregate.artifacts.push(...safeRecords(stepResult.artifacts));
      aggregate.uiManifest.push(...safeRecords(stepResult.uiManifest));
      aggregate.claims.push(...safeRecords(stepResult.claims));
      const candidateCompletionTruth = stepResult.completionTruth
        ?? completionTruthFromPackageBridgeWorkEvidence({
          evidenceRefs: aggregate.evidenceRefs,
          workEvidence: stepResult.workEvidence,
        });
      const completionTruth = acceptedCompletionTruth(candidateCompletionTruth, options);
      if (stepResult.status !== 'completed') {
        return {
          ...stepResult,
          ...(completionTruth ? { completionTruth } : {}),
          evidenceRefs: aggregate.evidenceRefs,
          executionUnits: aggregate.executionUnits,
          artifacts: aggregate.artifacts,
          uiManifest: aggregate.uiManifest,
          claims: aggregate.claims,
        };
      }
      if (completionTruth) {
        return {
          ...stepResult,
          message: stepResult.message || `Computer Use Act loop completed after ${step} step(s).`,
          completionTruth,
          evidenceRefs: aggregate.evidenceRefs,
          executionUnits: aggregate.executionUnits,
          artifacts: aggregate.artifacts,
          uiManifest: aggregate.uiManifest,
          claims: aggregate.claims,
        };
      }
    }
    return blockedLoopResult(input, `Computer Use Act loop blocked: maxSteps budget (${maxSteps}) was exhausted before completion evidence was attached.`, aggregate.evidenceRefs);
  };
}

function acceptedCompletionTruth(
  completionTruth: CodexAgentHostComputerUseCompletionTruth | undefined,
  options: ComputerUseActLoopMaterializerOptions,
): CodexAgentHostComputerUseCompletionTruth | undefined {
  if (!completionTruth) return undefined;
  if (!options.requireUserLevelCompletionTruth) return completionTruth;
  return completionTruth.scope === 'user-task' || completionTruth.scope === 'workflow'
    ? completionTruth
    : undefined;
}

async function refreshRuntimeTruth(
  options: ComputerUseActLoopMaterializerOptions,
  input: CodexAgentHostComputerUseActMaterializerInput,
  previousResult: CodexAgentHostComputerUseActMaterializerResult | undefined,
  previousRuntimeTruth: CodexAgentHostRuntimeTruth | undefined,
  step: number,
  maxSteps: number,
  evidenceRefs: string[],
): Promise<CodexAgentHostRuntimeTruth | undefined> {
  if (options.refreshRuntimeTruth) {
    return options.refreshRuntimeTruth({
      input,
      runtimeTruth: previousRuntimeTruth ?? input.runtimeTruth,
      previousRuntimeTruth,
      previousResult,
      evidenceRefs,
      step,
      maxSteps,
    });
  }
  if (input.refreshRuntimeTruth) {
    return input.refreshRuntimeTruth({ step, previousResult });
  }
  return input.runtimeTruth;
}

function runtimeTruthBlocker(runtimeTruth: CodexAgentHostRuntimeTruth): { message: string; refs: string[] } | undefined {
  const readiness = runtimeTruth.readiness ?? {};
  for (const key of ['browserHostSession', 'nativeBridge', 'nativeSurface', 'windowActionSession', 'computerUseAdapter'] as const) {
    if (readiness[key] !== 'ready') {
      return {
        message: `Computer Use Act loop blocked: ${key} is not runtime-ready.`,
        refs: [`runtime-truth:computer-use-act-loop/readiness/${key}`],
      };
    }
  }
  if (runtimeTruth.target?.bound !== true || !runtimeOwnedRefs(runtimeTruth.target.refs ?? []).length) {
    return {
      message: 'Computer Use Act loop blocked: runtime-owned target binding is missing.',
      refs: runtimeOwnedRefs(runtimeTruth.target?.refs ?? ['runtime-truth:computer-use-act-loop/target-missing']),
    };
  }
  if (runtimeTruth.observation?.fresh !== true || !runtimeOwnedRefs(runtimeTruth.observation.refs ?? []).length) {
    return {
      message: 'Computer Use Act loop blocked: refreshed runtime observation is stale or missing.',
      refs: runtimeOwnedRefs(runtimeTruth.observation?.refs ?? ['runtime-truth:computer-use-act-loop/needs-observation']),
    };
  }
  const permissionRefs = runtimeOwnedRefs(runtimeTruth.permissions?.refs ?? []);
  if (!permissionRefs.length) {
    return {
      message: 'Computer Use Act loop blocked: runtime permission refs are missing.',
      refs: ['runtime-truth:computer-use-act-loop/permission-refs-missing'],
    };
  }
  if (runtimeTruth.permissions?.stopCancelPath !== true) {
    return {
      message: 'Computer Use Act loop blocked: runtime stop/cancel control path is missing.',
      refs: permissionRefs.length ? permissionRefs : ['runtime-truth:computer-use-act-loop/stop-cancel-missing'],
    };
  }
  return undefined;
}

function preflightBlockerMessage(preflight: ComputerUsePreflightResult): string | undefined {
  if (preflight.status !== 'ready') {
    const blockers = preflight.blockers.map((blocker) => blocker.reason).join(', ');
    return `Computer Use Act loop blocked: preflight status is ${preflight.status}${blockers ? ` (${blockers})` : ''}.`;
  }
  if (preflight.risk.decision !== 'auto') return `Computer Use Act loop blocked: preflight risk decision is ${preflight.risk.decision}.`;
  return undefined;
}

function defaultEvaluatePreflight(
  input: CodexAgentHostComputerUseActMaterializerInput,
  runtimeTruth: CodexAgentHostRuntimeTruth,
): ComputerUsePreflightResult {
  return evaluateComputerUsePreflight({
    intent: input.commandText,
    target: targetFromInput(input.agentHostInput, runtimeTruth),
    readiness: readinessFromInput(input.agentHostInput, runtimeTruth),
    observation: observationFromInput(input.agentHostInput, runtimeTruth),
    permissions: permissionsFromInput(input.agentHostInput, runtimeTruth),
    authorizationProfile: input.preflight.authorizationProfile,
  });
}

function blockedLoopResult(
  input: CodexAgentHostComputerUseActMaterializerInput,
  message: string,
  refs: string[],
): CodexAgentHostComputerUseActMaterializerResult {
  return {
    status: 'blocked',
    message,
    confidence: 0.4,
    claimType: 'runtime-diagnostic',
    reasoningTrace: 'Computer Use Act loop failed closed before claiming user workflow completion.',
    evidenceRefs: uniqueStrings(refs.filter(runtimeOwnedLoopEvidenceRef)),
    executionUnits: [{
      id: `EU-computer-use-act-loop-${safeRefPart(input.attemptId)}`,
      tool: 'codex-agent-host-computer-use-act-loop',
      status: 'failed-with-reason',
      failureReason: message,
      outputRef: `runtime-truth:computer-use-act-loop/${safeRefPart(input.commandId)}/${safeRefPart(input.attemptId)}`,
    }],
    claims: [{
      id: `claim-computer-use-act-loop-${safeRefPart(input.attemptId)}`,
      type: 'diagnostic',
      text: message,
      confidence: 0.4,
      evidenceLevel: 'runtime',
      supportingRefs: uniqueStrings(refs.filter(runtimeOwnedLoopEvidenceRef)).slice(0, 12),
      opposingRefs: [],
    }],
  };
}

function createAggregate(input: CodexAgentHostComputerUseActMaterializerInput) {
  return {
    evidenceRefs: uniqueStrings([
      `runtime-truth:computer-use-act-loop/${safeRefPart(input.commandId)}/${safeRefPart(input.attemptId)}`,
      ...runtimeTruthRefs(input.runtimeTruth),
      ...preflightRefs(input.preflight),
    ].filter(runtimeOwnedLoopEvidenceRef)),
    executionUnits: [] as Array<Record<string, unknown>>,
    artifacts: [] as Array<Record<string, unknown>>,
    uiManifest: [] as Array<Record<string, unknown>>,
    claims: [] as Array<Record<string, unknown>>,
  };
}

function preflightRefs(preflight: ComputerUsePreflightResult): string[] {
  return [
    ...preflight.target.refs,
    ...preflight.evidenceRefs,
    ...(preflight.confirmation?.evidenceRefs ?? []),
  ];
}

function mergeRefs(target: { evidenceRefs: string[] }, refs: string[] | undefined): void {
  target.evidenceRefs = uniqueStrings([
    ...target.evidenceRefs,
    ...(refs ?? []).filter(runtimeOwnedLoopEvidenceRef),
  ]);
}

function runtimeTruthRefs(runtimeTruth: CodexAgentHostRuntimeTruth | undefined): string[] {
  if (!runtimeTruth) return [];
  return [
    ...(runtimeTruth.refs ?? []),
    ...(runtimeTruth.target?.refs ?? []),
    ...(runtimeTruth.observation?.refs ?? []),
    ...(runtimeTruth.permissions?.refs ?? []),
    ...(runtimeTruth.permissions?.controlPath?.takeoverRefs ?? []),
    ...(runtimeTruth.permissions?.controlPath?.pauseRefs ?? []),
    ...(runtimeTruth.permissions?.controlPath?.resumeRefs ?? []),
    ...(runtimeTruth.permissions?.controlPath?.stopRefs ?? []),
    ...(runtimeTruth.permissions?.controlPath?.cancelRefs ?? []),
  ];
}

function workEvidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [
      ...stringList(item.evidenceRefs),
      ...stringList(item.refs),
      stringField(item.ref),
      stringField(item.outputRef),
    ].filter((ref): ref is string => Boolean(ref));
  });
}

function readinessFromInput(
  input: NormalizedCodexAgentHostInput,
  runtimeTruth?: CodexAgentHostRuntimeTruth,
): Record<'browserHostSession' | 'nativeBridge' | 'nativeSurface' | 'windowActionSession' | 'computerUseAdapter', RuntimeReadinessValue> {
  const readiness = isRecord(input.readiness.readiness) ? input.readiness.readiness : input.readiness;
  const truthReadiness = runtimeTruth?.readiness ?? {};
  return {
    browserHostSession: readinessValue(truthReadiness.browserHostSession, readinessValue(readiness.browserHostSession)),
    nativeBridge: readinessValue(truthReadiness.nativeBridge, readinessValue(readiness.nativeBridge)),
    nativeSurface: readinessValue(truthReadiness.nativeSurface, readinessValue(readiness.nativeSurface)),
    windowActionSession: readinessValue(truthReadiness.windowActionSession, readinessValue(readiness.windowActionSession)),
    computerUseAdapter: readinessValue(truthReadiness.computerUseAdapter, readinessValue(readiness.computerUseAdapter)),
  };
}

function targetFromInput(input: NormalizedCodexAgentHostInput, runtimeTruth?: CodexAgentHostRuntimeTruth) {
  if (runtimeTruth?.target) {
    const refs = stringList(runtimeTruth.target.refs);
    return {
      bound: runtimeTruth.target.bound === true || (runtimeTruth.target.bound !== false && refs.length > 0),
      summary: runtimeTruth.target.summary ?? 'Unbound target',
      refs,
    };
  }
  const refs = [
    ...stringList(input.target.refs),
    ...stringList(input.target.evidenceRefs),
    ...stringList(input.target.targetRefs),
  ];
  return {
    bound: input.target.bound === true || refs.length > 0,
    summary: stringField(input.target.summary) ?? stringField(input.target.title) ?? 'Unbound target',
    refs,
  };
}

function observationFromInput(input: NormalizedCodexAgentHostInput, runtimeTruth?: CodexAgentHostRuntimeTruth) {
  if (runtimeTruth?.observation) {
    return {
      fresh: runtimeTruth.observation.fresh === true,
      refs: stringList(runtimeTruth.observation.refs),
    };
  }
  const refs = [
    ...stringList(input.observation.refs),
    ...stringList(input.observation.evidenceRefs),
    ...stringList(input.observation.screenshotRefs),
  ];
  return {
    fresh: input.observation.fresh === true || input.observation.status === 'fresh',
    refs,
  };
}

function permissionsFromInput(input: NormalizedCodexAgentHostInput, runtimeTruth?: CodexAgentHostRuntimeTruth) {
  if (runtimeTruth?.permissions) {
    return {
      refs: stringList(runtimeTruth.permissions.refs),
      stopCancelPath: runtimeTruth.permissions.stopCancelPath === true,
    };
  }
  return {
    refs: [
      ...stringList(input.permissions.refs),
      ...stringList(input.permissions.permissionRefs),
      ...stringList(input.permissions.evidenceRefs),
    ],
    stopCancelPath: input.permissions.stopCancelPath === true || input.permissions.cancelPath === true || input.permissions.takeOverPath === true,
  };
}

function safeRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).filter((record) => !unsafeRecord(record)).slice(0, 32);
}

function unsafeRecord(value: unknown): boolean {
  if (typeof value === 'string') return !runtimeOwnedLoopEvidenceRef(value) && /^(?:gui(?:\.|:)|ui:|fixture:|replay:|history:)|https?:\/\/|base64|secret|token|password|bearer/i.test(value);
  if (Array.isArray(value)) return value.some(unsafeRecord);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, entry]) => /raw|payload|secret|token|password|api[-_]?key/i.test(key) || unsafeRecord(entry));
}

function runtimeOwnedLoopEvidenceRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > 240) return false;
  if (/^(?:gui(?:\.|:)|ui:|fixture:|replay:|history:)/i.test(trimmed)) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(trimmed)) return false;
  if (/^\.sciforge\/vision-runs\/[A-Za-z0-9._/-]+$/u.test(trimmed) && !trimmed.includes('..')) return true;
  return /^(?:runtime-truth:|browser-host-session:|window-action-session:|computer-use:|native-host:|action-ledger:|evidence:|workEvidence:|permission:|cancel:|stop:|lease:|adapter-registry:|desktop-native:|audit:)/i.test(trimmed);
}

function safeRefPart(value: unknown): string {
  const text = typeof value === 'string' && value.trim() ? value.trim() : 'unknown';
  return text.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'unknown';
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function runtimeOwnedRefs(refs: string[]): string[] {
  return refs.filter(runtimeOwnedLoopEvidenceRef);
}

function readinessValue(value: unknown, fallback: RuntimeReadinessValue = 'blocked'): RuntimeReadinessValue {
  if (value === undefined) return fallback;
  return value === true || value === 'ready' ? 'ready' : 'blocked';
}

function boundedDiagnosticText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? '');
  return text.replace(/\s+/g, ' ').slice(0, 240);
}
