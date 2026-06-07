import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import { CAPABILITY_DISCOVERY_CONTRACT_ID } from '../../../packages/contracts/runtime/capability-discovery.js';
import type {
  CapabilityExpandQuery,
  CapabilityExplainQuery,
  CapabilityPlanQuery,
  CapabilitySearchQuery,
} from '../../../packages/contracts/runtime/capability-discovery.js';
import { createCapabilityDiscoveryService } from '../capability-discovery.js';
import { errorMessage, isRecord, safeWorkspaceRel } from '../gateway-utils.js';

export const CAPABILITY_DISCOVERY_BACKEND_TOOL_TRANSPORT_SCHEMA_VERSION = 'sciforge.capability-discovery.agentserver-tool-transport.v1' as const;
/** @deprecated Use CAPABILITY_DISCOVERY_BACKEND_TOOL_TRANSPORT_SCHEMA_VERSION. */
export const CAPABILITY_DISCOVERY_AGENTSERVER_TOOL_TRANSPORT_SCHEMA_VERSION = CAPABILITY_DISCOVERY_BACKEND_TOOL_TRANSPORT_SCHEMA_VERSION;
export const CAPABILITY_DISCOVERY_AUDIT_RECORD_SCHEMA_VERSION = 'sciforge.capability-discovery.audit-record.v1' as const;
export const CAPABILITY_DISCOVERY_LEDGER_EVENT_SCHEMA_VERSION = 'sciforge.workspace-ledger-event.v1' as const;

export type CapabilityDiscoveryToolMethod = 'search' | 'expand' | 'plan' | 'explain';

export interface BackendCapabilityDiscoveryToolTransportOptions {
  workspace?: string;
  sessionBundleRel?: string;
  auditSeed?: string;
  availableProviderIds?: string[];
  unavailableProviderReasons?: Record<string, string>;
}

/** @deprecated Use BackendCapabilityDiscoveryToolTransportOptions. */
export type AgentServerCapabilityDiscoveryToolTransportOptions = BackendCapabilityDiscoveryToolTransportOptions;

export interface CapabilityDiscoveryToolResultEvent {
  type: 'tool-result';
  source: 'workspace-runtime';
  toolName: `capability_discovery.${CapabilityDiscoveryToolMethod}`;
  status: 'done' | 'failed-with-reason';
  message: string;
  detail?: string;
  callId?: string;
  result?: unknown;
  error?: string;
  auditRef?: string;
  auditRefs: string[];
  discoveryRef?: string;
  completionEvidence: 'not-evidence';
  raw: Record<string, unknown>;
}

export function capabilityDiscoveryBackendToolTransportBrief() {
  return {
    schemaVersion: CAPABILITY_DISCOVERY_BACKEND_TOOL_TRANSPORT_SCHEMA_VERSION,
    tools: [
      'capability_discovery.search',
      'capability_discovery.expand',
      'capability_discovery.plan',
      'capability_discovery.explain',
    ],
    eventContract: {
      request: 'Backend may emit a tool-call event with toolName/name/tool and JSON args/input/arguments.',
      response: 'Gateway emits a tool-result event with result, discoveryRef, auditRef, persisted auditRefs, and completionEvidence=not-evidence.',
    },
    progressiveDisclosure: true,
    executionRequiresInvokeCapability: true,
    safety: {
      noSecrets: true,
      noInternalEndpoints: true,
      noWorkspaceRoots: true,
    },
  };
}

/** @deprecated Use capabilityDiscoveryBackendToolTransportBrief. */
export const capabilityDiscoveryAgentServerToolTransportBrief = capabilityDiscoveryBackendToolTransportBrief;

