import type { ScenarioInstanceId, SciForgeReference, SciForgeSession } from '../domain';

export type UIActionType =
  | 'submit-turn'
  | 'trigger-recover'
  | 'cancel-run'
  | 'concurrency-decision'
  | 'open-debug-audit';

export interface UIActionBase {
  kind: 'UIAction';
  id: string;
  type: UIActionType;
  sessionId: string;
  scenarioId: ScenarioInstanceId;
  createdAt: string;
}

export type UIAction =
  | (UIActionBase & {
    type: 'submit-turn';
    promptPreview: string;
    referenceRefs: string[];
  })
  | (UIActionBase & {
    type: 'trigger-recover';
    runId?: string;
    recoverAction: string;
    auditRefs: string[];
  })
  | (UIActionBase & {
    type: 'cancel-run';
    runId?: string;
    rejectedGuidanceIds: string[];
  })
  | (UIActionBase & {
    type: 'concurrency-decision';
    activeRunId?: string;
    decision: 'queue-guidance' | 'wait' | 'attach' | 'cancel' | 'fork';
    promptPreview?: string;
  })
  | (UIActionBase & {
    type: 'open-debug-audit';
    runId?: string;
    auditRefs: string[];
  });

export type SubmitTurnUIAction = Extract<UIAction, { type: 'submit-turn' }>;
export type TriggerRecoverUIAction = Extract<UIAction, { type: 'trigger-recover' }>;
export type CancelRunUIAction = Extract<UIAction, { type: 'cancel-run' }>;
export type ConcurrencyDecisionUIAction = Extract<UIAction, { type: 'concurrency-decision' }>;
export type OpenDebugAuditUIAction = Extract<UIAction, { type: 'open-debug-audit' }>;

type UIActionInput = {
  [Action in UIAction as Action['type']]: Omit<Action, 'kind' | 'id' | 'sessionId' | 'scenarioId' | 'createdAt'>;
}[UIActionType];

export type UIActionSession = SciForgeSession & {
  uiActionAuditLog?: UIAction[];
};

export function createUIAction(
  input: UIActionInput & {
    session: SciForgeSession;
    id: string;
    createdAt: string;
  },
): UIAction {
  const { session, id, createdAt, ...rest } = input;
  return {
    kind: 'UIAction',
    id,
    sessionId: session.sessionId,
    scenarioId: session.scenarioId,
    createdAt,
    ...rest,
  } as UIAction;
}

export function createSubmitTurnUIAction(input: {
  session: SciForgeSession;
  id: string;
  createdAt: string;
  prompt: string;
  references?: SciForgeReference[];
}): SubmitTurnUIAction {
  return createUIAction({
    id: input.id,
    session: input.session,
    createdAt: input.createdAt,
    type: 'submit-turn',
    promptPreview: compactUIActionPromptPreview(input.prompt),
    referenceRefs: uiActionReferenceRefs(input.references ?? []),
  }) as SubmitTurnUIAction;
}

export function createTriggerRecoverUIAction(input: {
  session: SciForgeSession;
  id: string;
  createdAt: string;
  runId?: string;
  recoverAction: string;
  auditRefs?: string[];
}): TriggerRecoverUIAction {
  return createUIAction({
    id: input.id,
    session: input.session,
    createdAt: input.createdAt,
    type: 'trigger-recover',
    runId: input.runId,
    recoverAction: input.recoverAction,
    auditRefs: uniqueStringList(input.auditRefs ?? []),
  }) as TriggerRecoverUIAction;
}

export function createCancelRunUIAction(input: {
  session: SciForgeSession;
  id: string;
  createdAt: string;
  runId?: string;
  rejectedGuidanceIds?: string[];
}): CancelRunUIAction {
  return createUIAction({
    id: input.id,
    session: input.session,
    createdAt: input.createdAt,
    type: 'cancel-run',
    runId: input.runId,
    rejectedGuidanceIds: uniqueStringList(input.rejectedGuidanceIds ?? []),
  }) as CancelRunUIAction;
}

export function createConcurrencyDecisionUIAction(input: {
  session: SciForgeSession;
  id: string;
  createdAt: string;
  activeRunId?: string;
  decision: ConcurrencyDecisionUIAction['decision'];
  prompt?: string;
}): ConcurrencyDecisionUIAction {
  return createUIAction({
    id: input.id,
    session: input.session,
    createdAt: input.createdAt,
    type: 'concurrency-decision',
    activeRunId: input.activeRunId,
    decision: input.decision,
    promptPreview: input.prompt ? compactUIActionPromptPreview(input.prompt) : undefined,
  }) as ConcurrencyDecisionUIAction;
}

export function createOpenDebugAuditUIAction(input: {
  session: SciForgeSession;
  id: string;
  createdAt: string;
  runId?: string;
  auditRefs?: string[];
}): OpenDebugAuditUIAction {
  return createUIAction({
    id: input.id,
    session: input.session,
    createdAt: input.createdAt,
    type: 'open-debug-audit',
    runId: input.runId,
    auditRefs: uniqueStringList(input.auditRefs ?? []),
  }) as OpenDebugAuditUIAction;
}

export function uiActionReferenceRefs(references: SciForgeReference[]): string[] {
  return uniqueStringList(references.map((reference) => reference.ref));
}

export function compactUIActionPromptPreview(prompt: string, limit = 160): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1).trim()}...` : compact;
}

export function appendUIActionAuditLog(log: UIAction[], action: UIAction, limit = 64): UIAction[] {
  return [...log, action].slice(-limit);
}

export function uiActionAuditLogForSession(session: SciForgeSession): UIAction[] {
  const log = (session as UIActionSession).uiActionAuditLog;
  if (!Array.isArray(log)) return [];
  return log.filter(isUIAction);
}

export function recordUIActionInSession(session: SciForgeSession, action: UIAction, limit = 64): UIActionSession {
  const current = uiActionAuditLogForSession(session);
  return {
    ...session,
    uiActionAuditLog: appendUIActionAuditLog(current, action, limit),
    updatedAt: action.createdAt,
  };
}

function uniqueStringList(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function isUIAction(value: unknown): value is UIAction {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<UIAction>;
  return record.kind === 'UIAction'
    && typeof record.id === 'string'
    && typeof record.sessionId === 'string'
    && typeof record.scenarioId === 'string'
    && typeof record.createdAt === 'string'
    && typeof record.type === 'string'
    && ['submit-turn', 'trigger-recover', 'cancel-run', 'concurrency-decision', 'open-debug-audit'].includes(record.type);
}
