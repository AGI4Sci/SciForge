import { createHash } from 'node:crypto';
import type {
  CapabilityBrief,
  CapabilityCostClass,
  CapabilityLatencyClass,
  CapabilitySideEffectClass,
  LatencyTier,
  SideEffectAllowance,
  StartupContextEnvelope,
  StartupContextInvalidationReason,
  StartupContextSection,
  StartupExpansionRef,
} from './contracts';

export interface BuildStartupContextEnvelopeInput {
  workspaceRoot: string;
  generatedAt?: string;
  ttlMs?: number;
  previousEnvelope?: StartupContextEnvelope;
  session?: {
    sessionId?: string;
    runId?: string;
    backend?: string;
    currentPrompt?: string;
  };
  scenario?: {
    skillDomain?: string;
    scenarioPackageRef?: string;
    expectedArtifactTypes?: string[];
    selectedComponentIds?: string[];
  };
  budget?: {
    latencyTier?: LatencyTier;
    maxPromptTokens?: number;
    maxToolCalls?: number;
    maxWallMs?: number;
  };
  permissions?: {
    network?: SideEffectAllowance;
    workspaceWrite?: SideEffectAllowance;
    externalMutation?: SideEffectAllowance;
    codeExecution?: SideEffectAllowance;
  };
  currentRefs?: string[];
  artifactRefs?: string[];
  recentExecutionRefs?: string[];
  recentRuns?: Array<{ id?: string; ref?: string; status?: string; hash?: string }>;
  capabilityBriefs?: StartupCapabilityBriefInput[];
  sourceRefs?: string[];
  policyReminders?: string[];
  invalidationKeys?: string[];
}

export interface StartupCapabilityBriefInput {
  id: string;
  name?: string;
  purpose?: string;
  manifestRef?: string;
  expansionRef?: string;
  inputRefs?: string[];
  outputRefs?: string[];
  costClass?: CapabilityCostClass;
  latencyClass?: CapabilityLatencyClass;
  sideEffectClass?: CapabilitySideEffectClass;
  artifactTypes?: string[];
  viewTypes?: string[];
  verifierTypes?: string[];
  sourceRef?: string;
  hash?: string;
}

const STARTUP_CONTEXT_TTL_MS = 10 * 60 * 1000;

