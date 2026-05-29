import type { WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import type { AgentCliAdapter } from '../codex/agent-cli-adapter.js';
import { normalizeGenericActionRisk, normalizePlatformAction } from './actions.js';
import { captureDisplays } from './capture.js';
import type { HostPortCall } from './package-bridge-stdio.js';
import type { ComputerUseConfig, GenericVisionAction, LoopStep, ScreenshotRef, WindowTargetResolution } from './types.js';
import { resolveWindowTarget } from './window-target.js';
import { appendPlannerStep, nextPlannerActions } from '../vision-sense/computer-use-plan.js';
import { isRecord } from '../gateway-utils.js';

type PackageBridgePlanState = {
  runDir: string;
  targetResolution: WindowTargetResolution;
  screenshotLedger: ScreenshotRef[];
  captureRefsByObservationRef: Map<string, ScreenshotRef[]>;
  actionQueue: GenericVisionAction[];
  activeAction?: GenericVisionAction;
  executedActions: GenericVisionAction[];
  dynamicPlannerEnabled: boolean;
  plannerReportedDone: boolean;
  plannerAcceptanceContract?: Record<string, unknown>;
  latestObservation?: Record<string, unknown>;
  plannerTraceSteps: LoopStep[];
  visionHistorySteps: LoopStep[];
  missingPlannerAfterCaptured: boolean;
};

export async function planPackageBridgePort(
  call: HostPortCall,
  context: {
    workspace: string;
    config: ComputerUseConfig;
    callbacks: WorkspaceRuntimeCallbacks;
    state: PackageBridgePlanState;
    codexPlannerAdapter?: AgentCliAdapter;
  },
) {
  const { workspace, config, state } = context;
  if (!state.actionQueue.length && state.dynamicPlannerEnabled && !state.plannerReportedDone) {
    const requestArg = recordArg(call, 0);
    const plannerAcceptanceContract = recordAt(recordAt(requestArg, 'metadata'), 'plannerAcceptanceContract');
    state.plannerAcceptanceContract = plannerAcceptanceContract;
    const observation = recordArg(call, 1);
    state.latestObservation = observation;
    const observationRefs = state.captureRefsByObservationRef.get(stringAt(observation, 'ref') ?? '') ?? state.screenshotLedger.slice(-Math.max(1, config.captureDisplays.length));
    const stepIndex = state.executedActions.length;
    const plannerStepId = stepIndex === 0
      ? 'step-000-plan'
      : `step-${String(stepIndex).padStart(3, '0')}-replan`;
    const historyLength = state.visionHistorySteps.length;
    const planned = await appendPlannerStep({
      id: plannerStepId,
      task: stringAt(requestArg, 'task') ?? '',
      observation,
      plannerAcceptanceContract,
      screenshotRefs: observationRefs,
      steps: state.visionHistorySteps,
      config,
      workspace,
      codexPlannerAdapter: context.codexPlannerAdapter,
      abortSignal: context.callbacks.signal,
    });
    const newPlannerSteps = state.visionHistorySteps
      .slice(historyLength)
      .filter((step) => step.kind === 'planning');
    state.plannerTraceSteps.push(...newPlannerSteps);
    state.plannerReportedDone = planned.done;
    if (!planned.ok) {
      state.activeAction = undefined;
      return { done: false, reason: planned.reason };
    } else if (planned.done) {
      state.activeAction = undefined;
      return { done: true, reason: planned.reason || 'Codex text planner reported task done.' };
    } else {
      state.actionQueue.push(...nextPlannerActions(planned.actions, config.maxSteps - state.executedActions.length));
    }
  }
  const next = state.actionQueue.shift();
  if (!next) {
    state.activeAction = undefined;
    if (!state.missingPlannerAfterCaptured) {
      state.targetResolution = await resolveWindowTarget(config);
      const refs = await captureDisplays(workspace, state.runDir, 'step-000-after', config, state.targetResolution);
      state.screenshotLedger.push(...refs);
      const primary = refs[0];
      if (primary) state.captureRefsByObservationRef.set(primary.path, refs);
      state.missingPlannerAfterCaptured = true;
    }
    return {
      done: false,
      reason: state.dynamicPlannerEnabled
        ? [
            'Generic Computer Use loop is active, but the Runtime Codex text planner emitted no action.',
            'SciForge must provide a Runtime Codex planner plus Grounder that emits generic visible GUI actions.',
          ].join(' ')
        : [
            'Computer Use test-only fixture action queue is exhausted.',
            'Production planning must use the Runtime Codex TUI text planner host port.',
          ].join(' '),
    };
  }
  state.activeAction = normalizePlatformAction(next, config);
  return genericActionToPackagePlan(state.activeAction);
}

function genericActionToPackagePlan(action: GenericVisionAction): Record<string, unknown> {
  return {
    kind: action.type,
    target: actionTarget(action),
    text: 'text' in action ? action.text : undefined,
    key: 'key' in action ? action.key : undefined,
    keys: 'keys' in action ? action.keys : undefined,
    direction: 'direction' in action ? action.direction : undefined,
    amount: 'amount' in action ? action.amount : undefined,
    appName: 'appName' in action ? action.appName : undefined,
    riskLevel: action.riskLevel,
    requiresConfirmation: action.requiresConfirmation,
    metadata: {
      targetDescription: action.targetDescription,
      targetRegionDescription: action.targetRegionDescription,
      hasHostPlannedCoordinates: hasPlannedCoordinates(action),
      confirmationText: action.confirmationText,
    },
  };
}

function actionTarget(action: GenericVisionAction) {
  if (action.type === 'drag') {
    const description = action.fromTargetDescription ?? action.targetDescription;
    const regionDescription = action.toTargetDescription ?? action.targetRegionDescription;
    if (description || regionDescription) {
      return {
        description: description ?? regionDescription,
        region_description: regionDescription,
      };
    }
  }
  const description = action.targetDescription ?? ('appName' in action ? action.appName : undefined);
  if (!description) return undefined;
  return {
    description,
    region_description: action.targetRegionDescription,
  };
}

function hasPlannedCoordinates(action: GenericVisionAction) {
  return ('x' in action && typeof action.x === 'number')
    || ('fromX' in action && typeof action.fromX === 'number');
}

function recordArg(call: HostPortCall, index: number): Record<string, unknown> {
  const value = call.args?.[index];
  return isRecord(value) ? value : {};
}

function recordAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}