export async function maybeHandleCapabilityDiscoveryToolCall(
  event: unknown,
  options: BackendCapabilityDiscoveryToolTransportOptions = {},
): Promise<CapabilityDiscoveryToolResultEvent | undefined> {
  const call = parseCapabilityDiscoveryToolCall(event);
  if (!call) return undefined;
  const toolName = `capability_discovery.${call.method}` as const;
  try {
    const service = createCapabilityDiscoveryService({
      auditSeed: options.auditSeed ?? call.callId ?? 'backend-tool-call',
      availableProviderIds: options.availableProviderIds,
      unavailableProviderReasons: options.unavailableProviderReasons,
    });
    const result = runDiscoveryMethod(service, call.method, call.args);
    const refs = refsFromDiscoveryResult(result);
    const persistedAuditRef = await persistDiscoveryAuditRecord(options, {
      method: call.method,
      callId: call.callId,
      query: call.args,
      result,
      sourceEvent: event,
    });
    const ledgerRef = await appendDiscoveryLedgerEvent(options, {
      method: call.method,
      callId: call.callId,
      status: 'done',
      discoveryRef: refs.discoveryRef,
      auditRef: refs.auditRef,
      persistedAuditRef,
    });
    const auditRefs = uniqueStrings([
      refs.auditRef,
      persistedAuditRef,
      ledgerRef,
    ].filter((ref): ref is string => Boolean(ref)));
    return {
      type: 'tool-result',
      source: 'workspace-runtime',
      toolName,
      status: 'done',
      message: `Capability discovery ${call.method} completed`,
      detail: refs.discoveryRef,
      callId: call.callId,
      result,
      auditRef: refs.auditRef,
      auditRefs,
      discoveryRef: refs.discoveryRef,
      completionEvidence: 'not-evidence',
      raw: sanitizeForDiscoveryAudit({
        schemaVersion: CAPABILITY_DISCOVERY_BACKEND_TOOL_TRANSPORT_SCHEMA_VERSION,
        method: call.method,
        callId: call.callId,
        auditRefs,
        discoveryRef: refs.discoveryRef,
        persistedAuditRef,
        ledgerRef,
        executionRequiresInvokeCapability: true,
      }) as Record<string, unknown>,
    };
  } catch (error) {
    const reason = sanitizeError(errorMessage(error));
    const persistedAuditRef = await persistDiscoveryAuditRecord(options, {
      method: call.method,
      callId: call.callId,
      query: call.args,
      error: reason,
      sourceEvent: event,
    });
    const ledgerRef = await appendDiscoveryLedgerEvent(options, {
      method: call.method,
      callId: call.callId,
      status: 'failed-with-reason',
      error: reason,
      persistedAuditRef,
    });
    const auditRefs = uniqueStrings([persistedAuditRef, ledgerRef].filter((ref): ref is string => Boolean(ref)));
    return {
      type: 'tool-result',
      source: 'workspace-runtime',
      toolName,
      status: 'failed-with-reason',
      message: `Capability discovery ${call.method} failed`,
      detail: reason,
      callId: call.callId,
      error: reason,
      auditRef: persistedAuditRef,
      auditRefs,
      completionEvidence: 'not-evidence',
      raw: sanitizeForDiscoveryAudit({
        schemaVersion: CAPABILITY_DISCOVERY_BACKEND_TOOL_TRANSPORT_SCHEMA_VERSION,
        method: call.method,
        callId: call.callId,
        persistedAuditRef,
        ledgerRef,
        error: reason,
        executionRequiresInvokeCapability: true,
      }) as Record<string, unknown>,
    };
  }
}

function parseCapabilityDiscoveryToolCall(event: unknown): { method: CapabilityDiscoveryToolMethod; args: Record<string, unknown>; callId?: string } | undefined {
  if (!isRecord(event)) return undefined;
  const rawType = stringField(event.type) ?? stringField(event.kind);
  const toolLikeType = !rawType || /tool[-_]?call|function[-_]?call/i.test(rawType);
  const toolName = normalizeToolName(
    stringField(event.toolName)
      ?? stringField(event.tool)
      ?? stringField(event.name)
      ?? stringField(event.capabilityId)
      ?? nestedString(event.function, 'name')
      ?? nestedString(event.toolCall, 'name'),
  );
  const method = methodFromToolName(toolName);
  if (!toolLikeType || !method) return undefined;
  const args = parseToolArguments(
    event.input
      ?? event.args
      ?? event.arguments
      ?? event.params
      ?? event.query
      ?? (isRecord(event.function) ? event.function.arguments : undefined)
      ?? (isRecord(event.toolCall) ? event.toolCall.input ?? event.toolCall.arguments : undefined),
  );
  return {
    method,
    args,
    callId: stringField(event.callId) ?? stringField(event.id) ?? stringField(event.toolCallId) ?? nestedString(event.toolCall, 'id'),
  };
}