export function buildStartupContextEnvelope(input: BuildStartupContextEnvelopeInput): StartupContextEnvelope {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const ttlMs = input.ttlMs ?? STARTUP_CONTEXT_TTL_MS;
  const validUntil = new Date(Date.parse(generatedAt) + ttlMs).toISOString();
  const sourceHashes = startupContextSourceHashes(input);
  const cacheKey = stableHash({
    schemaVersion: 'sciforge.startup-context-envelope.v1',
    workspaceRoot: input.workspaceRoot,
    sessionId: input.session?.sessionId,
    runId: input.session?.runId,
    scenario: input.scenario,
    budget: input.budget,
    permissions: input.permissions,
    sourceHashes,
  });
  const previousEnvelope = input.previousEnvelope;
  if (previousEnvelope && startupContextCacheHit(previousEnvelope, cacheKey, generatedAt)) {
    return previousEnvelope;
  }

  const sourceRefs = uniqueStrings([
    `workspace:${input.workspaceRoot}`,
    input.session?.sessionId ? `session:${input.session.sessionId}` : undefined,
    input.session?.runId ? `run:${input.session.runId}` : undefined,
    input.scenario?.skillDomain ? `scenario:${input.scenario.skillDomain}` : undefined,
    ...(input.sourceRefs ?? []),
  ]);
  const capabilityBriefs = normalizeCapabilityBriefs(input.capabilityBriefs ?? []);
  const expansionEntries = startupExpansionEntries(capabilityBriefs, input);
  const coveredRefs = uniqueStrings([
    ...sourceRefs,
    ...(input.currentRefs ?? []),
    ...(input.artifactRefs ?? []),
    ...(input.recentExecutionRefs ?? []),
    ...(input.recentRuns ?? []).flatMap((run) => [run.ref, run.id].filter((entry): entry is string => Boolean(entry))),
  ]);
  const sections = startupSections({
    hasArtifacts: Boolean(input.artifactRefs?.length),
    hasRecentRuns: Boolean(input.recentRuns?.length || input.recentExecutionRefs?.length),
    hasCapabilityBriefs: capabilityBriefs.length > 0,
    policyReminderCount: policyReminders(input.policyReminders).length,
  });
  const hash = stableHash({
    sourceRefs,
    sourceHashes,
    workspace: input.workspaceRoot,
    session: input.session,
    scenario: input.scenario,
    currentRefs: input.currentRefs,
    artifactRefs: input.artifactRefs,
    recentExecutionRefs: input.recentExecutionRefs,
    recentRuns: input.recentRuns,
    capabilityBriefs,
    sections,
  });

  return {
    schemaVersion: 'sciforge.startup-context-envelope.v1',
    envelopeId: `startup:${hash}`,
    generatedAt,
    ttlMs,
    hash,
    sourceRefs,
    workspace: {
      root: input.workspaceRoot,
    },
    session: {
      sessionId: input.session?.sessionId,
      runId: input.session?.runId,
      backend: input.session?.backend,
    },
    budget: {
      latencyTier: input.budget?.latencyTier ?? 'quick',
      maxPromptTokens: input.budget?.maxPromptTokens ?? 1200,
      maxToolCalls: input.budget?.maxToolCalls ?? 2,
    },
    alwaysOnFacts: pruneUndefined({
      workspaceRoot: input.workspaceRoot,
      sciforgeDirs: ['.sciforge/tasks/', '.sciforge/task-results/', '.sciforge/logs/', '.sciforge/artifacts/'],
      currentPromptHash: input.session?.currentPrompt ? stableHash(input.session.currentPrompt) : undefined,
      scenario: input.scenario,
      permissions: {
        network: input.permissions?.network ?? 'requires-approval',
        workspaceWrite: input.permissions?.workspaceWrite ?? 'requires-approval',
        externalMutation: input.permissions?.externalMutation ?? 'requires-approval',
        codeExecution: input.permissions?.codeExecution ?? 'requires-approval',
      },
      keyRefs: {
        currentRefs: uniqueStrings(input.currentRefs ?? []).slice(0, 12),
        artifactRefs: uniqueStrings(input.artifactRefs ?? []).slice(0, 12),
        recentExecutionRefs: uniqueStrings(input.recentExecutionRefs ?? []).slice(0, 12),
      },
    }) as Record<string, unknown>,
    capabilityBriefIndex: {
      schemaVersion: 'sciforge.capability-brief-index.v1',
      generatedAt,
      sourceRefs: uniqueStrings([
        'sciforge.agentserver.capability-broker-brief.v1',
        ...capabilityBriefs.map((brief) => brief.manifestRef),
      ]),
      briefs: capabilityBriefs,
    },
    sections,
    policyReminders: policyReminders(input.policyReminders),
    invalidationKeys: uniqueStrings([
      `workspace:${input.workspaceRoot}`,
      `session:${input.session?.sessionId ?? 'none'}`,
      `run:${input.session?.runId ?? 'none'}`,
      `capabilityBriefs:${sourceHashes.capabilityBriefs}`,
      `artifacts:${sourceHashes.artifactRefs}`,
      ...(input.invalidationKeys ?? []),
    ]),
    cache: {
      cacheKey,
      validUntil,
      sourceHashes,
      invalidatesOn: ['workspace-changed', 'capability-registry-changed', 'session-changed', 'run-changed', 'ttl-expired', 'source-ref-changed'],
    },
    onDemandExpansion: {
      schemaVersion: 'sciforge.startup-context.on-demand-expansion.v1',
      defaultPolicy: 'expand-selected-ref-only',
      entries: expansionEntries,
    },
    noDuplicateExplorationGuard: {
      schemaVersion: 'sciforge.startup-context.no-duplicate-exploration-guard.v1',
      coveredFacts: [
        'workspace root',
        'session/run refs',
        'current refs',
        'artifact refs',
        'recent execution refs',
        'capability brief index',
      ],
      coveredRefs,
      skipExpensiveExplorationBeforeExpansion: true,
      duplicateExplorationStopReasons: [
        'startup envelope already names the workspace root',
        'startup envelope already carries current/artifact/recent refs',
        'startup envelope already carries compact capability briefs',
        'expand the selected ref before scanning full manifests or workspace history',
      ],
    },
  };
}

