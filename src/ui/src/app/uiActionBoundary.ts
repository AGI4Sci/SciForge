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

type UIActionInput = {
  [Action in UIAction as Action['type']]: Omit<Action, 'kind' | 'id' | 'sessionId' | 'scenarioId' | 'createdAt'>;
}[UIActionType];

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

export function uiActionReferenceRefs(references: SciForgeReference[]): string[] {
  return Array.from(new Set(references.map((reference) => reference.ref).filter(Boolean)));
}

export function compactUIActionPromptPreview(prompt: string, limit = 160): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1).trim()}...` : compact;
}

export function appendUIActionAuditLog(log: UIAction[], action: UIAction, limit = 64): UIAction[] {
  return [...log, action].slice(-limit);
}
