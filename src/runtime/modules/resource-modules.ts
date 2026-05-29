import { createHash } from 'node:crypto';

import {
  createModuleDescription,
  moduleResult,
  type ModuleDescription,
  type ModuleInvokeRequest,
  type ModuleQueryRequest,
  type ModuleReadRequest,
  type ModuleResultEnvelope,
} from '../../../packages/contracts/runtime/modules.js';
import { skillPackageManifests } from '../../../packages/skills/catalog.js';
import type { SkillPackageManifest } from '../../../packages/skills/types.js';
import {
  createCapabilityDiscoveryService,
  type CapabilityDiscoveryOptions,
} from '../capability-discovery.js';
import type {
  CapabilityExpandQuery,
  CapabilityExplainQuery,
  CapabilityPlanQuery,
  CapabilitySearchQuery,
} from '../../../packages/contracts/runtime/capability-discovery.js';

export interface ResourceModuleHandler {
  describe(): ModuleDescription;
  query?(request: ModuleQueryRequest): ModuleResultEnvelope;
  read?(request: ModuleReadRequest): ModuleResultEnvelope;
  invoke?(request: ModuleInvokeRequest): ModuleResultEnvelope;
}

export type MemoryScope = 'project' | 'session' | 'user';

export interface MemoryFixtureRef {
  ref: string;
  scope: MemoryScope;
  title?: string;
  summary: string;
  content?: string;
  tags?: string[];
  sourceRef?: string;
  updatedAt?: string;
}

export interface MemoryResourceModuleOptions {
  fixtures?: MemoryFixtureRef[];
}

export interface ResourceModuleOptions {
  memory?: MemoryResourceModuleOptions;
  capabilities?: CapabilityDiscoveryOptions;
}

const SKILLS_MODULE_ID = 'skills';
const MEMORY_MODULE_ID = 'memory';
const CAPABILITIES_MODULE_ID = 'capabilities';
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const EXCERPT_CHARS = 600;

export function createSkillsResourceModuleHandler(
  catalog: readonly SkillPackageManifest[] = skillPackageManifests as readonly SkillPackageManifest[],
): ResourceModuleHandler {
  return {
    describe: skillsDescription,
    query(request) {
      const limit = clampLimit(request.limit);
      const items = catalog
        .filter((skill) => matchesQuery([skill.id, skill.label, skill.description, ...skill.tags], request.query))
        .slice(0, limit)
        .map(skillQueryItem);
      return ok(SKILLS_MODULE_ID, {
        items,
        total: items.length,
        query: request.query ?? '',
      }, items.map((item) => item.ref));
    },
    read(request) {
      const skillId = refId(request.ref, 'skill:');
      if (!skillId) return fail(SKILLS_MODULE_ID, `unsupported_ref:${request.ref}`);
      const skill = catalog.find((entry) => entry.id === skillId);
      if (!skill) return fail(SKILLS_MODULE_ID, `skill_not_found:${skillId}`);
      return ok(SKILLS_MODULE_ID, skillReadSummary(skill), [`skill:${skill.id}`]);
    },
  };
}

export function createMemoryResourceModuleHandler(options: MemoryResourceModuleOptions = {}): ResourceModuleHandler {
  const fixtures = (options.fixtures ?? [])
    .filter((fixture) => fixture.ref.startsWith('memory:'))
    .map((fixture) => ({ ...fixture, tags: uniqueStrings(fixture.tags ?? []) }));

  return {
    describe: memoryDescription,
    query(request) {
      const limit = clampLimit(request.limit);
      const scope = typeof request.scope === 'string' ? request.scope : undefined;
      const items = fixtures
        .filter((memory) => !scope || memory.scope === scope)
        .filter((memory) => matchesQuery([
          memory.ref,
          memory.title ?? '',
          memory.summary,
          memory.content ?? '',
          ...(memory.tags ?? []),
        ], request.query))
        .slice(0, limit)
        .map(memoryQueryItem);
      return ok(MEMORY_MODULE_ID, {
        items,
        total: items.length,
        query: request.query ?? '',
        scope,
      }, items.map((item) => item.ref));
    },
    read(request) {
      const memory = fixtures.find((entry) => entry.ref === request.ref);
      if (!memory) return fail(MEMORY_MODULE_ID, `memory_not_found:${request.ref}`);
      return ok(MEMORY_MODULE_ID, memoryReadSummary(memory, request.includeMeta === true), [memory.ref]);
    },
    invoke(request) {
      if (!['write', 'update', 'forget'].includes(request.intent)) {
        return fail(MEMORY_MODULE_ID, `unsupported_intent:${request.intent}`);
      }
      return memoryInvokeResult(request, fixtures);
    },
  };
}

