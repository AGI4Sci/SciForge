import { parseGenericActions } from '../computer-use/actions.js';
import type { GenericVisionAction } from '../computer-use/types.js';
import {
  dispatchWindowAction,
  routeWindowAction,
  type WindowActionAdapterHandlers,
  type WindowActionDispatchInput,
  type WindowActionObserveBeforeMutateEvidence,
  type WindowActionSession,
} from '../window-action-session.js';
import {
  createDefaultWindowActionSessionStore,
  type WindowActionSessionStore,
} from '../window-action-session-store.js';
import {
  runComputerUseCodexTextPlanner,
  type ComputerUseTextPlannerOptions,
} from './computer-use-text-planner.js';
import {
  createAppiumMac2WindowActionAdapter,
  type AppiumMac2WindowActionClient,
} from './appium-mac2-window-action-adapter.js';
import { createAppiumMac2WebDriverClient } from './appium-mac2-webdriver-client.js';
import { createTextEditSavedArtifactValidator } from './textedit-saved-artifact-validator.js';
import type {
  CodexAgentHostComputerUseActMaterializer,
  CodexAgentHostComputerUseActMaterializerInput,
  CodexAgentHostComputerUseActMaterializerResult,
} from './agent-host-turn-loop.js';

const TOOL_ID = 'window-action-session.computer-use-act-materializer';

export type WindowActionSessionComputerUseActionPlannerResult =
  | {
      status: 'planned';
      message: string;
      nextAction?: GenericVisionAction;
      evidenceRefs?: string[];
    }
  | {
      status: 'done' | 'blocked';
      message: string;
      evidenceRefs?: string[];
    };

export type WindowActionSessionComputerUseActionPlanner =
  (input: CodexAgentHostComputerUseActMaterializerInput) =>
    Promise<WindowActionSessionComputerUseActionPlannerResult> | WindowActionSessionComputerUseActionPlannerResult;