function runDiscoveryMethod(
  service: ReturnType<typeof createCapabilityDiscoveryService>,
  method: CapabilityDiscoveryToolMethod,
  args: Record<string, unknown>,
) {
  if (method === 'search') return service.search(asSearchQuery(args));
  if (method === 'expand') return service.expand(asExpandQuery(args));
  if (method === 'plan') return service.plan(asPlanQuery(args));
  return service.explain(asExplainQuery(args));
}

function asSearchQuery(args: Record<string, unknown>): CapabilitySearchQuery {
  const goal = stringField(args.goal) ?? stringField(args.prompt) ?? stringField(args.query);
  if (!goal) throw new Error('capability_discovery.search requires a non-empty goal.');
  return {
    goal,
    currentContextRefs: stringList(args.currentContextRefs),
    selectedRefs: stringList(args.selectedRefs),
    desiredArtifacts: stringList(args.desiredArtifacts),
    constraints: isRecord(args.constraints) ? args.constraints as CapabilitySearchQuery['constraints'] : undefined,
  };
}

function asExpandQuery(args: Record<string, unknown>): CapabilityExpandQuery {
  const capabilityIds = stringList(args.capabilityIds ?? args.ids ?? args.candidateIds) ?? [];
  if (!capabilityIds.length) throw new Error('capability_discovery.expand requires capabilityIds.');
  return {
    capabilityIds,
    include: stringList(args.include) as CapabilityExpandQuery['include'],
    maxSchemaBytes: finiteNumber(args.maxSchemaBytes),
  };
}

function asPlanQuery(args: Record<string, unknown>): CapabilityPlanQuery {
  const goal = stringField(args.goal) ?? stringField(args.prompt) ?? 'Plan capability usage for the current task.';
  const candidateIds = stringList(args.candidateIds ?? args.capabilityIds) ?? [];
  if (!candidateIds.length) throw new Error('capability_discovery.plan requires candidateIds.');
  return {
    goal,
    candidateIds,
    contextRefs: stringList(args.contextRefs),
    budget: isRecord(args.budget) ? args.budget as CapabilityPlanQuery['budget'] : undefined,
  };
}

function asExplainQuery(args: Record<string, unknown>): CapabilityExplainQuery {
  const audience = stringField(args.audience);
  return {
    planId: stringField(args.planId),
    capabilityIds: stringList(args.capabilityIds ?? args.candidateIds),
    audience: audience === 'debug' || audience === 'audit' ? audience : 'user',
  };
}

