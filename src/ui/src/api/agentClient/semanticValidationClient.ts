import type { NormalizedAgentResponse, SemanticTurnAcceptance, SendAgentMessageInput, TurnAcceptance, UserGoalSnapshot } from '../../domain';
import { DEFAULT_AGENT_REQUEST_TIMEOUT_MS, DEFAULT_AGENT_SERVER_URL } from '../../../../shared/agentHandoff';
import { summarizeArtifacts } from './requestPayload';

const DEFAULT_REQUEST_TIMEOUT_MS = DEFAULT_AGENT_REQUEST_TIMEOUT_MS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return entries.length ? entries : undefined;
}

export async function validateSemanticTurnAcceptance(
  input: SendAgentMessageInput,
  args: {
    snapshot: UserGoalSnapshot;
    response: NormalizedAgentResponse;
    deterministicAcceptance: TurnAcceptance;
  },
  signal?: AbortSignal,
): Promise<SemanticTurnAcceptance | undefined> {
  const controller = new AbortController();
  let abortedByCaller = false;
  const linkedAbort = () => {
    abortedByCaller = true;
    controller.abort();
  };
  signal?.addEventListener('abort', linkedAbort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), Math.min(input.config.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS, 12_000));
  const baseUrl = (input.config.agentServerBaseUrl || DEFAULT_AGENT_SERVER_URL).replace(/\/+$/, '');
  const payload = buildSemanticAcceptancePayload(input, args);
  const endpoints = [
    `${baseUrl}/api/agent-server/turn-acceptance/semantic`,
    `${baseUrl}/api/agent-server/acceptance/semantic`,
  ];
  try {
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) continue;
        let json: unknown = text;
        try {
          json = text ? JSON.parse(text) as unknown : {};
        } catch {
          json = { message: text };
        }
        const semantic = normalizeSemanticTurnAcceptance(json);
        if (semantic) return semantic;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError' && abortedByCaller) throw err;
      }
    }
    return undefined;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', linkedAbort);
  }
}

function buildSemanticAcceptancePayload(
  input: SendAgentMessageInput,
  args: {
    snapshot: UserGoalSnapshot;
    response: NormalizedAgentResponse;
    deterministicAcceptance: TurnAcceptance;
  },
) {
  return {
    contract: 'sciforge.semantic-turn-acceptance.v1',
    instruction: 'Return only an acceptance judgment. Do not write or rewrite the user-facing final answer.',
    userGoalSnapshot: args.snapshot,
    finalResponse: args.response.message.content,
    objectReferences: args.response.message.objectReferences ?? args.response.run.objectReferences ?? [],
    artifacts: summarizeArtifacts(args.response.artifacts),
    acceptanceFailures: args.deterministicAcceptance.failures,
    deterministicAcceptance: args.deterministicAcceptance,
    runRef: `run:${args.response.run.id}`,
    metadata: {
      project: 'SciForge',
      source: 'sciforge-web-ui',
      sessionId: input.sessionId,
      scenarioId: input.scenarioId,
      agentBackend: input.config.agentBackend,
      workspacePath: input.config.workspacePath,
    },
  };
}

function normalizeSemanticTurnAcceptance(value: unknown): SemanticTurnAcceptance | undefined {
  const root = isRecord(value) && isRecord(value.data) ? value.data : value;
  const record = isRecord(root) && isRecord(root.semanticTurnAcceptance)
    ? root.semanticTurnAcceptance
    : isRecord(root) && isRecord(root.acceptance)
      ? root.acceptance
      : root;
  if (!isRecord(record)) return undefined;
  const pass = asBoolean(record.pass);
  if (pass === undefined) return undefined;
  return {
    pass,
    confidence: Math.max(0, Math.min(1, asNumber(record.confidence) ?? (pass ? 0.75 : 0.5))),
    unmetCriteria: asStringArray(record.unmetCriteria) ?? [],
    missingArtifacts: asStringArray(record.missingArtifacts) ?? [],
    referencedEvidence: asStringArray(record.referencedEvidence) ?? [],
    repairPrompt: asString(record.repairPrompt),
    backendRunRef: asString(record.backendRunRef) ?? asString(record.runRef),
  };
}

