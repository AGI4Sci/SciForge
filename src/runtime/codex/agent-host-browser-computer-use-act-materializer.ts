import {
  browserHostActionFromComputerUse,
  BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
  executeBrowserHostComputerUseAction,
  type BrowserHostComputerUseAction,
} from '../browser-host-computer-use.js';
import {
  defaultBrowserHostSessionManager,
  type BrowserHostSessionManager,
  type BrowserHostSessionState,
} from '../browser-host-session.js';
import { parseGenericActions } from '../computer-use/actions.js';
import type { GenericVisionAction } from '../computer-use/types.js';
import {
  runComputerUseCodexTextPlanner,
  type ComputerUseTextPlannerOptions,
} from './computer-use-text-planner.js';
import type {
  CodexAgentHostComputerUseActMaterializer,
  CodexAgentHostComputerUseActMaterializerInput,
  CodexAgentHostComputerUseActMaterializerResult,
} from './agent-host-turn-loop.js';

const TOOL_ID = 'browser-host-session.computer-use-act-materializer';
const ADAPTER_REF = 'adapter-registry:browser-host-session/computer-use';

export type { BrowserHostComputerUseAction };

export type BrowserHostComputerUseActionPlannerResult =
  | {
      status: 'planned';
      message: string;
      actions: BrowserHostComputerUseAction[];
      evidenceRefs?: string[];
    }
  | {
      status: 'done' | 'blocked';
      message: string;
      actions?: BrowserHostComputerUseAction[];
      evidenceRefs?: string[];
    };

export type BrowserHostComputerUseActionPlanner =
  (input: CodexAgentHostComputerUseActMaterializerInput) =>
    Promise<BrowserHostComputerUseActionPlannerResult> | BrowserHostComputerUseActionPlannerResult;