export function createDefaultWindowActionSessionComputerUseActMaterializer(options: {
  windowActionSessionStore?: WindowActionSessionStore;
  adapterHandlers?: WindowActionAdapterHandlers;
  actionPlanner?: WindowActionSessionComputerUseActionPlanner;
  textPlannerOptions?: Partial<ComputerUseTextPlannerOptions>;
  appiumMac2Client?: AppiumMac2WindowActionClient;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
} = {}): CodexAgentHostComputerUseActMaterializer {
  const store = options.windowActionSessionStore ?? createDefaultWindowActionSessionStore();
  const adapterHandlers = windowActionAdapterHandlers(options.env, options.adapterHandlers, options.appiumMac2Client);
  const planner = options.actionPlanner ?? createRuntimeCodexTextPlannerActionPlanner({
    ...options.textPlannerOptions,
    env: options.env ?? options.textPlannerOptions?.env,
  });
  const now = options.now ?? (() => new Date());

  return async (input) => {
    const unsafeReason = unsafeInputReason(input);
    if (unsafeReason) {
      return blockedResult(input, 'WindowActionSession Computer Use Act materializer blocked: unsafe refs are present in runtime input.', [
        'runtime-truth:window-action-session/unsafe-ref-blocked',
      ]);
    }
    const notReady = preflightNotReady(input);
    if (notReady) return blockedResult(input, notReady, ['runtime-truth:window-action-session/preflight-not-ready']);

    const sessionRef = windowActionSessionRefFromInput(input);
    if (!sessionRef) {
      return blockedResult(input, 'WindowActionSession Computer Use Act materializer blocked: WindowActionSession target ref is missing.', [
        'runtime-truth:window-action-session/target-missing',
      ]);
    }
    const entry = store.getActiveByRef(sessionRef);
    if (!entry) {
      return blockedResult(input, 'WindowActionSession Computer Use Act materializer blocked: active WindowActionSession is missing from the runtime store.', [
        'runtime-truth:window-action-session/store-entry-missing',
        sessionRef,
      ]);
    }
    const beforeRefs = beforeEvidenceRefs(input);
    if (beforeRefs.length === 0) {
      return blockedResult(input, 'WindowActionSession Computer Use Act materializer blocked: before evidence is missing for the mutating action.', [
        'action-ledger:window-action-session/missing-before-evidence',
        sessionRef,
      ]);
    }
    if (input.runtimeTruth?.observation?.fresh !== true) {
      return blockedResult(input, 'WindowActionSession Computer Use Act materializer blocked: runtime observation is stale or not fresh.', [
        'action-ledger:window-action-session/stale-observation',
        ...beforeRefs,
        sessionRef,
      ]);
    }

    const plan = await planner(input);
    const planRefs = runtimeOwnedRefs(plan.evidenceRefs ?? []);
    if (plan.status === 'blocked') {
      return blockedResult(input, plan.message, ['action-ledger:window-action-session/planner-blocked', ...planRefs, sessionRef]);
    }
    if (plan.status === 'done') {
      return blockedResult(input, 'WindowActionSession planner-done is only a local candidate; runtime action evidence is required before claiming completion.', [
        'action-ledger:window-action-session/planner-done-local-candidate',
        ...planRefs,
        sessionRef,
      ]);
    }
    const action = plan.status === 'planned' ? plan.nextAction : undefined;
    if (!action) {
      return blockedResult(input, 'WindowActionSession Computer Use Act materializer blocked: planner returned no executable action.', [
        'action-ledger:window-action-session/action-missing',
        ...planRefs,
        sessionRef,
      ]);
    }
    const dispatchTimestamp = now().toISOString();
    const actionId = actionIdFromInput(input);
    const dispatchInput = dispatchInputFromAction(entry.session, action, {
      actionId,
      timestamp: dispatchTimestamp,
      beforeRefs,
      observeBeforeMutate: observeBeforeMutateEvidence(input, entry.session),
      terminalWorkflowSelected: explicitTerminalWorkflowSelected(input),
      appiumMac2Enabled: appiumMac2Enabled(options.env),
    });
    if (!dispatchInput) {
      return blockedResult(input, `WindowActionSession Computer Use Act materializer blocked: action "${action.type}" is not supported by the WindowActionSession adapter.`, [
        'action-ledger:window-action-session/action-unsupported',
        ...planRefs,
        sessionRef,
      ]);
    }
    const selectedRoute = routeWindowAction({
      target: dispatchInput.target,
      action: dispatchInput.action,
      evidenceRefs: dispatchInput.beforeEvidenceRefs,
    });
    const selectedAdapter = selectedRoute.adapter;
    if (selectedAdapter === 'system-input' || selectedRoute.evidence?.sharedSystemInput === true) {
      return blockedResult(input, 'WindowActionSession Computer Use Act materializer blocked: shared system input requires an explicit handoff and cannot satisfy product/default Computer Use action evidence.', [
        'action-ledger:window-action-session/shared-system-input-forbidden',
        ...windowActionEvidenceRefs(selectedRoute.evidenceRefs),
        ...planRefs,
        sessionRef,
      ]);
    }
    if (!adapterHandlers[selectedAdapter]) {
      return blockedResult(input, `WindowActionSession Computer Use Act materializer blocked: adapter handler is missing for ${selectedAdapter}.`, [
        'action-ledger:window-action-session/adapter-handler-missing',
        ...planRefs,
        sessionRef,
      ]);
    }

    const dispatched = await dispatchWindowAction(entry.session, dispatchInput, adapterHandlers, {
      agentId: entry.session.actorCursor?.agentId,
      actorCursorRef: entry.session.actorCursor?.cursorId
        ? `actor-cursor:${safeToken(entry.session.actorCursor.agentId)}/${safeToken(entry.session.actorCursor.cursorId)}`
        : undefined,
      timestamp: dispatchTimestamp,
    });
    const adapterEvidenceRefs = windowActionEvidenceRefs(dispatched.adapterResult.evidenceRefs);
    const afterRefs = windowActionEvidenceRefs(dispatched.adapterResult.afterEvidenceRefs);
    const sessionId = safeToken(entry.session.id) || safeRefPartFromSessionRef(sessionRef);
    const persisted = persistDispatchedSession(store, dispatched.session, {
      sessionRef,
      sessionId,
      actionId,
      timestamp: dispatchTimestamp,
      beforeRefs,
      adapterEvidenceRefs,
      afterRefs,
    });
    if (persisted.status !== 'ready') {
      return blockedResult(input, 'WindowActionSession Computer Use Act materializer blocked: post-dispatch WindowActionSession persistence failed.', [
        'action-ledger:window-action-session/post-dispatch-persistence-blocked',
        ...adapterEvidenceRefs,
        ...planRefs,
        sessionRef,
      ]);
    }
    if (dispatched.adapterResult.status !== 'completed') {
      const observeBlockedReason = observeBeforeMutateBlockedReason(dispatched.adapterResult.evidenceRefs);
      const adapterBlockedReason = dispatched.adapterResult.blockedReason
        ? ` ${dispatched.adapterResult.blockedReason}`
        : observeBlockedReason
          ? ` observe-before-mutate freshness check failed: ${observeBlockedReason}`
          : '';
      return blockedResult(input, `WindowActionSession Computer Use Act materializer blocked during adapter execution: ${dispatched.adapterResult.status ?? 'blocked'}.${adapterBlockedReason}`, [
        'action-ledger:window-action-session/execution-blocked',
        ...windowActionEvidenceRefs(dispatched.adapterResult.evidenceRefs),
        ...observeBeforeMutateBlockedRefs(dispatched.adapterResult.evidenceRefs),
        ...planRefs,
        sessionRef,
      ]);
    }
    if (afterRefs.length === 0) {
      return blockedResult(input, 'WindowActionSession Computer Use Act materializer blocked: after evidence is missing for the mutating action.', [
        'action-ledger:window-action-session/missing-after-evidence',
        ...planRefs,
        sessionRef,
      ]);
    }
    const currentAdapterEvidenceRefs = windowActionCurrentActionRefs(adapterEvidenceRefs, actionId);
    const completionEvidence = windowActionCompletionEvidenceRefs([...currentAdapterEvidenceRefs, ...afterRefs], actionId);
    const missingCompletionEvidence = windowActionMissingCompletionEvidence(completionEvidence);
    if (windowActionRequiresCompletionEvidence(dispatchInput.action) && missingCompletionEvidence) {
      return blockedResult(input, `WindowActionSession Computer Use Act materializer blocked: completion evidence is missing ${missingCompletionEvidence} for the current action.`, [
        'action-ledger:window-action-session/missing-completion-evidence',
        ...currentAdapterEvidenceRefs,
        ...afterRefs,
        ...planRefs,
        sessionRef,
      ]);
    }

    const evidenceRefs = runtimeOwnedRefs([
      ...beforeRefs,
      ...planRefs,
      ...permissionRefs(input),
      `window-action-session:${sessionId}/action-state/${actionId}`,
      `adapter-registry:window-action-session/${dispatched.route.adapter}/computer-use`,
      `action-ledger:window-action-session/${sessionId}/actions/${actionId}/executor-event`,
      ...currentAdapterEvidenceRefs,
      ...afterRefs,
      sessionRef,
    ]);
    return {
      status: 'completed',
      message: `Computer Use action executed through WindowActionSession: ${action.type}.`,
      confidence: 0.8,
      claimType: 'runtime-action',
      reasoningTrace: 'SciForge executed one low-risk Computer Use action through the runtime-owned WindowActionSession adapter after Guard readiness passed.',
      evidenceRefs,
      executionUnits: [executionUnit(input, entry.session, dispatched.route.adapter, action.type, 'done', evidenceRefs[1], actionId)],
      artifacts: [{
        id: `window-action-computer-use-action-${safeToken(actionId) || 'action'}`,
        type: 'computer-use-action-result',
        metadata: {
          source: TOOL_ID,
          sessionRef,
          adapter: dispatched.route.adapter,
        },
        data: {
          schemaVersion: 'sciforge.window-action-session.computer-use-action-summary.v1',
          inputChannel: 'window-action-session',
          actionType: action.type,
          sharedSystemInputUsed: dispatched.route.adapter === 'system-input',
          evidence: {
            beforeRefs,
            groundingRefs: planRefs,
            executorRefs: runtimeOwnedRefs([
              `adapter-registry:window-action-session/${dispatched.route.adapter}/computer-use`,
              `action-ledger:window-action-session/${sessionId}/actions/${actionId}/executor-event`,
            ]),
            afterRefs,
            verificationRefs: completionEvidence.verificationRefs,
            staleInvalidationRefs: completionEvidence.staleInvalidationRefs,
          },
          evidenceRefs,
        },
      }],
      claims: [claim(input, `WindowActionSession executed ${action.type}.`, evidenceRefs, 'runtime-action')],
    };
  };
}