export function startupContextCacheHit(envelope: StartupContextEnvelope | undefined, cacheKey: string, now = new Date().toISOString()) {
  if (!envelope?.cache) return false;
  if (envelope.cache.cacheKey !== cacheKey) return false;
  return Date.parse(envelope.cache.validUntil) > Date.parse(now);
}

export function startupContextInvalidationReasons(
  envelope: StartupContextEnvelope,
  input: BuildStartupContextEnvelopeInput,
  now = new Date().toISOString(),
): StartupContextInvalidationReason[] {
  const reasons: StartupContextInvalidationReason[] = [];
  const nextHashes = startupContextSourceHashes(input);
  if (envelope.workspace.root !== input.workspaceRoot) reasons.push('workspace-changed');
  if (envelope.session.sessionId !== input.session?.sessionId) reasons.push('session-changed');
  if (envelope.session.runId !== input.session?.runId) reasons.push('run-changed');
  if (envelope.cache?.sourceHashes.capabilityBriefs !== nextHashes.capabilityBriefs) reasons.push('capability-registry-changed');
  if (envelope.cache?.sourceHashes.artifactRefs !== nextHashes.artifactRefs) reasons.push('source-ref-changed');
  if (envelope.cache && Date.parse(envelope.cache.validUntil) <= Date.parse(now)) reasons.push('ttl-expired');
  return uniqueStrings(reasons) as StartupContextInvalidationReason[];
}

export function startupContextExpansionRef(envelope: StartupContextEnvelope, targetId: string): StartupExpansionRef | undefined {
  return envelope.onDemandExpansion?.entries.find((entry) => entry.targetId === targetId || entry.ref === targetId);
}

function normalizeCapabilityBriefs(values: StartupCapabilityBriefInput[]): CapabilityBrief[] {
  const seen = new Set<string>();
  const out: CapabilityBrief[] = [];
  for (const value of values) {
    const id = value.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const artifactTypes = value.artifactTypes ?? [];
    const viewTypes = value.viewTypes ?? [];
    const verifierTypes = value.verifierTypes ?? [];
    out.push({
      id,
      name: value.name?.trim() || id,
      purpose: clip(value.purpose, 220) ?? 'Capability brief from manifest registry.',
      inputRefs: uniqueStrings(value.inputRefs ?? []).slice(0, 8),
      outputRefs: uniqueStrings([
        ...(value.outputRefs ?? []),
        ...artifactTypes.map((type) => `artifact-type:${type}`),
        ...viewTypes.map((type) => `view:${type}`),
        ...verifierTypes.map((type) => `verifier:${type}`),
      ]).slice(0, 12),
      costClass: value.costClass ?? 'low',
      latencyClass: value.latencyClass ?? 'short',
      sideEffectClass: value.sideEffectClass ?? 'read',
      manifestRef: value.manifestRef ?? `capability:${id}`,
      expansionRef: value.expansionRef ?? `startup-context://capability/${encodeURIComponent(id)}/manifest`,
    });
  }
  return out.slice(0, 24);
}