export function createCapabilitiesResourceModuleHandler(
  options: CapabilityDiscoveryOptions = {},
): ResourceModuleHandler {
  const discovery = createCapabilityDiscoveryService(options);

  return {
    describe: capabilitiesDescription,
    query(request) {
      const limit = clampLimit(request.limit);
      const result = discovery.search({
        goal: request.query?.trim() || 'capability discovery',
        desiredArtifacts: stringArray(request.filters?.desiredArtifacts),
        selectedRefs: stringArray(request.filters?.selectedRefs),
        currentContextRefs: stringArray(request.filters?.currentContextRefs),
        constraints: {
          maxCandidates: limit,
          latencyTier: 'quick',
          allowedSideEffects: stringArray(request.filters?.allowedSideEffects),
          privacyProfile: stringValue(request.filters?.privacyProfile),
        },
      });
      const items = result.candidates.map((candidate) => ({
        ref: `capability:${candidate.capabilityId}`,
        capabilityId: candidate.capabilityId,
        title: candidate.title,
        kind: candidate.kind,
        summary: candidate.brief,
        availability: candidate.availability,
        sideEffectClass: candidate.sideEffectClass,
      }));
      return ok(CAPABILITIES_MODULE_ID, {
        items,
        total: items.length,
        query: request.query ?? '',
        discoveryRef: result.discoveryRef,
        auditRef: result.auditRef,
        next: result.next ?? [],
      }, items.map((item) => item.ref));
    },
    read(request) {
      const capabilityId = refId(request.ref, 'capability:');
      if (!capabilityId) return fail(CAPABILITIES_MODULE_ID, `unsupported_ref:${request.ref}`);
      const expanded = discovery.expand({ capabilityIds: [capabilityId] });
      const entry = expanded.expanded[0];
      if (!entry) return fail(CAPABILITIES_MODULE_ID, `capability_not_found:${capabilityId}`);
      return ok(CAPABILITIES_MODULE_ID, {
        ref: `capability:${capabilityId}`,
        capabilityId,
        title: stringValue(entry.title) ?? capabilityId,
        kind: stringValue(entry.kind) ?? 'capability',
        summary: stringValue(entry.brief) ?? '',
        routingTags: stringArray(entry.routingTags),
        domains: stringArray(entry.domains),
        sideEffects: stringArray(entry.sideEffects),
        sideEffectClass: stringValue(entry.sideEffectClass),
        availability: stringValue(entry.availability),
        missing: stringArray(entry.missing),
        executionContract: stringValue(entry.executionContract),
        discoveryRef: expanded.discoveryRef,
        auditRef: expanded.auditRef,
      }, [`capability:${capabilityId}`]);
    },
    invoke(request) {
      if (request.intent === 'search') {
        return ok(CAPABILITIES_MODULE_ID, discovery.search(capabilitySearchQuery(request.input)), []);
      }
      if (request.intent === 'explain') {
        return ok(CAPABILITIES_MODULE_ID, discovery.explain(capabilityExplainQuery(request.input)), []);
      }
      if (request.intent === 'plan') {
        const query = capabilityPlanQuery(request.input);
        if (!query.candidateIds.length) return fail(CAPABILITIES_MODULE_ID, 'missing_candidate_ids');
        return ok(CAPABILITIES_MODULE_ID, discovery.plan(query), []);
      }
      if (request.intent === 'expand') {
        const query = capabilityExpandQuery(request.input);
        if (!query.capabilityIds.length) return fail(CAPABILITIES_MODULE_ID, 'missing_capability_ids');
        return ok(CAPABILITIES_MODULE_ID, discovery.expand(query), query.capabilityIds.map((id) => `capability:${id}`));
      }
      return fail(CAPABILITIES_MODULE_ID, `unsupported_intent:${request.intent}`);
    },
  };
}

