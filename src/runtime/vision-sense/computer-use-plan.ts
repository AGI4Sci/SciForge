import { isRecord, toStringList, uniqueStrings } from '../gateway-utils.js';
import {
  normalizePlatformAction,
  parseGenericActions,
  platformActionIssue,
  platformLauncherGuidance,
} from '../computer-use/actions.js';
import { toTraceScreenshotRef } from '../computer-use/capture.js';
import type { AgentCliAdapter } from '../codex/agent-cli-adapter.js';
import {
  runComputerUseCodexTextPlanner,
  runComputerUseDirectChatTextPlannerFallback,
} from '../codex/computer-use-text-planner.js';
import type {
  ComputerUseConfig as VisionSenseConfig,
  GenericVisionAction,
  LoopStep,
  PlannerContractIssue,
  ScreenshotRef,
  TraceWindowTarget,
} from '../computer-use/types.js';
import { extractJsonObjectWithRecovery, platformLabel, sanitizeId } from '../computer-use/utils.js';
import { visionSensePlannerPromptPolicy } from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import { computerUseVisibleArtifactGapReason } from '../../../packages/actions/computer-use/runtime-policy.js';
import {
  actionLedgerCompletionPolicy,
  type ActionLedgerCompletionPolicy,
} from './computer-use-policy-bridge.js';

const TEXT_PLANNER_RAW_SCHEMA = 'sciforge.computer-use.text-planner-result.v1';
const TEXT_PLANNER_RETRY_RAW_SCHEMA = 'sciforge.computer-use.text-planner-retry-result.v1';
const TEXT_PLANNER_TIMEOUT_FALLBACK_RAW_SCHEMA = 'sciforge.computer-use.text-planner-timeout-fallback-result.v1';

type PlannerActionSuccess = {
  ok: true;
  actions: GenericVisionAction[];
  done: boolean;
  reason?: string;
  rawResponse: unknown;
};

type PlannerActionFailure = {
  ok: false;
  actions: [];
  done: false;
  reason: string;
  rawResponse?: unknown;
  retryableContractViolation?: boolean;
  contractIssue?: PlannerContractIssue;
};

type PlannerActionResult = PlannerActionSuccess | PlannerActionFailure;

export async function appendPlannerStep(params: {
  id: string;
  task: string;
  observation?: Record<string, unknown>;
  plannerAcceptanceContract?: Record<string, unknown>;
  screenshotRefs: ScreenshotRef[];
  steps: LoopStep[];
  config: VisionSenseConfig;
  workspace: string;
  codexPlannerAdapter?: AgentCliAdapter;
  abortSignal?: AbortSignal;
}) {
  const plannerStepTimeoutMs = Math.max(
    params.config.planner.timeoutMs + 10_000,
    params.config.planner.timeoutMs * 2 + 5_000,
  );
  const plannerStepTimeoutReason = `Runtime Codex text planner step timed out after ${plannerStepTimeoutMs}ms`;
  let plannerStepTimedOut = false;
  const abort = new AbortController();
  const forwardAbort = () => abort.abort(params.abortSignal?.reason);
  if (params.abortSignal?.aborted) {
    forwardAbort();
  } else {
    params.abortSignal?.addEventListener('abort', forwardAbort, { once: true });
  }
  const directFallbackForPlannerTimeout = async (reason: string, timedOutRawResponse?: unknown): Promise<PlannerActionResult> => {
    const fallback = await planGenericActionsFromDirectChatText({
      task: params.task,
      observation: params.observation,
      plannerAcceptanceContract: params.plannerAcceptanceContract,
      screenshotRefs: params.screenshotRefs,
      config: params.config,
      steps: params.steps,
      workspace: params.workspace,
      abortSignal: params.abortSignal,
      triggerReason: reason,
    });
    if (fallback.ok) return fallback;
    return {
      ok: false,
      actions: [],
      done: false,
      reason: `${reason}; ${fallback.reason}`,
      rawResponse: {
        schemaVersion: TEXT_PLANNER_TIMEOUT_FALLBACK_RAW_SCHEMA,
        timedOutPlanner: timedOutRawResponse,
        fallback: fallback.rawResponse,
      },
    };
  };
  let plannerResult = await withHardTimeout(
    planGenericActionsFromCodexText({
      task: params.task,
      observation: params.observation,
      plannerAcceptanceContract: params.plannerAcceptanceContract,
      screenshotRefs: params.screenshotRefs,
      config: params.config,
      steps: params.steps,
      workspace: params.workspace,
      codexPlannerAdapter: params.codexPlannerAdapter,
      abortSignal: abort.signal,
    }),
    plannerStepTimeoutMs,
    plannerStepTimeoutReason,
    () => {
      plannerStepTimedOut = true;
      abort.abort(new Error(plannerStepTimeoutReason));
    },
  ).catch(async (error) => {
    const reason = error instanceof Error ? error.message : String(error);
    if (isRuntimePlannerStepTimeout(reason) && !params.abortSignal?.aborted) {
      return await directFallbackForPlannerTimeout(reason);
    }
    return {
      ok: false as const,
      actions: [] as [],
      done: false as const,
      reason,
      rawResponse: undefined,
    };
  }).finally(() => {
    params.abortSignal?.removeEventListener('abort', forwardAbort);
  });
  if (plannerStepTimedOut && !params.abortSignal?.aborted && !plannerResult.ok) {
    plannerResult = await directFallbackForPlannerTimeout(plannerStepTimeoutReason, plannerResult.rawResponse);
  }
  const hasActions = plannerResult.ok && plannerResult.actions.length === 1;
  params.steps.push({
    id: params.id,
    kind: 'planning',
    status: plannerResult.ok && (hasActions || plannerResult.done) ? 'done' : 'blocked',
    beforeScreenshotRefs: params.screenshotRefs.map(toTraceScreenshotRef),
    verifier: {
      status: plannerResult.ok ? 'checked' : 'blocked',
      reason: plannerResult.ok
        ? plannerResult.done
          ? plannerResult.reason || 'Runtime Codex text planner reported task done'
          : hasActions
            ? 'Runtime Codex text planner emitted exactly one generic action'
            : 'Runtime Codex text planner emitted no action'
        : plannerResult.reason,
    },
    execution: {
      planner: 'runtime-codex-tui-text-planner',
      status: plannerResult.ok && (hasActions || plannerResult.done) ? 'done' : 'blocked',
      rawResponse: plannerResult.rawResponse,
    },
    failureReason: plannerResult.ok && (hasActions || plannerResult.done) ? undefined : plannerResult.reason || 'Runtime Codex text planner emitted no executable generic action.',
  });
  return plannerResult;
}

