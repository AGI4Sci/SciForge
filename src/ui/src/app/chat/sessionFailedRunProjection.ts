import type {
  ScenarioInstanceId,
  ScenarioPackageRef,
  SciForgeMessage,
  SciForgeReference,
  SciForgeRun,
  SciForgeSession,
  UserGoalSnapshot,
} from '../../domain';
import { makeId, nowIso } from '../../domain';
import type { RunTerminationRecord } from '@sciforge-ui/runtime-contract/events';

export function appendFailedRunToSession({
  optimisticSession,
  scenarioId,
  scenarioPackageRef,
  skillPlanRef,
  uiPlanRef,
  prompt,
  message,
  references,
  goalSnapshot,
  termination,
}: {
  optimisticSession: SciForgeSession;
  scenarioId: ScenarioInstanceId;
  scenarioPackageRef: ScenarioPackageRef;
  skillPlanRef: string;
  uiPlanRef: string;
  prompt: string;
  message: string;
  references: SciForgeReference[];
  goalSnapshot?: UserGoalSnapshot;
  termination?: RunTerminationRecord;
}) {
  const failedRunId = makeId('run');
  const failedAt = nowIso();
  const raw = failedRunRawForProjection({
    optimisticSession,
    failedRunId,
    prompt,
    message,
    failedAt,
    references,
    termination,
  });
  const failedRun: SciForgeRun = {
    id: failedRunId,
    scenarioId,
    scenarioPackageRef,
    skillPlanRef,
    uiPlanRef,
    status: termination?.sessionStatus ?? 'failed',
    prompt,
    response: message,
    createdAt: failedAt,
    completedAt: failedAt,
    references,
    goalSnapshot,
    raw,
  };
  const failedMessage: SciForgeMessage = {
    id: makeId('msg'),
    role: 'system',
    content: message,
    createdAt: nowIso(),
    status: termination?.sessionStatus ?? 'failed',
    goalSnapshot,
    provenance: {
      kind: 'system-ui',
      source: 'failed-run-terminal-projection',
      runtimeRequestEligible: false,
      liveAcceptanceEligible: false,
    },
  };
  return {
    failedRunId,
    session: {
      ...optimisticSession,
      messages: [
        ...optimisticSession.messages,
        failedMessage,
      ],
      runs: [
        ...optimisticSession.runs,
        failedRun,
      ],
      updatedAt: nowIso(),
    },
  };
}

function failedRunRawForProjection({
  optimisticSession,
  failedRunId,
  prompt,
  message,
  failedAt,
  references,
  termination,
}: {
  optimisticSession: SciForgeSession;
  failedRunId: string;
  prompt: string;
  message: string;
  failedAt: string;
  references: SciForgeReference[];
  termination?: RunTerminationRecord;
}) {
  const reason = termination?.reason ?? 'backend-error';
  const diagnostic = termination?.detail ?? message;
  const auditRefs = uniqueStringRefs([
    ...references.map((reference) => reference.ref),
    termination ? `termination:${reason}` : undefined,
  ].filter((value): value is string => Boolean(value)));
  const recoverActions = termination?.retryable === false
    ? ['Start a new turn if more work is needed; the cancelled run cannot be auto-continued.']
    : [
      'Retry or continue from this failed run with preserved prompt, selected refs, and termination audit only.',
      'If the backend created partial files, inspect explicit artifact/log refs before rerunning expensive work.',
    ];
  return {
    ...(termination ? { termination } : {}),
    displayIntent: {
      status: 'repair-needed',
      conversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        conversationId: optimisticSession.sessionId,
        currentTurn: {
          id: optimisticSession.messages.at(-1)?.id ?? failedRunId,
          prompt,
        },
        visibleAnswer: {
          status: 'repair-needed',
          text: message,
          artifactRefs: [],
          diagnostic,
        },
        activeRun: {
          id: failedRunId,
          status: 'repair-needed',
        },
        artifacts: [],
        executionProcess: [{
          eventId: `${failedRunId}:failed-before-terminal-projection`,
          type: 'RunFailed',
          summary: `Backend run failed before returning a terminal ConversationProjection: ${diagnostic}`,
          timestamp: failedAt,
        }],
        recoverActions,
        verificationState: {
          status: 'failed',
          verdict: 'fail',
        },
        auditRefs,
        diagnostics: [{
          severity: 'error',
          code: reason,
          message: diagnostic,
          refs: auditRefs.map((ref) => ({ ref })),
        }],
      },
    },
  };
}

function uniqueStringRefs(values: unknown[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

export function attachProcessRecoveryToFailedSession({
  session,
  failedRunId,
  events,
  eventCount,
  retainedEventCount,
  truncated,
  refs,
  summaryDigest,
  eventSummaries,
}: {
  session: SciForgeSession;
  failedRunId: string;
  events: Array<Record<string, unknown>>;
  eventCount?: number;
  retainedEventCount?: number;
  truncated?: boolean;
  refs?: string[];
  summaryDigest?: Record<string, unknown>;
  eventSummaries?: Array<Record<string, unknown>>;
}): SciForgeSession {
  if (!events.length) return session;
  return {
    ...session,
    runs: session.runs.map((run) => run.id === failedRunId
      ? {
          ...run,
          raw: {
            ...(typeof run.raw === 'object' && run.raw !== null ? run.raw : {}),
            streamProcess: {
              eventCount: eventCount ?? events.length,
              retainedEventCount,
              truncated,
              refs,
              summaryDigest,
              eventSummaries,
              events,
            },
          },
        }
      : run),
  };
}