export function createRuntimeCodexTextPlannerActionPlanner(options: Partial<ComputerUseTextPlannerOptions> = {}): WindowActionSessionComputerUseActionPlanner {
  return async (input) => {
    const run = await runComputerUseCodexTextPlanner({
      task: input.commandText,
      observation: {
        schemaVersion: 'sciforge.agent-host.window-action-compact-observation.v1',
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
      commandId: `${input.commandId}-window-action-planner`,
      attemptId: `${input.attemptId}-window-action-planner`,
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

function plannerResultFromText(text: string): WindowActionSessionComputerUseActionPlannerResult {
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
  const actions = parseGenericActions(parsed.actions);
  if (parsed.done === true) {
    return {
      status: 'done',
      message: reason,
      evidenceRefs: ['action-ledger:planner/done'],
    };
  }
  if (isRecord(parsed.failure) || actions.length === 0) {
    return {
      status: 'blocked',
      message: reason,
      evidenceRefs: ['action-ledger:planner/no-safe-action'],
    };
  }
  if (actions.length !== 1) {
    return {
      status: 'blocked',
      message: 'Computer Use planner must return exactly one next action.',
      evidenceRefs: ['action-ledger:planner/action-count-invalid'],
    };
  }
  return {
    status: 'planned',
    message: reason,
    nextAction: actions[0],
    evidenceRefs: ['action-ledger:planner/next-action'],
  };
}

function dispatchInputFromAction(
  session: WindowActionSession,
  action: GenericVisionAction,
  options: {
    actionId: string;
    timestamp: string;
    beforeRefs: string[];
    observeBeforeMutate?: WindowActionObserveBeforeMutateEvidence;
    terminalWorkflowSelected?: boolean;
    appiumMac2Enabled?: boolean;
  },
): WindowActionDispatchInput | undefined {
  const base = {
    actionId: options.actionId,
    target: {
      app: session.app,
      capabilities: defaultCapabilitiesForSession(session, options),
    },
    status: 'running' as const,
    timestamp: options.timestamp,
    beforeEvidenceRefs: options.beforeRefs.map((ref) => ({ kind: evidenceKind(ref), ref })),
    ...(options.observeBeforeMutate ? { observeBeforeMutate: options.observeBeforeMutate } : {}),
  };
  if (action.type === 'click' || action.type === 'double_click') {
    if (typeof action.x !== 'number' || typeof action.y !== 'number') {
      if (!action.targetDescription && !action.targetRegionDescription) return undefined;
      return {
        ...base,
        action: 'click',
        targetDescription: action.targetDescription,
        targetRegionDescription: action.targetRegionDescription,
      };
    }
    return {
      ...base,
      action: 'click',
      point: { x: action.x, y: action.y },
      targetDescription: action.targetDescription,
      targetRegionDescription: action.targetRegionDescription,
    };
  }
  if (action.type === 'scroll') {
    const amount = Math.max(1, Math.round(action.amount ?? 300));
    return {
      ...base,
      action: 'scroll',
      delta: scrollDelta(action.direction, amount),
    };
  }
  if (action.type === 'type_text') {
    return {
      ...base,
      action: 'type',
      text: action.text,
      textLength: action.text.length,
    };
  }
  if (action.type === 'save') {
    return {
      ...base,
      action: 'save',
      targetDescription: action.targetPath,
    };
  }
  if (action.type === 'wait') {
    return {
      ...base,
      action: 'wait',
      durationMs: Math.max(0, Math.round(action.ms ?? 1000)),
    };
  }
  return undefined;
}

function observeBeforeMutateEvidence(
  input: CodexAgentHostComputerUseActMaterializerInput,
  session: WindowActionSession,
): WindowActionObserveBeforeMutateEvidence | undefined {
  return observeBeforeMutateEvidenceFromRecord(input.runtimeTruth?.observation, session)
    ?? observeBeforeMutateEvidenceFromSession(session);
}

function observeBeforeMutateEvidenceFromRecord(
  value: unknown,
  session: WindowActionSession,
): WindowActionObserveBeforeMutateEvidence | undefined {
  if (!isRecord(value)) return undefined;
  const freshness = isRecord(value.freshnessCheck) ? value.freshnessCheck : undefined;
  const observedAt = stringField(value.observedAt)
    ?? stringField(value.capturedAt)
    ?? stringField(freshness?.observedAt);
  const checkedAt = stringField(value.freshnessCheckedAt)
    ?? stringField(freshness?.checkedAt);
  const status = stringField(freshness?.status)
    ?? stringField(value.status)
    ?? (value.fresh === true ? 'current' : value.fresh === false ? 'stale' : undefined);
  const maxAgeMs = numberField(freshness?.maxAgeMs);
  const freshnessCheck = {
    ...(status ? { status } : {}),
    ...(observedAt ? { observedAt } : {}),
    ...(checkedAt ? { checkedAt } : {}),
    ...(stringField(freshness?.expiresAt) ? { expiresAt: stringField(freshness?.expiresAt) } : {}),
    ...(maxAgeMs !== undefined ? { maxAgeMs } : {}),
    ...(stringField(freshness?.reason) ? { reason: stringField(freshness?.reason) } : {}),
    ...(stringField(freshness?.staleBy) ? { staleBy: stringField(freshness?.staleBy) } : {}),
  };
  if (!status && !observedAt && !checkedAt && Object.keys(freshnessCheck).length === 0) return undefined;
  return {
    ...(status ? { status } : {}),
    ...(observedAt ? { observedAt, capturedAt: observedAt } : {}),
    ...(checkedAt ? { freshnessCheckedAt: checkedAt } : {}),
    screenId: session.screenId,
    windowRef: session.windowRef,
    ...(Object.keys(freshnessCheck).length ? { freshnessCheck } : {}),
  };
}

function observeBeforeMutateEvidenceFromSession(
  session: WindowActionSession,
): WindowActionObserveBeforeMutateEvidence | undefined {
  if (session.observation.status !== 'current' || !session.observation.observedAt) return undefined;
  const checkedAt = session.observation.updatedAt;
  return {
    status: 'current',
    observedAt: session.observation.observedAt,
    capturedAt: session.observation.observedAt,
    freshnessCheckedAt: checkedAt,
    screenId: session.screenId,
    windowRef: session.windowRef,
    freshnessCheck: {
      status: 'current',
      observedAt: session.observation.observedAt,
      checkedAt,
      maxAgeMs: 30_000,
    },
  };
}

function persistDispatchedSession(
  store: WindowActionSessionStore,
  session: WindowActionSession,
  options: {
    sessionRef: string;
    sessionId: string;
    actionId: string;
    timestamp: string;
    beforeRefs: string[];
    adapterEvidenceRefs: string[];
    afterRefs: string[];
  },
): ReturnType<WindowActionSessionStore['upsert']> {
  return store.upsert(session, {
    refs: runtimeOwnedRefs([
      `action-ledger:window-action-session/${options.sessionId}/actions/${options.actionId}/store-persisted`,
      ...options.adapterEvidenceRefs,
      ...options.afterRefs,
    ]),
    targetRefs: [options.sessionRef],
    observationRefs: options.afterRefs.length ? options.afterRefs : options.beforeRefs,
    timestamp: options.timestamp,
  });
}

function observeBeforeMutateBlockedRefs(value: unknown): string[] {
  return rawEvidenceRefStrings(value).some((ref) => ref.startsWith('observe-before-mutate:'))
    ? ['action-ledger:window-action-session/stale-observation']
    : [];
}

function observeBeforeMutateBlockedReason(value: unknown): string | undefined {
  const ref = rawEvidenceRefStrings(value).find((item) => item.startsWith('observe-before-mutate:'));
  return ref ? safeToken(ref.split(':').pop()) ?? 'stale-observation' : undefined;
}

function rawEvidenceRefStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (isRecord(item) && typeof item.ref === 'string') return [item.ref];
    return [];
  });
}

function defaultCapabilitiesForSession(
  session: WindowActionSession,
  options: { terminalWorkflowSelected?: boolean; appiumMac2Enabled?: boolean } = {},
): WindowActionDispatchInput['target']['capabilities'] {
  if (session.app.kind === 'browser') {
    return { cdp: true, playwright: true, accessibility: true };
  }
  if (session.app.kind === 'editor') {
    return {
      appNativeCommand: true,
      ...(options.appiumMac2Enabled && isTextEditSession(session) ? { appiumMac2: true } : {}),
      accessibility: true,
    };
  }
  if (session.app.kind === 'terminal') {
    return {
      terminal: true,
      ...(options.terminalWorkflowSelected ? { terminalWorkflow: true } : {}),
    };
  }
  if (session.app.kind === 'file-manager') {
    return { fileManager: true, accessibility: true };
  }
  if (session.app.kind === 'ordinary-app') {
    return { accessibility: true };
  }
  return { systemInput: true };
}

function explicitTerminalWorkflowSelected(input: CodexAgentHostComputerUseActMaterializerInput): boolean {
  const text = [
    input.commandText,
    input.agentHostInput.intentText,
    ...allCandidateRefs(input),
  ].join('\n');
  return /\b(?:explicit\s+terminal\s+workflow|terminal\s+workflow|terminal\/pty|pty\s+workflow|use\s+(?:the\s+)?terminal|in\s+(?:the\s+)?terminal)\b/i.test(text);
}

function appiumMac2Enabled(env: NodeJS.ProcessEnv | undefined): boolean {
  return /^(?:1|true|yes|on|enabled)$/i.test(env?.SCIFORGE_WINDOW_ACTION_APPIUM_MAC2?.trim() ?? '');
}

function windowActionAdapterHandlers(
  env: NodeJS.ProcessEnv | undefined,
  handlers: WindowActionAdapterHandlers | undefined,
  appiumMac2Client: AppiumMac2WindowActionClient | undefined,
): WindowActionAdapterHandlers {
  if (!appiumMac2Enabled(env)) return handlers ?? {};
  const client = appiumMac2Client ?? (appiumMac2ExecutorEnabled(env)
    ? createAppiumMac2WebDriverClient({
        validateSavedArtifact: createTextEditSavedArtifactValidator({
          artifactPath: env?.SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH,
        }),
      })
    : undefined);
  return {
    'appium-mac2': appiumMac2ExecutorEnabled(env) && client
      ? createAppiumMac2WindowActionAdapter({
          serverUrl: appiumMac2ServerUrl(env),
          executorEnabled: true,
          client,
        })
      : createAppiumMac2ReadinessHandler(env),
    ...(handlers ?? {}),
  };
}

function createAppiumMac2ReadinessHandler(env: NodeJS.ProcessEnv | undefined): NonNullable<WindowActionAdapterHandlers['appium-mac2']> {
  return async (context) => {
    const serverUrl = appiumMac2ServerUrl(env);
    const appPart = appiumMac2AppRefPart(context.session);
    if (!serverUrl) {
      return {
        status: 'blocked',
        blockedReason: 'Appium Mac2 adapter blocked: server URL is not configured (SCIFORGE_APPIUM_MAC2_SERVER_URL).',
        evidenceRefs: [
          { kind: 'appium-mac2-readiness', ref: `appium-mac2:${appPart}/readiness/missing-server-url` },
        ],
      };
    }
    return {
      status: 'blocked',
      blockedReason: 'Appium Mac2 adapter blocked: no target-bound Mac2 executor is registered for this WindowActionSession.',
      evidenceRefs: [
        { kind: 'appium-mac2-readiness', ref: `appium-mac2:${appPart}/readiness/executor-unregistered` },
      ],
    };
  };
}

function appiumMac2ServerUrl(env: NodeJS.ProcessEnv | undefined): string | undefined {
  const value = env?.SCIFORGE_APPIUM_MAC2_SERVER_URL?.trim();
  if (!value || value.length > 240) return undefined;
  if (!/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{2,5})?(?:\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]*)?$/i.test(value)) return undefined;
  return value;
}