async function planGenericActionsFromCodexText(params: {
  task: string;
  observation?: Record<string, unknown>;
  plannerAcceptanceContract?: Record<string, unknown>;
  screenshotRefs: ScreenshotRef[];
  config: VisionSenseConfig;
  steps: LoopStep[];
  workspace: string;
  codexPlannerAdapter?: AgentCliAdapter;
  abortSignal?: AbortSignal;
}): Promise<PlannerActionResult> {
  if (!params.screenshotRefs.length && !params.observation) {
    return { ok: false, actions: [], done: false, reason: 'Runtime Codex text planner could not run because no compact observation was captured.' };
  }
  const observation = compactComputerUsePlannerObservation(params.observation, params.screenshotRefs, params.config);
  const recentActions = plannerRunHistory(params.steps);
  const verifierFeedback = plannerVerifierFeedback(params.steps);
  const firstAttempt = await requestGenericPlannerActions({
    ...params,
    observation,
    recentActions,
    verifierFeedback,
  });
  if (!firstAttempt.ok && firstAttempt.retryableContractViolation) {
    const extraInstruction = plannerRetryInstruction(firstAttempt.contractIssue, params.config);
    const retry = await requestGenericPlannerActions({
      ...params,
      observation,
      recentActions,
      verifierFeedback,
      extraInstruction,
    });
    return retry.ok ? retry : plannerRetryFailureResult(firstAttempt, retry, extraInstruction);
  }
  if (!firstAttempt.ok) return firstAttempt;
  const noEffectGuarded = await guardPlannerNoEffectRepeat({
    task: params.task,
    config: params.config,
    steps: params.steps,
    attempt: firstAttempt,
    observation,
    plannerAcceptanceContract: params.plannerAcceptanceContract,
    recentActions,
    verifierFeedback,
    workspace: params.workspace,
    codexPlannerAdapter: params.codexPlannerAdapter,
    abortSignal: params.abortSignal,
  });
  if (!noEffectGuarded.ok) return noEffectGuarded;
  return guardPlannerRepeatedAppSwitch({
    task: params.task,
    config: params.config,
    steps: params.steps,
    attempt: noEffectGuarded,
    observation,
    plannerAcceptanceContract: params.plannerAcceptanceContract,
    recentActions,
    verifierFeedback,
    workspace: params.workspace,
    codexPlannerAdapter: params.codexPlannerAdapter,
    abortSignal: params.abortSignal,
  });
}

async function planGenericActionsFromDirectChatText(params: {
  task: string;
  observation?: Record<string, unknown>;
  plannerAcceptanceContract?: Record<string, unknown>;
  screenshotRefs: ScreenshotRef[];
  config: VisionSenseConfig;
  steps: LoopStep[];
  workspace: string;
  abortSignal?: AbortSignal;
  triggerReason: string;
}): Promise<PlannerActionResult> {
  if (!params.screenshotRefs.length && !params.observation) {
    return { ok: false, actions: [], done: false, reason: 'Direct chat text planner fallback could not run because no compact observation was captured.' };
  }
  const observation = compactComputerUsePlannerObservation(params.observation, params.screenshotRefs, params.config);
  return await requestGenericPlannerActionsDirectFallback({
    task: params.task,
    observation,
    plannerAcceptanceContract: params.plannerAcceptanceContract,
    recentActions: plannerRunHistory(params.steps),
    verifierFeedback: plannerVerifierFeedback(params.steps),
    steps: params.steps,
    config: params.config,
    workspace: params.workspace,
    abortSignal: params.abortSignal,
    triggerReason: params.triggerReason,
  });
}

function isRuntimePlannerStepTimeout(reason: string) {
  return /^Runtime Codex text planner step timed out after \d+ms$/.test(reason);
}

function plannerRetryFailureResult(
  initial: PlannerActionFailure,
  retry: PlannerActionFailure,
  retryInstruction: string,
): PlannerActionFailure {
  return {
    ok: false,
    actions: [],
    done: false,
    reason: [
      'Runtime Codex text planner retry failed after a contract repair instruction.',
      `Initial failure: ${initial.reason}`,
      `Retry failure: ${retry.reason}`,
    ].join(' '),
    rawResponse: {
      schemaVersion: TEXT_PLANNER_RETRY_RAW_SCHEMA,
      attemptCount: 2,
      initialContractIssue: initial.contractIssue,
      retryContractIssue: retry.contractIssue,
      initial: initial.rawResponse,
      retry: retry.rawResponse,
      retryInstruction: compactPlannerHistoryText(retryInstruction, 1000),
    },
    contractIssue: retry.contractIssue ?? initial.contractIssue,
  };
}

async function guardPlannerNoEffectRepeat(params: {
  task: string;
  config: VisionSenseConfig;
  steps: LoopStep[];
  attempt: PlannerActionSuccess;
  observation: Record<string, unknown>;
  plannerAcceptanceContract?: Record<string, unknown>;
  recentActions: string;
  verifierFeedback: string;
  workspace: string;
  codexPlannerAdapter?: AgentCliAdapter;
  abortSignal?: AbortSignal;
}) {
  const repeated = repeatedNoEffectRoute(params.attempt.actions, params.steps);
  if (!repeated || params.attempt.done) return params.attempt;
  const retry = await requestGenericPlannerActions({
    task: params.task,
    config: params.config,
    observation: params.observation,
    plannerAcceptanceContract: params.plannerAcceptanceContract,
    recentActions: params.recentActions,
    verifierFeedback: params.verifierFeedback,
    steps: params.steps,
    workspace: params.workspace,
    codexPlannerAdapter: params.codexPlannerAdapter,
    abortSignal: params.abortSignal,
    extraInstruction: visionSensePlannerPromptPolicy.buildNoEffectRetryInstruction(repeated),
  });
  if (!retry.ok) return retry;
  const repeatedAgain = repeatedNoEffectRoute(retry.actions, params.steps);
  if (!retry.done && repeatedAgain) {
    return {
      ok: false as const,
      actions: [] as [],
      done: false as const,
      reason: visionSensePlannerPromptPolicy.noEffectRepeatFailureReason(repeatedAgain),
      rawResponse: retry.rawResponse,
    };
  }
  return retry;
}

async function guardPlannerRepeatedAppSwitch(params: {
  task: string;
  config: VisionSenseConfig;
  steps: LoopStep[];
  attempt: PlannerActionSuccess;
  observation: Record<string, unknown>;
  plannerAcceptanceContract?: Record<string, unknown>;
  recentActions: string;
  verifierFeedback: string;
  workspace: string;
  codexPlannerAdapter?: AgentCliAdapter;
  abortSignal?: AbortSignal;
}) {
  const repeated = repeatedOpenAppCycle(params.attempt.actions, params.steps);
  if (!repeated || params.attempt.done) return params.attempt;
  const retry = await requestGenericPlannerActions({
    task: params.task,
    config: params.config,
    observation: params.observation,
    plannerAcceptanceContract: params.plannerAcceptanceContract,
    recentActions: params.recentActions,
    verifierFeedback: params.verifierFeedback,
    steps: params.steps,
    workspace: params.workspace,
    codexPlannerAdapter: params.codexPlannerAdapter,
    abortSignal: params.abortSignal,
    extraInstruction: [
      `Your previous action would repeat an app-switch cycle: ${repeated}.`,
      'Do not emit open_app for an app that is already in the recent open_app cycle.',
      'Use the currently visible app content, create the requested artifact with visible controls, or return a structured failure if no safe visible action is available.',
    ].join(' '),
  });
  if (!retry.ok) return retry;
  const repeatedAgain = repeatedOpenAppCycle(retry.actions, params.steps);
  if (!retry.done && repeatedAgain) {
    return {
      ok: false as const,
      actions: [] as [],
      done: false as const,
      reason: `Runtime Codex text planner repeated an app-switch cycle instead of acting on the visible app content: ${repeatedAgain}.`,
      rawResponse: retry.rawResponse,
    };
  }
  return retry;
}