export function createDefaultBrowserHostComputerUseActMaterializer(options: {
  browserHostSessionManager?: BrowserHostSessionManager;
  actionPlanner?: BrowserHostComputerUseActionPlanner;
  textPlannerOptions?: Partial<ComputerUseTextPlannerOptions>;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
} = {}): CodexAgentHostComputerUseActMaterializer {
  const manager = options.browserHostSessionManager ?? defaultBrowserHostSessionManager();
  const planner = options.actionPlanner ?? createRuntimeCodexTextPlannerActionPlanner({
    ...options.textPlannerOptions,
    env: options.env ?? options.textPlannerOptions?.env,
  });
  const now = options.now ?? (() => new Date());
  return async (input) => {
    const notReady = preflightNotReady(input);
    if (notReady) return blockedResult(input, notReady, ['runtime-truth:act-materializer/preflight-not-ready']);
    const sessionId = browserHostSessionIdFromInput(input);
    if (!sessionId) return blockedResult(input, 'Computer Use Act materializer blocked: BrowserHostSession target ref is missing.', ['runtime-truth:act-materializer/browser-host-session-missing']);
    const plan = await planner(input);
    const planRefs = runtimeOwnedRefs(plan.evidenceRefs ?? []);
    if (plan.status === 'blocked') {
      return blockedResult(input, plan.message, ['action-ledger:planner/blocked', ...planRefs, `browser-host-session:${sessionId}`]);
    }
    if (plan.status === 'done') {
      return blockedResult(
        input,
        'Computer Use planner-done is only a local action candidate; runtime action evidence or validated completionTruth is required before completion.',
        [
          'action-ledger:planner/done-local-candidate',
          `action-ledger:browser-host-session/${sessionId}/planner-done-local-candidate`,
          `browser-host-session:${sessionId}`,
          ...planRefs,
        ],
      );
    }
    const actions = plan.status === 'planned' ? plan.actions : [];
    if (actions.length !== 1) {
      return blockedResult(input, 'Computer Use Act materializer blocked: planner must return exactly one next action.', ['action-ledger:planner/action-count-invalid', ...planRefs]);
    }
    const action = actions[0];
    if (!action) return blockedResult(input, 'Computer Use Act materializer blocked: planner returned no executable action.', ['action-ledger:planner/action-missing', ...planRefs]);
    const actionId = safeToken(input.attemptId) || `agent-host-act-${Date.now()}`;
    let plannedHostAction;
    try {
      plannedHostAction = browserHostActionFromComputerUse(action, { actionId });
    } catch (error) {
      return blockedResult(input, `Computer Use Act materializer blocked before host execution: ${safeErrorMessage(error)}`, [
        'action-ledger:planner/grounding-required',
        ...planRefs,
        `browser-host-session:${sessionId}`,
      ]);
    }
    const beforeRefs = browserHostBeforeEvidenceRefs(input);
    if (browserHostActionRequiresEvidenceBoundary(plannedHostAction.action) && beforeRefs.length === 0) {
      return blockedResult(input, 'Computer Use Act materializer blocked before host execution: before evidence is missing for the mutating BrowserHostSession action.', [
        'action-ledger:browser-host-session/missing-before-evidence',
        ...planRefs,
        `browser-host-session:${sessionId}`,
      ]);
    }
    let executed;
    try {
      const executedAt = now().toISOString();
      executed = await executeBrowserHostComputerUseAction(manager, input.workspacePath, sessionId, action, {
        actionId,
        adapterSentAt: executedAt,
        permissionRef: permissionRefs(input)[0],
        cancelRef: cancelRef(input),
        now: executedAt,
      });
    } catch (error) {
      return blockedResult(input, `Computer Use Act materializer blocked during BrowserHostSession execution: ${safeErrorMessage(error)}`, [
        'action-ledger:browser-host-session/execution-blocked',
        ...planRefs,
        `browser-host-session:${sessionId}`,
      ]);
    }
    const actionEvidence = browserHostMaterializedActionEvidenceRefs(input, executed.session, actionId, plannedHostAction.action, planRefs);
    if (browserHostActionRequiresEvidenceBoundary(plannedHostAction.action) && actionEvidence.afterRefs.length === 0) {
      return blockedResult(input, 'Computer Use Act materializer blocked after BrowserHostSession execution: after evidence is missing for the mutating action.', [
        'action-ledger:browser-host-session/missing-after-evidence',
        ...actionEvidence.refs,
      ]);
    }
    const missingCompletionEvidence = browserHostMissingCompletionEvidence(actionEvidence);
    if (browserHostActionRequiresEvidenceBoundary(plannedHostAction.action) && missingCompletionEvidence) {
      return blockedResult(input, `Computer Use Act materializer blocked after BrowserHostSession execution: completion evidence is missing ${missingCompletionEvidence} for the current action.`, [
        'action-ledger:browser-host-session/missing-completion-evidence',
        ...actionEvidence.refs,
      ]);
    }
    const evidenceRefs = actionEvidence.refs;
    return {
      status: 'completed',
      message: `Computer Use action executed through BrowserHostSession: ${action.type}.`,
      confidence: 0.82,
      claimType: 'runtime-action',
      reasoningTrace: 'SciForge executed one low-risk Computer Use action through the runtime-owned BrowserHostSession input adapter after Guard readiness passed.',
      evidenceRefs,
      executionUnits: [executionUnit(input, sessionId, 'done', action.type, actionId, browserHostActionStateRef(sessionId, actionId))],
      artifacts: [{
        id: `browser-host-computer-use-action-${safeToken(actionId) || 'action'}`,
        type: 'computer-use-action-result',
        metadata: {
          source: TOOL_ID,
          providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
          sessionRef: `browser-host-session:${sessionId}`,
        },
        data: {
          schemaVersion: 'sciforge.browser-host-session.computer-use-action-summary.v1',
          inputChannel: 'browser-host-session',
          actionType: action.type,
          sharedSystemInputUsed: false,
          singleInteractiveTruth: true,
          evidence: {
            beforeRefs: actionEvidence.beforeRefs,
            groundingRefs: actionEvidence.groundingRefs,
            executorRefs: actionEvidence.executorRefs,
            afterRefs: actionEvidence.afterRefs,
            verificationRefs: actionEvidence.verificationRefs,
            staleInvalidationRefs: actionEvidence.staleInvalidationRefs,
            ledgerRefs: actionEvidence.ledgerRefs,
          },
          evidenceRefs,
        },
      }],
      claims: [claim(input, `BrowserHostSession executed ${action.type}.`, evidenceRefs)],
    };
  };
}