function appiumMac2ExecutorEnabled(env: NodeJS.ProcessEnv | undefined): boolean {
  return /^(?:1|true|yes|on|enabled)$/i.test(env?.SCIFORGE_APPIUM_MAC2_EXECUTOR?.trim() ?? '');
}

function appiumMac2AppRefPart(session: WindowActionSession): string {
  if (isTextEditSession(session)) return 'textedit';
  return safeToken(session.app.id ?? session.app.name ?? session.id)?.toLowerCase() ?? 'window';
}

function isTextEditSession(session: WindowActionSession): boolean {
  return /(?:^|\.)TextEdit$/i.test(session.app.id ?? '') || /^TextEdit$/i.test(session.app.name ?? '');
}

function preflightNotReady(input: CodexAgentHostComputerUseActMaterializerInput): string | undefined {
  if (input.preflight.status !== 'ready') return `WindowActionSession Computer Use Act materializer blocked: preflight status is ${input.preflight.status}.`;
  if (input.preflight.risk.decision !== 'auto') return `WindowActionSession Computer Use Act materializer blocked: risk decision is ${input.preflight.risk.decision}.`;
  if (!input.runtimeTruth?.permissions?.refs?.length) return 'WindowActionSession Computer Use Act materializer blocked: runtime permission refs are missing.';
  if (input.runtimeTruth.permissions.stopCancelPath !== true) return 'WindowActionSession Computer Use Act materializer blocked: runtime stop/cancel path is missing.';
  if (input.runtimeTruth.target?.bound !== true) return 'WindowActionSession Computer Use Act materializer blocked: runtime target is not bound.';
  const readiness = input.runtimeTruth.readiness ?? {};
  for (const key of ['nativeBridge', 'nativeSurface', 'windowActionSession', 'computerUseAdapter'] as const) {
    if (readiness[key] !== 'ready') return `WindowActionSession Computer Use Act materializer blocked: ${key} is not runtime-ready.`;
  }
  return undefined;
}