export async function actionLedgerCompletion(task: string, steps: LoopStep[]): Promise<ActionLedgerCompletionPolicy> {
  return await actionLedgerCompletionPolicy(task, steps) ?? { complete: false };
}

function plannerRunHistory(steps: LoopStep[]) {
  const allExecuted = steps.filter((step) => step.kind === 'gui-execution');
  const allNonWaitExecuted = allExecuted.filter((step) => {
    const action: Record<string, unknown> = isRecord(step.plannedAction) ? step.plannedAction : {};
    return action.type !== 'wait';
  });
  const executed = allExecuted
    .slice(-4)
    .map((step, index) => {
      const action: Record<string, unknown> = isRecord(step.plannedAction) ? step.plannedAction : {};
      const type = typeof action.type === 'string' ? action.type : 'unknown';
      const appName = typeof action.appName === 'string' ? ` appName="${compactPlannerHistoryText(action.appName)}"` : '';
      const text = type === 'type_text' && typeof action.text === 'string' ? ` text="${compactPlannerHistoryText(action.text, 180)}"` : '';
      const target = typeof action.targetDescription === 'string' ? ` target="${compactPlannerHistoryText(action.targetDescription)}"` : '';
      const key = typeof action.key === 'string' ? ` key="${action.key}"` : '';
      const direction = typeof action.direction === 'string' ? ` direction="${action.direction}"` : '';
      const status = typeof step.status === 'string' ? step.status : 'unknown';
      const verifier = isRecord(step.verifier) && typeof step.verifier.status === 'string' ? step.verifier.status : 'unknown';
      const pixelDiff = isRecord(step.verifier?.pixelDiff) ? step.verifier.pixelDiff : undefined;
      const noVisibleEffect = pixelDiff?.possiblyNoEffect === true ? ' no-visible-effect=true' : '';
      const execution = isRecord(step.execution) ? step.execution : {};
      const executionHint = type === 'open_app' && typeof execution.stdout === 'string' && execution.stdout
        ? ` execution="${compactPlannerHistoryText(execution.stdout, 120)}"`
        : '';
      const feedback = compactPlannerHistoryText(verifierFeedbackForRunHistory(step), 180);
      const focus = isRecord(step.visualFocus) && isRecord(step.visualFocus.region)
        ? ' focusRegion=available'
        : '';
      const ribbonTarget = typeof action.targetDescription === 'string' && /ribbon|toolbar|menu bar|菜单栏|功能区|选项卡|tab|button|按钮/i.test(action.targetDescription)
        ? ' target-region=toolbar-or-ribbon'
        : '';
      return `${index + 1}. ${type}${appName}${text}${key}${direction}${target}${ribbonTarget}${focus} -> status=${status}, verifier=${verifier}${noVisibleEffect}${executionHint}${feedback ? `; verifierFeedback=${feedback}` : ''}`;
    });
  if (!executed.length) {
    return [
      'Current run action counts: executed=0 nonWait=0 recentWindow=0.',
      'No GUI actions have executed yet in this run.',
      'Use the compact observation and visible text to choose the first generic action, report done=true, or return a structured failure.',
    ].join('\n');
  }
  return [
    `Current run action counts: executed=${allExecuted.length} nonWait=${allNonWaitExecuted.length} recentWindow=${executed.length}.`,
    'Already executed generic GUI actions in this run:',
    ...executed,
    'Do not repeat the same action sequence unless verifier feedback shows a different route is required.',
    'If open_app for the same app already succeeded and the execution says frontmost, do not emit open_app for that app again; interact with the visible app content or set done=true if the task is complete.',
    'For one-shot recovery/observation tasks, a completed non-wait action with verifier evidence is usually sufficient; return done=true with actions=[] when satisfied.',
  ].join('\n');
}

function plannerVerifierFeedback(steps: LoopStep[]) {
  const feedback = steps
    .filter((step) => step.kind === 'gui-execution')
    .slice(-4)
    .flatMap((step) => {
      const verifier = isRecord(step.verifier) ? step.verifier : {};
      const entries = [
        typeof verifier.reason === 'string' ? verifier.reason : undefined,
        typeof verifier.planningFeedback === 'string' ? verifier.planningFeedback : undefined,
        isRecord(verifier.regionSemantic) && typeof verifier.regionSemantic.summary === 'string' ? verifier.regionSemantic.summary : undefined,
      ];
      return entries.filter((entry): entry is string => Boolean(entry?.trim()));
    })
    .map((entry) => compactPlannerHistoryText(stripCoordinateHints(entry), 220));
  return uniqueStrings(feedback).join('\n');
}

function repeatedNoEffectRoute(actions: GenericVisionAction[], steps: LoopStep[]) {
  const next = actions.find((action) => action.type !== 'wait');
  if (!next) return undefined;
  const lastExecution = [...steps]
    .reverse()
    .find((step) => step.kind === 'gui-execution' && step.status === 'done');
  if (!lastExecution || !isNoVisibleEffectStep(lastExecution) || !isRecord(lastExecution.plannedAction)) return undefined;
  const prior = lastExecution.plannedAction as unknown as GenericVisionAction;
  return sameNoEffectRoute(next, prior)
    ? compactPlannerHistoryText(describeActionRoute(prior), 180)
    : undefined;
}

export function isNoVisibleEffectStep(step: LoopStep) {
  const pixelDiff = isRecord(step.verifier?.pixelDiff) ? step.verifier.pixelDiff : undefined;
  return pixelDiff?.possiblyNoEffect === true;
}

function sameNoEffectRoute(next: GenericVisionAction, prior: GenericVisionAction) {
  const nextIsMouseTarget = next.type === 'click' || next.type === 'double_click';
  const priorIsMouseTarget = prior.type === 'click' || prior.type === 'double_click';
  if (nextIsMouseTarget && priorIsMouseTarget) {
    return targetRouteOverlap(next, prior);
  }
  if (next.type !== prior.type) return false;
  if (next.type === 'scroll' && prior.type === 'scroll') {
    return next.direction === prior.direction && targetRouteOverlap(next, prior);
  }
  if (next.type === 'press_key' && prior.type === 'press_key') return next.key === prior.key;
  if (next.type === 'hotkey' && prior.type === 'hotkey') return next.keys.join('+') === prior.keys.join('+');
  if (next.type === 'open_app' && prior.type === 'open_app') return compactRouteText(next.appName) === compactRouteText(prior.appName);
  if (next.type === 'type_text' && prior.type === 'type_text') return targetRouteOverlap(next, prior);
  return targetRouteOverlap(next, prior);
}