export function createRuntimeCodexTextPlannerActionPlanner(options: Partial<ComputerUseTextPlannerOptions> = {}): BrowserHostComputerUseActionPlanner {
  return async (input) => {
    const run = await runComputerUseCodexTextPlanner({
      task: input.commandText,
      observation: compactObservation(input),
      recentActions: recentActionSummary(input),
      verifierFeedback: 'No verifier feedback yet for this Agent Host turn.',
      desktopPlatform: process.platform,
      maxStepsRemaining: 1,
    }, {
      workspace: input.workspacePath,
      commandId: `${input.commandId}-planner`,
      attemptId: `${input.attemptId}-planner`,
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

function plannerResultFromText(text: string): BrowserHostComputerUseActionPlannerResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      status: 'blocked',
      message: 'Computer Use planner returned non-JSON output.',
      evidenceRefs: ['action-ledger:planner/non-json-output'],
    };
  }
  if (!isRecord(parsed)) {
    return {
      status: 'blocked',
      message: 'Computer Use planner returned an invalid JSON shape.',
      evidenceRefs: ['action-ledger:planner/invalid-json-shape'],
    };
  }
  const reason = stringField(parsed.reason) ?? 'Computer Use planner result.';
  const actions = parseGenericActions(parsed.actions) as GenericVisionAction[];
  if (parsed.done === true) {
    return {
      status: 'done',
      message: reason,
      actions: [],
      evidenceRefs: ['action-ledger:planner/done'],
    };
  }
  if (isRecord(parsed.failure) || actions.length === 0) {
    return {
      status: 'blocked',
      message: reason,
      actions,
      evidenceRefs: ['action-ledger:planner/no-safe-action'],
    };
  }
  return {
    status: 'planned',
    message: reason,
    actions: actions.slice(0, 1),
    evidenceRefs: ['action-ledger:planner/next-action'],
  };
}

function preflightNotReady(input: CodexAgentHostComputerUseActMaterializerInput): string | undefined {
  if (input.preflight.status !== 'ready') return `Computer Use Act materializer blocked: preflight status is ${input.preflight.status}.`;
  if (input.preflight.risk.decision !== 'auto') return `Computer Use Act materializer blocked: risk decision is ${input.preflight.risk.decision}.`;
  if (input.runtimeTruth?.target?.bound !== true) return 'Computer Use Act materializer blocked: runtime target is not bound.';
  if (input.runtimeTruth?.observation?.fresh !== true) return 'Computer Use Act materializer blocked: runtime observation is stale or not fresh.';
  if (!input.runtimeTruth?.permissions?.refs?.length) return 'Computer Use Act materializer blocked: runtime permission refs are missing.';
  if (input.runtimeTruth.permissions.stopCancelPath !== true) return 'Computer Use Act materializer blocked: runtime stop/cancel path is missing.';
  const readiness = input.runtimeTruth.readiness ?? {};
  for (const key of ['browserHostSession', 'nativeBridge', 'nativeSurface', 'windowActionSession', 'computerUseAdapter'] as const) {
    if (readiness[key] !== 'ready') return `Computer Use Act materializer blocked: ${key} is not runtime-ready.`;
  }
  return undefined;
}

function browserHostSessionIdFromInput(input: CodexAgentHostComputerUseActMaterializerInput): string | undefined {
  return [
    ...input.preflight.target.refs,
    ...(input.runtimeTruth?.target?.refs ?? []),
    ...(input.runtimeTruth?.refs ?? []),
    ...input.agentHostInput.refs,
  ].map(browserHostSessionIdFromRef).find((sessionId): sessionId is string => Boolean(sessionId));
}

function browserHostSessionIdFromRef(ref: string): string | undefined {
  const prefix = 'browser-host-session:';
  if (!ref.startsWith(prefix)) return undefined;
  const rest = ref.slice(prefix.length);
  const slash = rest.indexOf('/');
  return safeToken(slash >= 0 ? rest.slice(0, slash) : rest);
}

function browserHostActionEvidenceRefs(session: BrowserHostSessionState, actionId: string): string[] {
  return runtimeOwnedRefs([
    session.visibleAction?.visibleActionRef,
    session.visibleAction?.actorCursorRef,
    ...(session.actorCursor?.lastAction?.evidenceRefs ?? []),
    ...(session.actorCursor?.evidenceRefs ?? []),
    ...(session.actorCursors ?? []).flatMap((cursor) => [
      ...(cursor.lastAction?.evidenceRefs ?? []),
      ...(cursor.evidenceRefs ?? []),
    ]),
    session.frameRef,
    session.screenshotRef,
    browserHostActionStateRef(session.id, actionId),
  ], 48);
}

function browserHostMaterializedActionEvidenceRefs(
  input: CodexAgentHostComputerUseActMaterializerInput,
  session: BrowserHostSessionState,
  actionId: string,
  hostAction: string,
  planRefs: string[],
): {
  refs: string[];
  beforeRefs: string[];
  groundingRefs: string[];
  executorRefs: string[];
  afterRefs: string[];
  verificationRefs: string[];
  staleInvalidationRefs: string[];
  ledgerRefs: string[];
} {
  const sessionId = safeToken(session.id) || browserHostSessionIdFromInput(input) || 'unknown';
  const beforeRefs = browserHostBeforeEvidenceRefs(input);
  const safePlanRefs = runtimeOwnedRefs(planRefs).slice(0, 8);
  const groundingRefs = runtimeOwnedRefs([
    ...safePlanRefs,
    session.visibleAction?.visibleActionRef,
    session.visibleAction?.actorCursorRef,
    `action-ledger:browser-host-session/${sessionId}/actions/${actionId}/grounding`,
  ]);
  const executorRefs = runtimeOwnedRefs([
    ADAPTER_REF,
    browserHostActionStateRef(sessionId, actionId),
    `action-ledger:browser-host-session/${sessionId}/actions/${actionId}/executor-event`,
  ]);
  const afterRefs = browserHostAfterEvidenceRefs(session);
  const postActionRefs = browserHostCurrentActionRefs(browserHostActionEvidenceRefs(session, actionId), actionId);
  const verificationRefs = browserHostVerificationEvidenceRefs(postActionRefs);
  const staleInvalidationRefs = browserHostFreshnessInvalidationEvidenceRefs(postActionRefs);
  const ledgerRefs = runtimeOwnedRefs([
    `action-ledger:browser-host-session/${sessionId}/actions/${actionId}/completed`,
    `action-ledger:browser-host-session/${sessionId}/actions/${actionId}/${safeToken(hostAction) || 'action'}`,
  ]);
  return {
    refs: runtimeOwnedRefs([
      ...beforeRefs,
      ...groundingRefs,
      ...executorRefs,
      ...afterRefs,
      ...verificationRefs,
      ...staleInvalidationRefs,
      ...ledgerRefs,
      ...permissionRefs(input),
      ...postActionRefs,
    ], 48),
    beforeRefs,
    groundingRefs,
    executorRefs,
    afterRefs,
    verificationRefs,
    staleInvalidationRefs,
    ledgerRefs,
  };
}

function browserHostMissingCompletionEvidence(evidence: {
  verificationRefs: string[];
  staleInvalidationRefs: string[];
}): string | undefined {
  const missing: string[] = [];
  if (evidence.verificationRefs.length === 0) missing.push('verifier refs');
  if (evidence.staleInvalidationRefs.length === 0) missing.push('freshness invalidation refs');
  return missing.length ? missing.join(' and ') : undefined;
}

function browserHostCurrentActionRefs(refs: string[], actionId: string): string[] {
  const safeActionId = safeToken(actionId);
  const safeRefs = runtimeOwnedRefs(refs, 48);
  if (!safeActionId) return safeRefs;
  return safeRefs.filter((ref) => ref.includes(safeActionId));
}

function browserHostVerificationEvidenceRefs(refs: string[]): string[] {
  return runtimeOwnedRefs(refs.filter((ref) => /(?:^|[:/._-])(?:verification|verifier|validation|validator)(?:[:/._-]|$)/i.test(ref)), 8);
}

function browserHostFreshnessInvalidationEvidenceRefs(refs: string[]): string[] {
  return runtimeOwnedRefs(refs.filter((ref) => /(?:^|[:/._-])(?:freshness(?:[-_/](?:check|invalidation|invalidated))?|stale[-_/]invalidation|invalidat(?:e|ed|ion))(?:[:/._-]|$)/i.test(ref)), 8);
}

function browserHostBeforeEvidenceRefs(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
  return runtimeOwnedRefs([
    ...(input.runtimeTruth?.observation?.refs ?? []),
    ...input.preflight.evidenceRefs,
  ]).filter((ref) => !ref.startsWith('permission:')).slice(0, 8);
}

function browserHostAfterEvidenceRefs(session: BrowserHostSessionState): string[] {
  return runtimeOwnedRefs([
    session.frameRef,
    session.screenshotRef,
  ]);
}

function browserHostActionStateRef(sessionId: string, actionId: string): string {
  return `browser-host-session:${safeToken(sessionId) || 'unknown'}/action-state/${safeToken(actionId) || 'action'}`;
}

function browserHostActionRequiresEvidenceBoundary(action: string): boolean {
  return !['state', 'snapshot', 'cursor', 'native-os-ui-proof'].includes(action);
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
    reasoningTrace: 'SciForge failed closed before Computer Use Act execution because the runtime-owned BrowserHostSession action path was not fully materialized.',
    evidenceRefs: safeEvidenceRefs.length ? safeEvidenceRefs : ['runtime-truth:act-materializer/blocked'],
    executionUnits: [executionUnit(input, browserHostSessionIdFromInput(input) ?? 'unknown', 'failed-with-reason', 'blocked', undefined, safeEvidenceRefs[0], message)],
    claims: [claim(input, message, safeEvidenceRefs)],
  };
}