async function persistDiscoveryAuditRecord(
  options: BackendCapabilityDiscoveryToolTransportOptions,
  input: {
    method: CapabilityDiscoveryToolMethod;
    callId?: string;
    query: Record<string, unknown>;
    result?: unknown;
    error?: string;
    sourceEvent: unknown;
  },
): Promise<string | undefined> {
  if (!options.workspace) return undefined;
  const digest = createHash('sha256')
    .update(options.auditSeed ?? 'backend-tool-call')
    .update(input.method)
    .update(JSON.stringify(input.query))
    .digest('hex')
    .slice(0, 16);
  const rel = safeWorkspaceRel([
    options.sessionBundleRel?.replace(/\/+$/, ''),
    'records/capability-discovery',
    `${input.method}-${digest}.json`,
  ].filter(Boolean).join('/'));
  const record = sanitizeForDiscoveryAudit({
    schemaVersion: CAPABILITY_DISCOVERY_AUDIT_RECORD_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    source: 'backend-tool-call-transport',
    method: input.method,
    callId: input.callId,
    query: input.query,
    result: input.result,
    error: input.error,
    sourceEvent: input.sourceEvent,
    contract: CAPABILITY_DISCOVERY_CONTRACT_ID,
    completionEvidence: 'not-evidence',
    executionRequiresInvokeCapability: true,
  });
  await mkdir(dirname(join(options.workspace, rel)), { recursive: true });
  await writeFile(join(options.workspace, rel), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return rel;
}

async function appendDiscoveryLedgerEvent(
  options: BackendCapabilityDiscoveryToolTransportOptions,
  input: {
    method: CapabilityDiscoveryToolMethod;
    callId?: string;
    status: CapabilityDiscoveryToolResultEvent['status'];
    discoveryRef?: string;
    auditRef?: string;
    persistedAuditRef?: string;
    error?: string;
  },
): Promise<string | undefined> {
  if (!options.workspace || !options.sessionBundleRel) return undefined;
  const bundleRel = safeWorkspaceRel(options.sessionBundleRel.replace(/\/+$/, ''));
  const ledgerRef = safeWorkspaceRel(`${bundleRel}/ledger/events.jsonl`);
  const eventId = `capability-discovery:${input.method}:${createHash('sha256')
    .update(options.auditSeed ?? 'backend-tool-call')
    .update(input.callId ?? '')
    .update(input.persistedAuditRef ?? '')
    .digest('hex')
    .slice(0, 16)}`;
  const refs = [
    input.persistedAuditRef ? ledgerMemoryRef(input.persistedAuditRef, 'run-audit', 'Persisted capability discovery audit record.') : undefined,
    input.auditRef ? ledgerMemoryRef(input.auditRef, 'run-audit', 'Deterministic capability discovery audit ref.') : undefined,
    input.discoveryRef ? ledgerMemoryRef(input.discoveryRef, 'retrieval', 'Capability discovery result ref.') : undefined,
  ].filter(Boolean);
  const event = sanitizeForDiscoveryAudit({
    schemaVersion: CAPABILITY_DISCOVERY_LEDGER_EVENT_SCHEMA_VERSION,
    eventId,
    sessionId: sessionIdFromBundleRel(bundleRel),
    createdAt: new Date().toISOString(),
    actor: 'runtime',
    kind: 'decision-recorded',
    summary: `Capability discovery ${input.method} ${input.status}; recommendation remains not-evidence until executed through invoke_capability.`,
    refs,
    metadata: {
      capability: `capability_discovery.${input.method}`,
      callId: input.callId,
      status: input.status,
      error: input.error,
      completionEvidence: 'not-evidence',
      executionRequiresInvokeCapability: true,
      source: 'backend-tool-call-transport',
    },
  });
  await mkdir(dirname(join(options.workspace, ledgerRef)), { recursive: true });
  await appendFile(join(options.workspace, ledgerRef), `${JSON.stringify(event)}\n`, 'utf8');
  return ledgerRef;
}

function ledgerMemoryRef(ref: string, kind: 'run-audit' | 'retrieval', preview: string) {
  const sizeBytes = Buffer.byteLength(preview || ref, 'utf8');
  return {
    ref,
    kind,
    digest: `sha256:${createHash('sha256').update(JSON.stringify({ ref, kind, preview, sizeBytes })).digest('hex')}`,
    sizeBytes,
    preview,
    retention: kind === 'run-audit' ? 'audit-only' : 'warm',
  };
}

function sessionIdFromBundleRel(bundleRel: string) {
  const tail = bundleRel.split('/').filter(Boolean).at(-1) ?? 'session-unknown';
  const match = /^\d{4}-\d{2}-\d{2}_.+?_(.+)$/.exec(tail);
  return match?.[1] ?? tail;
}

function refsFromDiscoveryResult(result: unknown) {
  const record = isRecord(result) ? result : {};
  return {
    discoveryRef: stringField(record.discoveryRef),
    auditRef: stringField(record.auditRef),
  };
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

function methodFromToolName(toolName: string | undefined): CapabilityDiscoveryToolMethod | undefined {
  if (!toolName) return undefined;
  const match = /^capability_discovery(?:\.|_)(search|expand|plan|explain)$/i.exec(toolName);
  if (!match) return undefined;
  return match[1]!.toLowerCase() as CapabilityDiscoveryToolMethod;
}

function normalizeToolName(value: string | undefined) {
  return value?.trim().replaceAll('-', '_');
}

function nestedString(value: unknown, key: string) {
  return isRecord(value) ? stringField(value[key]) : undefined;
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim());
  return list.length ? list : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizeForDiscoveryAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForDiscoveryAudit);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/endpoint|baseUrl|invokeUrl|url|auth|token|secret|workspaceRoot|workspaceRoots|runtimeLocation|command|mcpServer/i.test(key)) continue;
      out[key] = sanitizeForDiscoveryAudit(entry);
    }
    return out;
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(/https?:\/\/[^\s")]+/g, '[redacted-url]')
    .replace(/\/(?:Applications|Users|private|var|tmp)\/[^\s")]+/g, '[redacted-path]')
    .replace(/(?:token|secret|api[_-]?key)=?[A-Za-z0-9._-]+/gi, '[redacted-secret]');
}

function sanitizeError(value: string) {
  return String(sanitizeForDiscoveryAudit(value));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim()))];
}
