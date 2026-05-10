import type { CapabilityManifest, CapabilityManifestKind, CapabilityProviderManifest } from '../../packages/contracts/runtime/capability-manifest.js';
import type { CapabilityBudget, HarnessCandidate } from '../../packages/agent-harness/src/contracts.js';

export interface UnifiedCapabilityGraphInput {
  manifests: CapabilityManifest[];
  preferredCapabilityIds?: string[];
  blockedCapabilityIds?: string[];
  availableProviders?: Array<string | { id: string; available: boolean; reason?: string }>;
  budgetByKind?: Partial<Record<HarnessCandidate['kind'], Partial<CapabilityBudget>>>;
}

export interface UnifiedCapabilityGraph {
  contract: 'sciforge.unified-capability-graph.v1';
  candidates: HarnessCandidate[];
  audit: Array<{
    id: string;
    manifestRef: string;
    kind: HarnessCandidate['kind'];
    score: number;
    reasons: string[];
    blocked?: string;
    providerAvailability: NonNullable<HarnessCandidate['providerAvailability']>;
    budget?: Partial<CapabilityBudget>;
    fallbackCandidateIds: string[];
  }>;
}

const DEFAULT_KIND_BUDGETS: Partial<Record<HarnessCandidate['kind'], Partial<CapabilityBudget>>> = {
  skill: { maxToolCalls: 4, maxRetries: 1, exhaustedPolicy: 'partial-payload' },
  tool: { maxToolCalls: 4, maxRetries: 1, exhaustedPolicy: 'partial-payload' },
  observe: { maxObserveCalls: 2, maxRetries: 1, exhaustedPolicy: 'partial-payload' },
  action: { maxActionSteps: 4, maxRetries: 1, exhaustedPolicy: 'fail-with-reason' },
  verifier: { maxRetries: 0, exhaustedPolicy: 'fail-with-reason' },
  view: { maxRetries: 0, exhaustedPolicy: 'partial-payload' },
  'runtime-adapter': { maxRetries: 1, exhaustedPolicy: 'fail-with-reason' },
  composed: { maxToolCalls: 8, maxProviders: 3, maxRetries: 2, exhaustedPolicy: 'partial-payload' },
};

export function projectCapabilityManifestsToHarnessCandidates(input: UnifiedCapabilityGraphInput): UnifiedCapabilityGraph {
  const preferred = new Set(input.preferredCapabilityIds ?? []);
  const blocked = new Set(input.blockedCapabilityIds ?? []);
  const providerAvailability = normalizeAvailableProviders(input.availableProviders);
  const audit = input.manifests
    .map((manifest) => auditRecordForManifest(manifest, {
      preferred,
      blocked,
      providerAvailability,
      budgetByKind: input.budgetByKind ?? {},
    }))
    .sort((left, right) => right.score - left.score || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));

  return {
    contract: 'sciforge.unified-capability-graph.v1',
    candidates: audit
      .filter((entry) => !entry.blocked)
      .map((entry) => ({
        kind: entry.kind,
        id: entry.id,
        manifestRef: entry.manifestRef,
        score: entry.score,
        reasons: entry.reasons,
        providerAvailability: entry.providerAvailability,
        budget: entry.budget,
        fallbackCandidateIds: entry.fallbackCandidateIds,
      })),
    audit,
  };
}