function permissionRefs(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
  return runtimeOwnedRefs(input.runtimeTruth?.permissions?.refs ?? []);
}

function cancelRef(input: CodexAgentHostComputerUseActMaterializerInput): string | undefined {
  return runtimeOwnedRefs([
    ...(input.runtimeTruth?.permissions?.controlPath?.cancelRefs ?? []),
    ...(input.runtimeTruth?.refs ?? []),
  ]).find((ref) => ref.startsWith('cancel:'));
}

function executionUnit(
  input: CodexAgentHostComputerUseActMaterializerInput,
  sessionId: string,
  status: string,
  actionType: string,
  actionId?: string,
  outputRef?: string,
  failureReason?: string,
): Record<string, unknown> {
  return {
    id: `EU-browser-host-computer-use-${safeToken(actionId ?? input.attemptId) || 'act'}`,
    tool: TOOL_ID,
    status,
    params: JSON.stringify({
      providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
      sessionRef: `browser-host-session:${safeToken(sessionId) || 'unknown'}`,
      actionType,
    }),
    ...(failureReason ? { failureReason } : {}),
    ...(outputRef ? { outputRef } : {}),
    hash: safeToken(actionId ?? input.attemptId) || 'browser-host-act',
  };
}

function claim(input: CodexAgentHostComputerUseActMaterializerInput, text: string, refs: string[]): Record<string, unknown> {
  return {
    id: `claim-browser-host-computer-use-${safeToken(input.attemptId) || 'act'}`,
    type: 'runtime-action',
    text,
    confidence: 0.78,
    evidenceLevel: 'runtime',
    supportingRefs: runtimeOwnedRefs(refs),
    opposingRefs: [],
  };
}