export const createCapabilityResourceModuleHandler = createCapabilitiesResourceModuleHandler;

export function createResourceModuleHandlers(options: ResourceModuleOptions = {}) {
  return {
    skills: createSkillsResourceModuleHandler(),
    memory: createMemoryResourceModuleHandler(options.memory),
    capabilities: createCapabilitiesResourceModuleHandler(options.capabilities),
  } satisfies Record<'skills' | 'memory' | 'capabilities', ResourceModuleHandler>;
}

function skillsDescription(): ModuleDescription {
  return createModuleDescription({
    moduleId: SKILLS_MODULE_ID,
    title: 'Skills',
    summary: 'Read-only skill catalog resource; execution remains owned by the Agent Host skill/tool mechanism.',
    resources: [{
      kind: 'skill',
      refPrefix: 'skill:',
      queryable: true,
      readable: true,
      summary: 'Search skill id, label, description, and tags; read compact skill summaries.',
    }],
    facets: { refs: true },
    limits: { maxInlineBytes: 32_000, expectedLatencyMs: 100 },
  });
}

function memoryDescription(): ModuleDescription {
  return createModuleDescription({
    moduleId: MEMORY_MODULE_ID,
    title: 'Memory',
    summary: 'Fixture-backed project, session, and user memory resource surface with approval-gated mutation intents.',
    resources: [{
      kind: 'memory',
      refPrefix: 'memory:',
      queryable: true,
      readable: true,
      summary: 'Search and read compact summaries from caller-provided memory fixture refs.',
    }],
    intents: [
      { name: 'write', sideEffect: 'workspace', requiresApproval: true, summary: 'Return an approval and trace-friendly dry-run write result.' },
      { name: 'update', sideEffect: 'workspace', requiresApproval: true, summary: 'Return an approval and trace-friendly dry-run update result.' },
      { name: 'forget', sideEffect: 'workspace', requiresApproval: true, summary: 'Return an approval and trace-friendly dry-run forget result.' },
    ],
    facets: { refs: true, approval: true },
    limits: { maxInlineBytes: 32_000, expectedLatencyMs: 100 },
  });
}

function capabilitiesDescription(): ModuleDescription {
  return createModuleDescription({
    moduleId: CAPABILITIES_MODULE_ID,
    title: 'Capabilities',
    summary: 'Capability discovery resource for search, read, explain, plan, and expansion without execution.',
    resources: [{
      kind: 'capability',
      refPrefix: 'capability:',
      queryable: true,
      readable: true,
      summary: 'Search capability discovery and read compact capability summaries.',
    }],
    intents: [
      { name: 'search', sideEffect: 'none', summary: 'Run capability discovery search.' },
      { name: 'explain', sideEffect: 'none', summary: 'Explain selected discovery results or plans.' },
      { name: 'plan', sideEffect: 'none', summary: 'Build a discovery-only capability plan.' },
      { name: 'expand', sideEffect: 'none', summary: 'Expand selected capability details.' },
    ],
    facets: { refs: true },
    limits: { maxInlineBytes: 64_000, expectedLatencyMs: 200 },
  });
}

function skillQueryItem(skill: SkillPackageManifest) {
  return {
    ref: `skill:${skill.id}`,
    id: skill.id,
    label: skill.label,
    description: skill.description,
    tags: uniqueStrings(skill.tags),
  };
}

function skillReadSummary(skill: SkillPackageManifest) {
  return {
    ref: `skill:${skill.id}`,
    id: skill.id,
    label: skill.label,
    description: skill.description,
    tags: uniqueStrings(skill.tags),
    domains: uniqueStrings(skill.skillDomains),
    entrypointType: skill.entrypointType,
    input: {
      prompt: stringValue(skill.inputContract.prompt),
    },
    outputs: uniqueStrings(skill.outputArtifactTypes),
    requiredCapabilities: skill.requiredCapabilities.map((entry) => ({
      capability: entry.capability,
      level: entry.level,
    })),
    failureModes: uniqueStrings(skill.failureModes),
    useWhen: uniqueStrings(skill.examplePrompts).slice(0, 5),
    docs: {
      agentSummary: skill.docs.agentSummary,
    },
  };
}