function repeatedOpenAppCycle(actions: GenericVisionAction[], steps: LoopStep[]) {
  const next = actions.find((action) => action.type !== 'wait');
  if (!next || next.type !== 'open_app') return undefined;
  const executedActions = steps
    .filter((step) => step.kind === 'gui-execution' && step.status === 'done')
    .map((step) => isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined)
    .filter((action): action is GenericVisionAction => action !== undefined && action.type !== 'wait');
  if (executedActions.length < 4 || executedActions.some((action) => action.type !== 'open_app')) return undefined;
  const openedApps = executedActions
    .filter((action): action is Extract<GenericVisionAction, { type: 'open_app' }> => action.type === 'open_app')
    .map((action) => compactRouteText(action.appName));
  const nextApp = compactRouteText(next.appName);
  if (!nextApp || !openedApps.includes(nextApp)) return undefined;
  return [...openedApps, nextApp].join(' -> ');
}

function targetRouteOverlap(next: GenericVisionAction, prior: GenericVisionAction) {
  const nextTarget = actionRouteTarget(next);
  const priorTarget = actionRouteTarget(prior);
  if (!nextTarget || !priorTarget) return true;
  if (nextTarget === priorTarget) return true;
  const nextTokens = routeTokens(nextTarget);
  const priorTokens = routeTokens(priorTarget);
  if (!nextTokens.length || !priorTokens.length) return false;
  const shared = nextTokens.filter((token) => priorTokens.includes(token)).length;
  return shared / Math.max(nextTokens.length, priorTokens.length) >= 0.5;
}

export function actionRouteTarget(action: GenericVisionAction) {
  return compactRouteText([
    action.targetDescription,
    action.targetRegionDescription,
    action.type === 'drag' ? action.fromTargetDescription : undefined,
    action.type === 'drag' ? action.toTargetDescription : undefined,
  ].filter(Boolean).join(' '));
}

export function compactRouteText(value: string | undefined) {
  return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function routeTokens(value: string) {
  return value
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !['the', 'and', 'for', 'with', 'main', 'content', 'area', 'visible', 'target', 'window'].includes(token));
}

function describeActionRoute(action: GenericVisionAction) {
  const target = actionRouteTarget(action);
  const detail = action.type === 'scroll'
    ? ` direction=${action.direction}`
    : action.type === 'press_key'
      ? ` key=${action.key}`
      : action.type === 'hotkey'
        ? ` keys=${action.keys.join('+')}`
        : action.type === 'open_app'
          ? ` appName=${action.appName}`
          : '';
  return `${action.type}${detail}${target ? ` target="${target}"` : ''}`;
}