function compactObservation(input: CodexAgentHostComputerUseActMaterializerInput): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.agent-host.browser-host-compact-observation.v1',
    target: input.runtimeTruth?.target ?? input.preflight.target,
    observation: input.runtimeTruth?.observation,
    evidenceRefs: runtimeOwnedRefs([
      ...input.preflight.evidenceRefs,
      ...(input.runtimeTruth?.refs ?? []),
    ]).slice(0, 12),
  };
}

function recentActionSummary(input: CodexAgentHostComputerUseActMaterializerInput): string {
  return runtimeOwnedRefs(input.runtimeTruth?.refs ?? [])
    .filter((ref) => ref.startsWith('action-ledger:') || ref.includes('/visible-actions/'))
    .slice(0, 8)
    .join('\n');
}

function runtimeOwnedRefs(refs: Array<string | undefined>, limit = 24): string[] {
  return [...new Set(refs.filter((ref): ref is string => typeof ref === 'string' && runtimeOwnedRef(ref)))].slice(0, limit);
}

function runtimeOwnedRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > 240) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('gui.') ||
    lower.startsWith('gui:') ||
    lower.startsWith('ui:') ||
    lower.startsWith('fixture:') ||
    lower.startsWith('replay:') ||
    lower.includes('http://') ||
    lower.includes('https://') ||
    lower.includes('data:image') ||
    lower.includes('base64') ||
    /(^|[:/._-])raw([:/._-]|$)/.test(lower) ||
    lower.includes('<html') ||
    lower.includes('secret') ||
    lower.includes('token') ||
    lower.includes('password') ||
    lower.includes('api-key') ||
    lower.includes('apikey') ||
    lower.includes('bearer')
  ) {
    return false;
  }
  return [
    'browser-host-session:',
    'window-action-session:',
    'computer-use:',
    'native-host:',
    'action-ledger:',
    'evidence:',
    'workEvidence:',
    'runtime-truth:',
    'permission:',
    'cancel:',
    'adapter-registry:',
    'desktop-native:',
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

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll('\n', ' ').slice(0, 180);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