function startupExpansionEntries(capabilityBriefs: CapabilityBrief[], input: BuildStartupContextEnvelopeInput): StartupExpansionRef[] {
  const capabilityEntries = capabilityBriefs.map((brief): StartupExpansionRef => ({
    ref: brief.expansionRef,
    kind: 'capability-manifest',
    targetId: brief.id,
    sourceRef: brief.manifestRef,
    hash: stableHash(brief),
    summary: brief.purpose,
  }));
  const artifactEntry: StartupExpansionRef | undefined = input.artifactRefs?.length
    ? {
        ref: 'startup-context://artifact-index/current',
        kind: 'artifact-index',
        targetId: 'artifact-index',
        hash: stableHash(input.artifactRefs),
        summary: 'Expand only when the selected task needs more artifact detail than current refs provide.',
      }
    : undefined;
  const runEntry: StartupExpansionRef | undefined = input.recentRuns?.length
    ? {
        ref: 'startup-context://recent-runs/current',
        kind: 'run-record',
        targetId: 'recent-runs',
        hash: stableHash(input.recentRuns),
        summary: 'Expand only for continuation, repair, audit, or explicit rerun requests.',
      }
    : undefined;
  return [...capabilityEntries, artifactEntry, runEntry].filter((entry): entry is StartupExpansionRef => Boolean(entry));
}

function startupSections(input: {
  hasArtifacts: boolean;
  hasRecentRuns: boolean;
  hasCapabilityBriefs: boolean;
  policyReminderCount: number;
}): StartupContextSection[] {
  return [
    { id: 'always-on-tiny-context', kind: 'always-on', ref: 'startup-context://always-on', tokenEstimate: 220, expandOnDemand: false },
    input.hasCapabilityBriefs
      ? { id: 'capability-brief-index', kind: 'capability-brief-index', ref: 'startup-context://capabilities', tokenEstimate: 420, expandOnDemand: true }
      : undefined,
    input.hasArtifacts
      ? { id: 'artifact-index', kind: 'artifact-index', ref: 'startup-context://artifact-index/current', tokenEstimate: 180, expandOnDemand: true }
      : undefined,
    input.hasRecentRuns
      ? { id: 'recent-runs', kind: 'recent-runs', ref: 'startup-context://recent-runs/current', tokenEstimate: 160, expandOnDemand: true }
      : undefined,
    input.policyReminderCount
      ? { id: 'policy-reminders', kind: 'policy-reminders', ref: 'startup-context://policy-reminders', tokenEstimate: 120, expandOnDemand: false }
      : undefined,
  ].filter((entry): entry is StartupContextSection => Boolean(entry));
}

function startupContextSourceHashes(input: BuildStartupContextEnvelopeInput) {
  return {
    workspace: stableHash(input.workspaceRoot),
    session: stableHash(input.session ?? {}),
    scenario: stableHash(input.scenario ?? {}),
    currentRefs: stableHash(input.currentRefs ?? []),
    artifactRefs: stableHash(input.artifactRefs ?? []),
    recentExecutionRefs: stableHash(input.recentExecutionRefs ?? []),
    recentRuns: stableHash(input.recentRuns ?? []),
    capabilityBriefs: stableHash(input.capabilityBriefs ?? []),
    policyReminders: stableHash(policyReminders(input.policyReminders)),
  };
}

function policyReminders(values: string[] | undefined) {
  return uniqueStrings([
    ...(values ?? []),
    'Use the current user request as authoritative.',
    'Reuse startup refs before scanning workspace history.',
    'Keep full manifests, logs, docs, and artifact bodies lazy until selected.',
    'Do not duplicate expensive exploration already covered by the startup context envelope.',
  ]).slice(0, 12);
}

function stableHash(value: unknown) {
  return createHash('sha1').update(stableJson(value)).digest('hex').slice(0, 16);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function clip(value: string | undefined, maxLength: number) {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function pruneUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pruneUndefined);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    out[key] = pruneUndefined(entry);
  }
  return out;
}