function memoryQueryItem(memory: MemoryFixtureRef) {
  return {
    ref: memory.ref,
    scope: memory.scope,
    title: memory.title ?? memory.ref,
    summary: memory.summary,
    tags: memory.tags ?? [],
    updatedAt: memory.updatedAt,
  };
}

function memoryReadSummary(memory: MemoryFixtureRef, includeMeta: boolean) {
  return {
    ...memoryQueryItem(memory),
    contentExcerpt: includeMeta && memory.content ? excerpt(memory.content, EXCERPT_CHARS) : undefined,
    sourceRef: includeMeta ? memory.sourceRef : undefined,
  };
}

function memoryInvokeResult(
  request: ModuleInvokeRequest,
  fixtures: readonly MemoryFixtureRef[],
): ModuleResultEnvelope {
  const input = request.input ?? {};
  const targetRef = stringValue(input.ref) ?? stringValue(input.targetRef);
  if ((request.intent === 'update' || request.intent === 'forget') && !targetRef) {
    return fail(MEMORY_MODULE_ID, `missing_ref:${request.intent}`);
  }
  if (targetRef && !fixtures.some((fixture) => fixture.ref === targetRef)) {
    return fail(MEMORY_MODULE_ID, `memory_not_found:${targetRef}`);
  }

  const operationRef = `memory:operation:${digest({
    intent: request.intent,
    targetRef,
    input: publicMemoryInput(input),
    idempotencyKey: request.idempotencyKey,
  })}`;
  const proposedRef = targetRef ?? `memory:pending:${digest(publicMemoryInput(input))}`;
  const traceSummary = {
    intent: request.intent,
    targetRef,
    proposedRef,
    traceParent: request.traceParent,
    idempotencyKey: request.idempotencyKey,
    inputSummary: summarizePublicInput(input),
  };

  if (!request.approvalToken) {
    return moduleResult({
      moduleId: MEMORY_MODULE_ID,
      ok: false,
      operationRef,
      refs: targetRef ? [targetRef] : [proposedRef],
      approvalRequest: sanitizeForModule({
        moduleId: MEMORY_MODULE_ID,
        intent: request.intent,
        reason: 'approval_required',
        sideEffect: 'workspace',
        operationRef,
        traceSummary,
      }) as Record<string, unknown>,
      error: `approval_required:${request.intent}`,
    });
  }

  return ok(MEMORY_MODULE_ID, {
    status: 'accepted-not-persisted',
    persisted: false,
    intent: request.intent,
    ref: proposedRef,
    operationRef,
    traceSummary,
  }, [proposedRef], operationRef);
}

function capabilitySearchQuery(input: Record<string, unknown> | undefined): CapabilitySearchQuery {
  const data = input ?? {};
  const constraints = isRecord(data.constraints) ? data.constraints : {};
  return {
    goal: stringValue(data.goal) ?? stringValue(data.query) ?? 'capability discovery',
    currentContextRefs: stringArray(data.currentContextRefs),
    selectedRefs: stringArray(data.selectedRefs),
    desiredArtifacts: stringArray(data.desiredArtifacts),
    constraints: {
      latencyTier: latencyTier(data.constraints),
      allowedSideEffects: stringArray(constraints.allowedSideEffects),
      privacyProfile: stringValue(constraints.privacyProfile),
      maxCandidates: numberValue(constraints.maxCandidates),
    },
  };
}

function capabilityExplainQuery(input: Record<string, unknown> | undefined): CapabilityExplainQuery {
  const data = input ?? {};
  return {
    planId: stringValue(data.planId),
    capabilityIds: capabilityIds(data),
    audience: audience(data.audience),
  };
}

function capabilityPlanQuery(input: Record<string, unknown> | undefined): CapabilityPlanQuery {
  const data = input ?? {};
  return {
    goal: stringValue(data.goal) ?? 'capability plan',
    candidateIds: stringArray(data.candidateIds).length ? stringArray(data.candidateIds) : capabilityIds(data),
    contextRefs: stringArray(data.contextRefs),
    budget: isRecord(data.budget)
      ? {
          maxToolCalls: numberValue(data.budget.maxToolCalls),
          maxWallMs: numberValue(data.budget.maxWallMs),
          maxProviders: numberValue(data.budget.maxProviders),
        }
      : undefined,
  };
}