function windowActionSessionRefFromInput(input: CodexAgentHostComputerUseActMaterializerInput): string | undefined {
  return allCandidateRefs(input)
    .filter(runtimeOwnedRef)
    .find((ref) => /^window-action-session:/i.test(ref));
}

function beforeEvidenceRefs(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
  return runtimeOwnedRefs([
    ...(input.runtimeTruth?.observation?.refs ?? []),
    ...input.preflight.evidenceRefs,
  ]).filter((ref) => !ref.startsWith('permission:'));
}

function permissionRefs(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
  return runtimeOwnedRefs(input.runtimeTruth?.permissions?.refs ?? []);
}

function windowActionEvidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return runtimeOwnedRefs(value.map((item) => {
    if (typeof item === 'string') return item;
    if (isRecord(item) && typeof item.ref === 'string') return item.ref;
    return undefined;
  }));
}

function actionIdFromInput(input: CodexAgentHostComputerUseActMaterializerInput): string {
  return safeToken(input.attemptId) || `window-action-${Date.now()}`;
}

function windowActionRequiresCompletionEvidence(action: string): boolean {
  return action !== 'wait';
}

function windowActionCompletionEvidenceRefs(refs: string[], actionId: string): {
  verificationRefs: string[];
  staleInvalidationRefs: string[];
} {
  const currentRefs = windowActionCurrentActionRefs(refs, actionId);
  return {
    verificationRefs: runtimeOwnedRefs(currentRefs.filter((ref) => /(?:^|[:/._-])(?:verification|verifier|validation|validator)(?:[:/._-]|$)/i.test(ref))),
    staleInvalidationRefs: runtimeOwnedRefs(currentRefs.filter((ref) => /(?:^|[:/._-])(?:freshness(?:[-_/](?:check|invalidation|invalidated))?|stale[-_/]invalidation|invalidat(?:e|ed|ion))(?:[:/._-]|$)/i.test(ref))),
  };
}