function compactPlannerHistoryText(value: string, maxLength = 120) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3)}...`;
}

function verifierFeedbackForRunHistory(step: LoopStep) {
  const verifier = isRecord(step.verifier) ? step.verifier : {};
  const explicit = typeof verifier.planningFeedback === 'string' ? verifier.planningFeedback.trim() : '';
  if (explicit) return stripCoordinateHints(explicit);
  return '';
}

export function nextPlannerActions(actions: GenericVisionAction[], remainingBudget: number) {
  if (remainingBudget <= 0) return [];
  const first = actions.find((action) => action.type !== 'wait') ?? actions[0];
  return first ? [first] : [];
}

function maxStepsRemaining(config: VisionSenseConfig, steps: LoopStep[] | undefined) {
  const spent = (steps ?? []).filter((step) => step.kind === 'gui-execution').length;
  return Math.max(0, config.maxSteps - spent);
}

type TextPlannerRun = Awaited<ReturnType<typeof runComputerUseCodexTextPlanner>>;
type TextPlannerOkRun = Extract<TextPlannerRun, { ok: true }>;

async function requestGenericPlannerActions(params: {
  task: string;
  observation: Record<string, unknown>;
  plannerAcceptanceContract?: Record<string, unknown>;
  recentActions: string;
  verifierFeedback: string;
  steps?: LoopStep[];
  config: VisionSenseConfig;
  workspace: string;
  codexPlannerAdapter?: AgentCliAdapter;
  abortSignal?: AbortSignal;
  extraInstruction?: string;
}): Promise<PlannerActionResult> {
  const response = await runComputerUseCodexTextPlanner({
    task: params.task,
    observation: params.observation,
    plannerAcceptanceContract: params.plannerAcceptanceContract,
    recentActions: params.recentActions,
    verifierFeedback: params.verifierFeedback,
    desktopPlatform: params.config.desktopPlatform,
    maxStepsRemaining: maxStepsRemaining(params.config, params.steps),
    extraInstruction: params.extraInstruction,
  }, {
    workspace: params.workspace,
    adapter: params.codexPlannerAdapter,
    commandId: `codex-computer-use-plan-${sanitizeId(params.config.runId || 'run')}`,
    profile: params.config.planner.profile,
    abortSignal: params.abortSignal,
    allowOpenAiRuntime: params.config.planner.allowOpenAiRuntime,
  });
  if (!response.ok) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: `Runtime Codex text planner failed: ${response.reason}`,
      rawResponse: response.raw,
    };
  }
  return textPlannerActionResultFromResponse(response, params);
}

async function requestGenericPlannerActionsDirectFallback(params: {
  task: string;
  observation: Record<string, unknown>;
  plannerAcceptanceContract?: Record<string, unknown>;
  recentActions: string;
  verifierFeedback: string;
  steps?: LoopStep[];
  config: VisionSenseConfig;
  workspace: string;
  abortSignal?: AbortSignal;
  triggerReason: string;
}): Promise<PlannerActionResult> {
  const response = await runComputerUseDirectChatTextPlannerFallback({
    task: params.task,
    observation: params.observation,
    plannerAcceptanceContract: params.plannerAcceptanceContract,
    recentActions: params.recentActions,
    verifierFeedback: params.verifierFeedback,
    desktopPlatform: params.config.desktopPlatform,
    maxStepsRemaining: maxStepsRemaining(params.config, params.steps),
    extraInstruction: [
      `Runtime Codex CLI/TUI text planner transport timed out before returning a terminal event: ${params.triggerReason}.`,
      'Use the same strict generic Computer Use JSON action contract.',
    ].join(' '),
  }, {
    workspace: params.workspace,
    commandId: `codex-computer-use-plan-direct-chat-${sanitizeId(params.config.runId || 'run')}`,
    profile: params.config.planner.profile,
    abortSignal: params.abortSignal,
    allowOpenAiRuntime: params.config.planner.allowOpenAiRuntime,
  }, params.triggerReason);
  if (!response.ok) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: `Runtime Codex direct chat text planner fallback failed: ${response.reason}`,
      rawResponse: response.raw,
    };
  }
  return textPlannerActionResultFromResponse(response, params);
}

function textPlannerActionResultFromResponse(
  response: TextPlannerOkRun,
  params: {
    task: string;
    observation: Record<string, unknown>;
    plannerAcceptanceContract?: Record<string, unknown>;
    steps?: LoopStep[];
    config: VisionSenseConfig;
  },
): PlannerActionResult {
  const jsonRecovery = extractJsonObjectWithRecovery(response.text);
  const json = jsonRecovery.value;
  const protocolDrift = plannerProtocolDriftDiagnostics(response, jsonRecovery);
  const rawResponse = {
    schemaVersion: TEXT_PLANNER_RAW_SCHEMA,
    planner: response.raw,
    text: response.text,
    parsed: json,
    protocolDrift,
  };
  if (!isRecord(json)) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: 'Runtime Codex text planner response was not a JSON object.',
      rawResponse,
      retryableContractViolation: true,
      contractIssue: 'empty-message-content',
    };
  }
  const rawActions = Array.isArray(json.actions) ? json.actions : [];
  const done = json.done === true;
  const reason = typeof json.reason === 'string' ? json.reason : undefined;
  const failure = isRecord(json.failure) ? json.failure : undefined;
  if (done && rawActions.length > 0) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: 'Runtime Codex text planner set done=true but also emitted actions. Done responses must use actions=[].',
      rawResponse,
      retryableContractViolation: true,
      contractIssue: 'unsupported-action',
    };
  }
  if (done) {
    const doneEvidenceIssue = plannerDoneEvidenceIssue(params.task, params.observation);
    if (doneEvidenceIssue) {
      return {
        ok: false,
        actions: [],
        done: false,
        reason: doneEvidenceIssue,
        rawResponse,
        retryableContractViolation: true,
        contractIssue: 'completion-evidence-missing',
      };
    }
    const currentRoundEvidenceIssue = plannerDoneCurrentRoundActionEvidenceIssue(params.plannerAcceptanceContract, params.steps, params.config);
    if (currentRoundEvidenceIssue) {
      return {
        ok: false,
        actions: [],
        done: false,
        reason: currentRoundEvidenceIssue.reason,
        rawResponse,
        retryableContractViolation: currentRoundEvidenceIssue.retryable,
        contractIssue: 'current-round-action-missing',
      };
    }
    const visibleArtifactIssue = plannerDoneVisibleArtifactIssue(params.task, params.observation, params.steps, params.config);
    if (visibleArtifactIssue) {
      return {
        ok: false,
        actions: [],
        done: false,
        reason: visibleArtifactIssue.reason,
        rawResponse,
        retryableContractViolation: visibleArtifactIssue.retryable,
        contractIssue: 'visible-artifact-missing',
      };
    }
    const doneQuotaIssue = plannerDoneQuotaIssue(params.plannerAcceptanceContract, params.steps, params.config);
    if (doneQuotaIssue) {
      return {
        ok: false,
        actions: [],
        done: false,
        reason: doneQuotaIssue.reason,
        rawResponse,
        retryableContractViolation: doneQuotaIssue.retryable,
        contractIssue: 'quota-unmet',
      };
    }
    return { ok: true, actions: [], done: true, reason, rawResponse };
  }
  if (failure && rawActions.length === 0) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: structuredPlannerFailureReason(failure, reason),
      rawResponse,
    };
  }
  if (rawActions.length !== 1) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: rawActions.length > 1
        ? 'Runtime Codex text planner emitted more than one action; the contract requires exactly one generic action per planner turn.'
        : 'Runtime Codex text planner emitted no action and did not set done=true or return a structured failure.',
      rawResponse,
      retryableContractViolation: true,
      contractIssue: rawActions.length > 1 ? 'unsupported-action' : 'empty-message-content',
    };
  }
  const coordinateViolation = forbiddenPlannerOutputKey(rawActions[0]);
  if (coordinateViolation) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: `Runtime Codex text planner output forbidden field "${coordinateViolation}", which violates the generic planner contract. Coordinates and selectors must come from Grounder or are forbidden.`,
      rawResponse,
      retryableContractViolation: true,
      contractIssue: 'coordinate-output',
    };
  }
  const actions = parseGenericActions(rawActions).map((action) => normalizePlatformAction(action, params.config));
  if (actions.length !== 1) {
    const fieldIssue = plannerRequiredFieldIssue(rawActions[0]);
    return {
      ok: false,
      actions: [],
      done: false,
      reason: fieldIssue ?? 'Runtime Codex text planner emitted no supported generic action. Use only open_app, click, double_click, drag, type_text, press_key, hotkey, scroll, or wait.',
      rawResponse,
      retryableContractViolation: true,
      contractIssue: 'unsupported-action',
    };
  }
  const platformIssue = platformActionIssue(actions[0], params.config);
  if (platformIssue) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: platformIssue,
      rawResponse,
      retryableContractViolation: true,
      contractIssue: 'platform-incompatible-action',
    };
  }
  const actionContractIssue = parsedPlannerActionContractIssue(actions[0]);
  if (actionContractIssue) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: actionContractIssue,
      rawResponse,
      retryableContractViolation: true,
      contractIssue: 'unsupported-action',
    };
  }
  const ambiguousTargetIssue = plannerAmbiguousTargetDescriptionIssue(actions[0]);
  if (ambiguousTargetIssue) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: ambiguousTargetIssue,
      rawResponse,
      retryableContractViolation: true,
      contractIssue: 'ambiguous-target-description',
    };
  }
  return { ok: true, actions, done: false, reason, rawResponse };
}

export function compactComputerUsePlannerObservation(
  observation: Record<string, unknown> | undefined,
  screenshotRefs: ScreenshotRef[],
  config: VisionSenseConfig,
): Record<string, unknown> {
  const visibleTexts = uniqueStrings([
    ...toStringList(observation?.visibleTexts),
    ...toStringList(observation?.visible_texts),
  ]).slice(0, 40).map((value) => compactPlannerHistoryText(value, 240));
  const metadata = recordAt(observation, 'metadata');
  const artifacts = recordAt(observation, 'artifacts');
  const visibleArtifactRefs = uniqueStrings([
    ...toStringList(artifacts?.visibleArtifactRefs),
    ...toStringList(metadata?.visibleArtifactRefs),
  ]).filter(isPlannerFinalArtifactRef);
  return {
    schemaVersion: 'sciforge.computer-use.compact-observation.v1',
    source: 'host-port-compact-text-observation',
    ref: stringAt(observation, 'ref'),
    summary: compactPlannerHistoryText(stringAt(observation, 'summary') ?? 'No text summary supplied by host capture.', 420),
    visibleTexts,
    desktopPlatform: config.desktopPlatform,
    windowTarget: compactWindowTarget(recordAt(observation, 'windowTarget') ?? refsWindowTarget(screenshotRefs) ?? config.windowTarget),
    screenshotRefs: screenshotRefs.map(compactScreenshotRef),
    capture: {
      screenshotCount: screenshotRefs.length,
      query: stringAt(metadata, 'query'),
    },
    visibleArtifactRefs,
    visibleArtifacts: compactVisibleArtifacts([
      ...unknownRecordList(artifacts?.visibleArtifacts),
      ...unknownRecordList(metadata?.visibleArtifacts),
    ]),
    excludedSources: ['dom', 'accessibility-tree', 'selectors', 'html', 'gui-private-state', 'inline-image-bytes'],
  };
}

function compactVisibleArtifacts(items: Record<string, unknown>[]) {
  return items
    .map((item) => ({
      artifactRef: stringAt(item, 'artifactRef') ?? stringAt(item, 'path') ?? stringAt(item, 'dataRef'),
      status: stringAt(item, 'status'),
      kind: stringAt(item, 'kind'),
      title: stringAt(item, 'title'),
    }))
    .filter((item) => item.artifactRef && isPlannerFinalArtifactRef(item.artifactRef) && isCurrentVisibleArtifactStatus(item.status));
}

function unknownRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function compactScreenshotRef(ref: ScreenshotRef) {
  return {
    id: ref.id,
    path: ref.path,
    displayId: ref.displayId,
    captureScope: ref.captureScope,
    captureProvider: ref.captureProvider,
    width: ref.width,
    height: ref.height,
    sha256: ref.sha256,
    bytes: ref.bytes,
    windowTarget: compactWindowTarget(ref.windowTarget),
  };
}

function refsWindowTarget(refs: ScreenshotRef[]): TraceWindowTarget | undefined {
  return refs.find((ref) => ref.windowTarget)?.windowTarget;
}

function compactWindowTarget(target: unknown) {
  if (!isRecord(target)) return undefined;
  const bounds = isRecord(target.bounds) ? target.bounds : undefined;
  const contentRect = isRecord(target.contentRect) ? target.contentRect : undefined;
  return {
    enabled: target.enabled,
    required: target.required,
    mode: target.mode,
    captureKind: target.captureKind,
    coordinateSpace: target.coordinateSpace,
    inputIsolation: target.inputIsolation,
    appName: target.appName,
    title: target.title,
    bundleId: target.bundleId,
    displayId: target.displayId,
    focused: target.focused,
    minimized: target.minimized,
    occluded: target.occluded,
    boundsSize: bounds ? { width: bounds.width, height: bounds.height } : undefined,
    contentSize: contentRect ? { width: contentRect.width, height: contentRect.height } : undefined,
  };
}

function plannerRetryInstruction(issue: PlannerContractIssue | undefined, config: VisionSenseConfig) {
  if (issue === 'platform-incompatible-action') {
    return [
      'Your previous JSON used an action that cannot be executed on this operating system.',
      `Rewrite for ${plannerEnvironmentDescription(config)} using only supported keys/modifiers and generic visible GUI actions.`,
      'Hotkeys are allowed only for platform-level recovery, launcher, new-window, or window-switch flows supported by this runtime.',
      'Do not use app-specific selection/editing/saving/finding/navigation/browser-tab shortcuts such as Command/Ctrl+A/C/V/X/S/F/L/R/T/W.',
      'Prefer visible controls plus click, double_click, drag, scroll, press_key, open_app, type_text, wait, or a structured failure when no safe generic action is available.',
      platformLauncherGuidance(config.desktopPlatform),
    ].join(' ');
  }
  if (issue === 'empty-message-content') {
    return [
      'Your previous response did not include exactly one action, done=true, or a structured failure.',
      'Return one of the three allowed JSON shapes only.',
      'Do not put the action plan in reasoning_content, analysis text, markdown, code fences, prose, tool calls, function calls, or nested tool arguments.',
      'The final response must be a single top-level JSON object that directly contains done, reason, actions, and optional failure.',
    ].join(' ');
  }
  if (issue === 'unsupported-action') {
    return [
      'Your previous JSON used an unsupported action type or too many actions.',
      'Rewrite using exactly one supported generic action: open_app, click, double_click, drag, type_text, press_key, hotkey, scroll, or wait.',
      'If your previous response contained multiple actions, return only the single next action that has not already appeared in Recent actions.',
      'Example: if Recent actions already contains type_text with the required literal text and navigation still needs confirmation, return only {"type":"press_key","key":"Enter"}.',
      'For open_app, use exactly {"type":"open_app","appName":"Visible App Name"}; do not use targetDescription or target for app launch.',
      'For type_text, use exactly {"type":"type_text","text":"literal text to type"}; do not use targetDescription as the text payload.',
      'For press_key, use exactly {"type":"press_key","key":"Enter"}. For hotkey, use exactly {"type":"hotkey","keys":["command","space"]}. For scroll, include direction.',
      'For click/double_click, include targetDescription. For drag, include fromTargetDescription and toTargetDescription.',
      'If no safe action is possible, return the structured failure JSON shape instead of inventing a fallback action.',
    ].join(' ');
  }
  if (issue === 'ambiguous-target-description') {
    return [
      'Your previous targetDescription mixed the intended target with a nearby non-target control.',
      'Rewrite targetDescription and targetRegionDescription so the target is visually specific and any nearby non-target controls are named only as exclusions.',
      'Do not describe a target as "near" a non-target control or include neighboring controls as positive target-region context; describe the intended visible label/icon/shape and exclude adjacent non-target controls.',
    ].join(' ');
  }
  if (issue === 'completion-evidence-missing') {
    return [
      'Your previous JSON set done=true without compact-observation evidence for the visible completion marker requested by the task.',
      'Return done=true only when the compact observation, visibleTexts, or window title already contains the requested visible marker.',
      'If the page or app may still be loading, return exactly one wait action. If a submitted address bar or dialog still needs confirmation, return exactly one generic action such as press_key Enter.',
    ].join(' ');
  }
  if (issue === 'quota-unmet') {
    return [
      'Your previous JSON set done=true before the current round action quota was met.',
      'The planner acceptance contract acceptanceProgress is a minimum evidence-producing action quota for this current round.',
      'Return exactly one additional safe low-risk generic visible GUI action, or return the structured failure JSON shape if no safe visible action remains.',
      'Do not use high-risk or externalizing controls as quota filler.',
    ].join(' ');
  }
  if (issue === 'current-round-action-missing') {
    return [
      'Your previous JSON set done=true before this round produced any non-wait GUI execution evidence.',
      'Even refs-first summary/report rounds need at least one current-round visible generic action so the trace has executor and verifier evidence.',
      'Return exactly one safe low-risk visible generic action, such as focusing the visible target window, selecting a harmless visible field, pressing Escape to clear transient UI, or typing the visible summary/report text when an editable field is visible.',
      'Return the structured failure JSON shape only if no safe visible action remains.',
    ].join(' ');
  }
  if (issue === 'visible-artifact-missing') {
    return [
      'Your previous JSON set done=true before the task produced a current visible final artifact/report ref.',
      'For final artifact, evidence summary, action mapping, field/control evidence, report, index, or refs-first report tasks, done=true requires a visible artifact ref in the compact observation.',
      'Return exactly one safe generic action that creates or displays the report artifact, such as type_text with the visible summary/report content when an editable field is visible, or open_app/click to a safe editor or file manager target.',
      'Return the structured failure JSON shape only if no safe visible artifact-producing action remains.',
    ].join(' ');
  }
  return 'Your previous JSON violated the planner contract by including coordinates, selectors, or private element identifiers. Rewrite without x/y/fromX/fromY/toX/toY/bbox/bounds/selector/elementId/accessibilityId.';
}

function plannerEnvironmentDescription(config: VisionSenseConfig) {
  return `${platformLabel(config.desktopPlatform)} desktop controlled through TUI Host Computer Use ports`;
}

function structuredPlannerFailureReason(failure: Record<string, unknown>, reason: string | undefined) {
  const code = stringAt(failure, 'code') ?? 'structured-failure';
  const failureReason = stringAt(failure, 'reason') ?? reason ?? 'Runtime Codex text planner returned a structured failure without an executable action.';
  const recoverable = typeof failure.recoverable === 'boolean' ? ` recoverable=${failure.recoverable}` : '';
  return `Runtime Codex text planner structured failure (${code}): ${failureReason}${recoverable}`;
}

function forbiddenPlannerOutputKey(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ['x', 'y', 'fromX', 'fromY', 'toX', 'toY', 'bbox', 'bounds', 'selector', 'elementId', 'accessibilityId']) {
    if (key in value) return key;
  }
  for (const item of Object.values(value)) {
    const nested = forbiddenPlannerOutputKey(item);
    if (nested) return nested;
  }
  return undefined;
}

function plannerRequiredFieldIssue(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const rawType = stringAt(value, 'type') ?? stringAt(value, 'actionType') ?? stringAt(value, 'action_type') ?? stringAt(value, 'action') ?? stringAt(value, 'kind');
  if (!rawType) return undefined;
  const type = normalizePlannerActionType(rawType);
  if ((type === 'click' || type === 'double_click') && !hasAnyString(value, ['targetDescription', 'target_description'])) {
    return `Runtime Codex text planner emitted ${type} without required targetDescription.`;
  }
  if (type === 'drag' && (!hasAnyString(value, ['fromTargetDescription', 'from_target_description']) || !hasAnyString(value, ['toTargetDescription', 'to_target_description']))) {
    return 'Runtime Codex text planner emitted drag without required fromTargetDescription and toTargetDescription.';
  }
  if (type === 'type_text' && !hasAnyString(value, ['text'])) {
    return 'Runtime Codex text planner emitted type_text without required text string.';
  }
  if (type === 'press_key' && !hasAnyString(value, ['key', 'keyName'])) {
    return 'Runtime Codex text planner emitted press_key without required key string.';
  }
  if (type === 'hotkey' && !hasHotkeyKeys(value)) {
    return 'Runtime Codex text planner emitted hotkey without required keys array.';
  }
  if (type === 'scroll' && !hasAnyString(value, ['direction'])) {
    return 'Runtime Codex text planner emitted scroll without required direction.';
  }
  if (type === 'open_app' && !hasAnyString(value, ['appName', 'app_name', 'application', 'applicationName', 'name'])) {
    return 'Runtime Codex text planner emitted open_app without required appName.';
  }
  return undefined;
}

function parsedPlannerActionContractIssue(action: GenericVisionAction): string | undefined {
  if ((action.type === 'click' || action.type === 'double_click') && action.x === undefined && action.y === undefined && !action.targetDescription) {
    return `Runtime Codex text planner emitted ${action.type} without required targetDescription.`;
  }
  if (action.type === 'drag') {
    const hasCoordinates = [action.fromX, action.fromY, action.toX, action.toY].every((item) => item !== undefined);
    const hasTargetRoute = Boolean(action.fromTargetDescription && action.toTargetDescription);
    if (!hasCoordinates && !hasTargetRoute) {
      return 'Runtime Codex text planner emitted drag without required fromTargetDescription and toTargetDescription.';
    }
  }
  return undefined;
}

function plannerAmbiguousTargetDescriptionIssue(action: GenericVisionAction): string | undefined {
  if (action.type !== 'click' && action.type !== 'double_click') return undefined;
  const route = [
    action.targetDescription,
    action.targetRegionDescription,
  ].filter(Boolean).join(' ');
  if (!route) return undefined;
  if (!/(?:save|保存|floppy|disk|软盘)/i.test(route)) return undefined;
  if (!/(?:auto\s*save|autosave|自动保存)/i.test(route)) return undefined;
  if (/(?:\bexclude\b|\bexcluding\b|\bavoid\b|\bavoiding\b|\bnot\b|\bwithout\b|\brather than\b|\binstead of\b|不是|排除|避开|避免|不要|而不是|非)/i.test(route)) {
    return undefined;
  }
  return 'Runtime Codex text planner emitted an ambiguous target that names a nearby non-target control as positive context. Describe the actual target by stable visible anchors and explicitly exclude adjacent non-target controls.';
}

function plannerProtocolDriftDiagnostics(
  response: TextPlannerOkRun,
  recovery: { recovery: string; protocolDrift: boolean },
) {
  const rawEvents = response.raw.events ?? [];
  const toolCallLikeEvents = rawEvents.filter((event) => {
    const text = [
      event.rawEventType,
      event.rawPayloadType,
      event.rawItemType,
      event.rawStatus,
      event.status,
      event.message,
      event.text,
    ].filter(Boolean).join(' ').toLowerCase();
    return /tool[_-]?call|tool[_-]?use|function[_-]?call|function_call/.test(text);
  }).length;
  const textLooksWrapped = recovery.recovery === 'fenced-json' || recovery.recovery === 'embedded-json';
  return {
    protocolDrift: recovery.protocolDrift || toolCallLikeEvents > 0,
    recovery: recovery.recovery,
    textLooksWrapped,
    toolCallLikeEvents,
  };
}

function plannerDoneEvidenceIssue(task: string, observation: Record<string, unknown>): string | undefined {
  const markers = visibleCompletionMarkers(task);
  if (!markers.length) return undefined;
  const evidence = compactVisibleCompletionEvidence(observation);
  const missing = markers.filter((marker) => !evidence.includes(marker.toLowerCase()));
  if (!missing.length) return undefined;
  return `Runtime Codex text planner set done=true without compact-observation evidence for required visible marker "${missing[0]}".`;
}

function plannerDoneCurrentRoundActionEvidenceIssue(
  plannerAcceptanceContract: Record<string, unknown> | undefined,
  steps: LoopStep[] | undefined,
  config: VisionSenseConfig,
): { reason: string; retryable: boolean } | undefined {
  if (!plannerAcceptanceContract) return undefined;
  if (numberAt(plannerAcceptanceContract, 'round') === undefined) return undefined;
  if (stringAt(plannerAcceptanceContract, 'schemaVersion') !== 'sciforge.computer-use.planner-acceptance-contract.v1') return undefined;
  const counts = plannerCurrentRoundActionCounts(steps ?? []);
  if (counts.nonWait > 0) return undefined;
  return {
    reason: 'Runtime Codex text planner set done=true before this round produced any non-wait GUI execution evidence.',
    retryable: maxStepsRemaining(config, steps) > 0,
  };
}

function plannerDoneQuotaIssue(
  plannerAcceptanceContract: Record<string, unknown> | undefined,
  steps: LoopStep[] | undefined,
  config: VisionSenseConfig,
): { reason: string; retryable: boolean } | undefined {
  const progress = recordAt(plannerAcceptanceContract, 'acceptanceProgress');
  const targetActions = numberAt(progress, 'suggestedCurrentRoundActionTarget');
  const targetNonWaitActions = numberAt(progress, 'suggestedCurrentRoundNonWaitActionTarget');
  if (targetActions === undefined && targetNonWaitActions === undefined) return undefined;
  const counts = plannerCurrentRoundActionCounts(steps ?? []);
  const actionShortfall = targetActions === undefined ? 0 : Math.max(0, targetActions - counts.executed);
  const nonWaitShortfall = targetNonWaitActions === undefined ? 0 : Math.max(0, targetNonWaitActions - counts.nonWait);
  if (actionShortfall === 0 && nonWaitShortfall === 0) return undefined;
  const remaining = maxStepsRemaining(config, steps);
  const parts = [
    targetActions !== undefined ? `executed ${counts.executed}/${targetActions}` : undefined,
    targetNonWaitActions !== undefined ? `nonWait ${counts.nonWait}/${targetNonWaitActions}` : undefined,
  ].filter(Boolean).join(', ');
  return {
    reason: `Runtime Codex text planner set done=true before satisfying the current-round action quota (${parts}).`,
    retryable: remaining > 0,
  };
}

function plannerDoneVisibleArtifactIssue(
  task: string,
  observation: Record<string, unknown>,
  steps: LoopStep[] | undefined,
  config: VisionSenseConfig,
): { reason: string; retryable: boolean } | undefined {
  const executedActions = plannerExecutedActions(steps ?? []);
  const reason = computerUseVisibleArtifactGapReason(task, executedActions, { finalAttempt: true });
  if (!reason) return undefined;
  if (plannerObservationHasVisibleArtifact(observation)) return undefined;
  return {
    reason: `Runtime Codex text planner set done=true before producing visible final artifact evidence. ${reason}`,
    retryable: maxStepsRemaining(config, steps) > 0,
  };
}

function plannerObservationHasVisibleArtifact(observation: Record<string, unknown>) {
  return collectVisibleArtifactRefs(observation).some((ref) => isPlannerFinalArtifactRef(ref));
}

function collectVisibleArtifactRefs(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return uniqueStrings([
    ...toStringList(value.finalArtifactRef),
    ...toStringList(value.finalArtifactRefs),
    ...toStringList(value.visibleArtifactRefs),
    ...unknownRecordList(value.visibleArtifacts).flatMap((artifact) => {
      if (!isCurrentVisibleArtifactStatus(stringAt(artifact, 'status'))) return [];
      return [
        stringAt(artifact, 'artifactRef'),
        stringAt(artifact, 'path'),
      ].filter((ref): ref is string => Boolean(ref));
    }),
  ]);
}

function isPlannerFinalArtifactRef(ref: string) {
  const text = ref.trim();
  if (!text) return false;
  if (/\.(?:png|jpe?g|webp|gif|svg)$/i.test(text)) return false;
  if (/\/?(?:vision-trace|host-ports|tool-payload|gui-present|gui-ask-user|approval-request|risk-audit|confirmed-request|blocked-manifest|repair-hint|continuation-request|directory-listing|tui-host-run-task-chain|computer-use-request|gateway-request|request|independent-input-adapter|virtual-remote-session|action-ledger|failure-diagnostics|cu-user-acceptance|cu-l3-independent-input-verifier)\.json$/i.test(text)) return false;
  return /^(?:artifact|file|ref):/i.test(text)
    || text.startsWith('.sciforge/')
    || /\.(?:md|txt|csv|tsv|xlsx|pptx?|pdf|docx?|odt|ods)$/i.test(text);
}

function isCurrentVisibleArtifactStatus(status: string | undefined) {
  return Boolean(status && /(?:visible|saved|present|current|displayed)/i.test(status));
}

function plannerCurrentRoundActionCounts(steps: LoopStep[]) {
  const executed = steps.filter((step) => step.kind === 'gui-execution');
  const nonWait = executed.filter((step) => {
    const action: Record<string, unknown> = isRecord(step.plannedAction) ? step.plannedAction : {};
    return action.type !== 'wait';
  });
  return {
    executed: executed.length,
    nonWait: nonWait.length,
  };
}

function plannerExecutedActions(steps: LoopStep[]): Array<{ type: string; text?: string }> {
  return steps
    .filter((step) => step.kind === 'gui-execution' && isRecord(step.plannedAction))
    .map((step) => {
      const action = step.plannedAction as unknown as Record<string, unknown>;
      return {
        type: typeof action.type === 'string' ? action.type : 'unknown',
        text: typeof action.text === 'string' ? action.text : undefined,
      };
    });
}

function visibleCompletionMarkers(task: string) {
  const segment = completionEvidenceSegment(task);
  if (!segment) return [];
  return uniqueStrings([...segment.matchAll(/"([^"]{4,160})"/g)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => !/^file:\/\//i.test(value) && !/[\\/]{2,}/.test(value))
    .filter((value) => !/\b(?:http|https):\/\//i.test(value))
    .slice(0, 5));
}

function completionEvidenceSegment(task: string) {
  const phrasePatterns = [
    /\bstop\s+only\s+when\b/i,
    /\bstop\s+when\b/i,
    /\buntil\b/i,
    /(?:直到|直至|仅当|只有当|停止时)/i,
  ];
  const matchIndexes = phrasePatterns
    .map((pattern) => pattern.exec(task)?.index ?? -1)
    .filter((index) => index >= 0);
  if (!matchIndexes.length) return undefined;
  const segment = task.slice(Math.min(...matchIndexes));
  if (!/\b(?:visible|see|shown|loaded|title|marker)\b|(?:可见|看到|显示|加载|标题|标志)/i.test(segment)) return undefined;
  return segment;
}

function compactVisibleCompletionEvidence(observation: Record<string, unknown>) {
  const pieces = [
    stringAt(observation, 'summary'),
    ...toStringList(observation.visibleTexts),
    ...windowTargetTitles(observation.windowTarget),
    ...screenshotWindowTargetTitles(observation.screenshotRefs),
  ];
  return pieces.filter(Boolean).join('\n').toLowerCase();
}

function windowTargetTitles(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return typeof value.title === 'string' ? [value.title] : [];
}

function screenshotWindowTargetTitles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => isRecord(item) ? windowTargetTitles(item.windowTarget) : []);
}

function normalizePlannerActionType(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'doubleclick') return 'double_click';
  if (normalized === 'type' || normalized === 'input_text') return 'type_text';
  if (normalized === 'keypress') return 'press_key';
  if (normalized === 'openapp' || normalized === 'launch_app' || normalized === 'launchapp' || normalized === 'open_application') return 'open_app';
  return normalized;
}

function hasAnyString(value: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => typeof value[key] === 'string' && value[key].trim().length > 0);
}

function hasHotkeyKeys(value: Record<string, unknown>) {
  const candidates = [value.keys, value.hotkey, value.shortcut, value.keyCombo, value.key_combo];
  return candidates.some((item) => {
    if (Array.isArray(item)) return item.some((entry) => typeof entry === 'string' && entry.trim());
    return typeof item === 'string' && item.trim();
  });
}

function stripCoordinateHints(value: string) {
  return value
    .replace(/\b(?:local|executor|x|y|fromX|fromY|toX|toY)=\S+/gi, '')
    .replace(/\b\d{1,5}\s*,\s*\d{1,5}\b/g, '[coordinate-redacted]');
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

function numberAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}

export async function withHardTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, onTimeout?: () => void): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // Preserve timeout semantics even if the cancellation hook throws.
      }
      reject(new Error(message));
    }, Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