function capabilityExpandQuery(input: Record<string, unknown> | undefined): CapabilityExpandQuery {
  const data = input ?? {};
  return {
    capabilityIds: capabilityIds(data),
    include: includeValues(data.include),
    maxSchemaBytes: numberValue(data.maxSchemaBytes),
  };
}

function capabilityIds(data: Record<string, unknown>) {
  const fromArray = stringArray(data.capabilityIds);
  const fromCandidate = stringArray(data.candidateIds);
  const single = stringValue(data.capabilityId);
  return uniqueStrings([...fromArray, ...fromCandidate, ...(single ? [single] : [])]);
}

function includeValues(value: unknown): CapabilityExpandQuery['include'] {
  const allowed = new Set(['schemas', 'examples', 'providers', 'validators', 'repairHints', 'failureModes']);
  return stringArray(value).filter((entry): entry is NonNullable<CapabilityExpandQuery['include']>[number] => allowed.has(entry));
}

function audience(value: unknown): CapabilityExplainQuery['audience'] {
  if (value === 'debug' || value === 'audit') return value;
  return 'user';
}

function latencyTier(value: unknown): NonNullable<CapabilitySearchQuery['constraints']>['latencyTier'] {
  if (!isRecord(value)) return undefined;
  const tier = value.latencyTier;
  if (tier === 'instant' || tier === 'quick' || tier === 'bounded' || tier === 'deep' || tier === 'background') return tier;
  return undefined;
}

function publicMemoryInput(input: Record<string, unknown>) {
  return {
    ref: stringValue(input.ref) ?? stringValue(input.targetRef),
    scope: stringValue(input.scope),
    title: stringValue(input.title),
    summary: stringValue(input.summary) ?? summarizePublicInput(input),
    tags: stringArray(input.tags),
  };
}

function summarizePublicInput(input: Record<string, unknown>) {
  const explicitSummary = stringValue(input.summary);
  if (explicitSummary) return excerpt(explicitSummary, 160);
  const title = stringValue(input.title);
  if (title) return excerpt(title, 160);
  const content = stringValue(input.content);
  if (content) return excerpt(content, 160);
  return 'memory mutation request';
}

function ok<T>(
  moduleId: string,
  value: T,
  refs: string[] = [],
  operationRef?: string,
): ModuleResultEnvelope<T> {
  return moduleResult({
    moduleId,
    ok: true,
    value: sanitizeForModule(value) as T,
    refs: refs.map((ref) => sanitizeString(ref)),
    operationRef,
  });
}

function fail(moduleId: string, error: string): ModuleResultEnvelope {
  return moduleResult({
    moduleId,
    ok: false,
    error: sanitizeString(error),
  });
}

function matchesQuery(fields: readonly string[], query: string | undefined) {
  const terms = normalizedTerms(query);
  if (!terms.length) return true;
  const haystack = fields.join(' ').toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function normalizedTerms(query: string | undefined) {
  return (query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9_.\-\u4e00-\u9fff]+/iu)
    .map((term) => term.trim())
    .filter(Boolean);
}

function refId(ref: string, prefix: string) {
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : undefined;
}

function clampLimit(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((entry): entry is string => typeof entry === 'string'));
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function excerpt(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 12).trimEnd()} [truncated]`;
}

function digest(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(sanitizeForModule(value)))
    .digest('hex')
    .slice(0, 12);
}

function sanitizeForModule(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForModule);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveKey(key)) continue;
      const sanitized = sanitizeForModule(entry);
      if (sanitized !== undefined) out[key] = sanitized;
    }
    return out;
  }
  if (typeof value === 'string') return sanitizeString(value);
  return value;
}

function sanitizeString(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted-secret]')
    .replace(/\b(api[_-]?key|token|secret|password|authorization|credential)=([^&\s]+)/gi, '$1=[redacted-secret]')
    .replace(/https?:\/\/[^\s"')]+/gi, '[redacted-url]')
    .replace(/\/(?:Applications|Users|private|var|tmp)\/[^\s"')]+/gi, '[redacted-path]');
}

function isSensitiveKey(key: string) {
  return /endpoint|baseUrl|invokeUrl|url|auth|authorization|token|secret|password|credential|api[_-]?key|workspaceRoot|workspaceRoots|runtimeLocation|command|modelName|model/i.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