function windowActionMissingCompletionEvidence(evidence: {
  verificationRefs: string[];
  staleInvalidationRefs: string[];
}): string | undefined {
  const missing: string[] = [];
  if (evidence.verificationRefs.length === 0) missing.push('verifier refs');
  if (evidence.staleInvalidationRefs.length === 0) missing.push('freshness invalidation refs');
  return missing.length ? missing.join(' and ') : undefined;
}

function windowActionCurrentActionRefs(refs: string[], actionId: string): string[] {
  const safeActionId = safeToken(actionId);
  const safeRefs = runtimeOwnedRefs(refs);
  if (!safeActionId) return safeRefs;
  return safeRefs.filter((ref) => ref.includes(safeActionId));
}

function blockedResult(
  input: CodexAgentHostComputerUseActMaterializerInput,
  message: string,
  evidenceRefs: string[],
): CodexAgentHostComputerUseActMaterializerResult {
  const refs = runtimeOwnedRefs([
    ...evidenceRefs,
    ...permissionRefs(input),
    ...(input.runtimeTruth?.refs ?? []),
  ]);
  const sessionRef = windowActionSessionRefFromInput(input) ?? 'window-action-session:unknown';
  return {
    status: 'blocked',
    message,
    confidence: 0.68,
    claimType: 'runtime-diagnostic',
    reasoningTrace: 'SciForge failed closed before WindowActionSession Computer Use execution because the runtime-owned action path was not fully materialized.',
    evidenceRefs: refs.length ? refs : ['runtime-truth:window-action-session/blocked'],
    executionUnits: [executionUnit(input, { id: safeRefPartFromSessionRef(sessionRef), windowRef: sessionRef } as WindowActionSession, 'blocked', 'blocked', 'failed-with-reason', refs[0], safeToken(input.attemptId), message)],
    claims: [claim(input, message, refs, 'diagnostic')],
  };
}