function auditRecordForManifest(
  manifest: CapabilityManifest,
  context: {
    preferred: Set<string>;
    blocked: Set<string>;
    providerAvailability: Map<string, string | true>;
    budgetByKind: Partial<Record<HarnessCandidate['kind'], Partial<CapabilityBudget>>>;
  },
): UnifiedCapabilityGraph['audit'][number] {
  const kind = harnessCandidateKindForManifest(manifest);
  const providerAvailability = manifest.providers.map((provider) => providerAvailabilityFor(provider, context.providerAvailability));
  const unavailableProviders = providerAvailability.filter((provider) => !provider.available);
  const fallbackCandidateIds = fallbackCandidateIdsForManifest(manifest);
  const reasons = [
    `manifest kind:${manifest.kind}`,
    `owner:${manifest.ownerPackage}`,
    ...manifest.routingTags.slice(0, 4).map((tag) => `routing:${tag}`),
  ];
  let score = manifest.lifecycle.status === 'published' ? 20 : manifest.lifecycle.status === 'validated' ? 16 : 10;
  score += manifest.providers.length;
  score += manifest.validators.length;
  if (context.preferred.has(manifest.id)) {
    score += 30;
    reasons.push('preferred by harness/caller');
  }
  const blocked = context.blocked.has(manifest.id)
    ? 'blocked by harness/caller'
    : unavailableProviders.length === manifest.providers.length && providerAvailability.length > 0
      ? `provider unavailable: ${unavailableProviders[0]?.reason ?? 'unavailable'}`
      : undefined;
  const budget = {
    ...(DEFAULT_KIND_BUDGETS[kind] ?? {}),
    ...budgetFromManifestMetadata(manifest),
    ...(context.budgetByKind[kind] ?? {}),
  };
  return {
    id: manifest.id,
    manifestRef: `capability:${manifest.id}@${manifest.version}`,
    kind,
    score: blocked ? 0 : score,
    reasons: blocked ? [...reasons, blocked] : reasons,
    blocked,
    providerAvailability,
    budget,
    fallbackCandidateIds,
  };
}

function harnessCandidateKindForManifest(manifest: CapabilityManifest): HarnessCandidate['kind'] {
  const metadataKind = typeof manifest.metadata?.harnessKind === 'string' ? manifest.metadata.harnessKind : undefined;
  if (metadataKind === 'tool') return 'tool';
  if (manifest.kind === 'importer' || manifest.kind === 'exporter' || manifest.kind === 'memory') return 'runtime-adapter';
  return manifest.kind as Exclude<CapabilityManifestKind, 'importer' | 'exporter' | 'memory'>;
}

function providerAvailabilityFor(provider: CapabilityProviderManifest, availability: Map<string, string | true>) {
  if (!availability.size) return { providerId: provider.id, available: true };
  const value = availability.get(provider.id);
  return {
    providerId: provider.id,
    available: value === true,
    reason: typeof value === 'string' ? value : undefined,
  };
}

function normalizeAvailableProviders(input: UnifiedCapabilityGraphInput['availableProviders']) {
  const result = new Map<string, string | true>();
  for (const provider of input ?? []) {
    if (typeof provider === 'string') {
      result.set(provider, true);
    } else {
      result.set(provider.id, provider.available ? true : provider.reason ?? 'unavailable');
    }
  }
  return result;
}

function fallbackCandidateIdsForManifest(manifest: CapabilityManifest) {
  return uniqueStrings([
    ...stringList(manifest.metadata?.fallbackCandidateIds),
    ...(manifest.lifecycle.replaces ?? []),
  ]);
}

function budgetFromManifestMetadata(manifest: CapabilityManifest): Partial<CapabilityBudget> {
  const raw = isRecord(manifest.metadata?.budget) ? manifest.metadata.budget : {};
  const out: Partial<CapabilityBudget> = {};
  for (const key of [
    'maxWallMs',
    'maxContextTokens',
    'maxToolCalls',
    'maxObserveCalls',
    'maxActionSteps',
    'maxNetworkCalls',
    'maxDownloadBytes',
    'maxResultItems',
    'maxProviders',
    'maxRetries',
    'perProviderTimeoutMs',
    'costUnits',
  ] as const) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  if (raw.exhaustedPolicy === 'partial-payload' || raw.exhaustedPolicy === 'needs-human' || raw.exhaustedPolicy === 'fail-with-reason') {
    out.exhaustedPolicy = raw.exhaustedPolicy;
  }
  return out;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