function executionUnit(
  input: CodexAgentHostComputerUseActMaterializerInput,
  session: WindowActionSession,
  adapter: string,
  actionType: string,
  status: string,
  outputRef?: string,
  actionId?: string,
  failureReason?: string,
): Record<string, unknown> {
  return {
    id: `EU-window-action-computer-use-${safeToken(actionId ?? input.attemptId) || 'act'}`,
    tool: TOOL_ID,
    status,
    params: JSON.stringify({
      sessionRef: `window-action-session:${safeToken(session.id) || 'unknown'}`,
      adapter,
      actionType,
    }),
    ...(failureReason ? { failureReason } : {}),
    ...(outputRef ? { outputRef } : {}),
    hash: safeToken(actionId ?? input.attemptId) || 'window-action-act',
  };
}

function claim(
  input: CodexAgentHostComputerUseActMaterializerInput,
  text: string,
  refs: string[],
  type: string,
): Record<string, unknown> {
  return {
    id: `claim-window-action-computer-use-${safeToken(input.attemptId) || 'act'}`,
    type,
    text,
    confidence: 0.76,
    evidenceLevel: 'runtime',
    supportingRefs: runtimeOwnedRefs(refs).slice(0, 12),
    opposingRefs: [],
  };
}

function allCandidateRefs(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
  return [
    ...input.agentHostInput.refs,
    ...input.preflight.target.refs,
    ...input.preflight.evidenceRefs,
    ...(input.runtimeTruth?.target?.refs ?? []),
    ...(input.runtimeTruth?.observation?.refs ?? []),
    ...(input.runtimeTruth?.permissions?.refs ?? []),
    ...(input.runtimeTruth?.refs ?? []),
  ];
}

function unsafeInputReason(input: CodexAgentHostComputerUseActMaterializerInput): string | undefined {
  return allCandidateRefs(input).some((ref) => !runtimeOwnedRef(ref)) ? 'unsafe-ref' : undefined;
}

function runtimeOwnedRefs(refs: Array<string | undefined>): string[] {
  return [...new Set(refs.filter((ref): ref is string => typeof ref === 'string' && runtimeOwnedRef(ref)))].slice(0, 32);
}

function runtimeOwnedRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > 240) return false;
  const lower = trimmed.toLowerCase();
  if (
    /^(?:gui(?:\.|:)|ui:|fixture:|replay:|history:)/i.test(trimmed)
    || /https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(lower)
    || /(^|[:/._-])raw([:/._-]|$)/.test(lower)
  ) {
    return false;
  }
  return /^(?:runtime-truth:|browser-host-session:|window-action-session:|computer-use:|native-host:|action-ledger:|evidence:|workEvidence:|permission:|cancel:|stop:|lease:|adapter-registry:|desktop-native:|audit:|window:|appium-mac2:|app-native-command:|accessibility-ui-automation:|terminal-pty:|file-manager:|actor-cursor:|scoped-input-adapter:|focus-lease:)/i.test(trimmed);
}

function scrollDelta(direction: 'up' | 'down' | 'left' | 'right', amount: number): { x?: number; y?: number } {
  if (direction === 'up') return { y: -amount };
  if (direction === 'down') return { y: amount };
  if (direction === 'left') return { x: -amount };
  return { x: amount };
}

function evidenceKind(ref: string): string {
  if (ref.startsWith('window-action-session:')) return 'window-action-session';
  if (ref.startsWith('desktop-native:')) return 'desktop-native';
  if (ref.startsWith('evidence:')) return 'evidence';
  return 'runtime';
}

function safeRefPartFromSessionRef(ref: string): string {
  const withoutPrefix = ref.replace(/^window-action-session:/i, '');
  return safeToken(withoutPrefix) || 'unknown';
}

function safeToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) return undefined;
  const cleaned = trimmed.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 120);
  return cleaned || undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
