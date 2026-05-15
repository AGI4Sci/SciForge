import {
  CAPABILITY_MANIFEST_CONTRACT_ID,
  type CapabilityManifest,
  type CapabilityManifestRisk,
  type CapabilityManifestSideEffect,
} from '../../packages/contracts/runtime/capability-manifest.js';
import { loadCoreCapabilityManifestRegistry } from './capability-manifest-registry.js';
import type { CapabilityBudget, HarnessCandidate } from '../../packages/agent-harness/src/contracts.js';
import {
  scoreSkillByPackagePolicy,
  skillAllowedByPackagePolicy,
  type MatchableSkillManifest,
  type SkillDomain,
} from '../../packages/skills/matching-policy.js';
import {
  projectCapabilityManifestsToHarnessCandidates,
  type UnifiedCapabilityGraph,
  type UnifiedCapabilityGraphInput,
} from './capability-harness-candidates.js';

export type HarnessDefaultCandidateClass =
  | 'skill-package-policy'
  | 'tool-package-manifest'
  | 'observe-provider-selection'
  | 'computer-use-action-plan';

export type HarnessDefaultProviderAvailability =
  NonNullable<UnifiedCapabilityGraphInput['availableProviders']>[number];

export interface HarnessDefaultCallbackProjection {
  manifests: CapabilityManifest[];
  preferredCapabilityIds?: string[];
  blockedCapabilityIds?: string[];
  availableProviders?: HarnessDefaultProviderAvailability[];
  scoreAdjustments?: Record<string, number>;
  sourceReasons?: Record<string, string[]>;
  actionPlanSteps?: Record<string, number>;
  auditNotes?: string[];
}

export interface HarnessDefaultCandidateCallback {
  id: string;
  capabilityClass: HarnessDefaultCandidateClass;
  project(): HarnessDefaultCallbackProjection;
}

export interface HarnessDefaultCandidateCallbacksInput {
  callbacks: HarnessDefaultCandidateCallback[];
  preferredCapabilityIds?: string[];
  blockedCapabilityIds?: string[];
  availableProviders?: HarnessDefaultProviderAvailability[];
  budgetByKind?: Partial<Record<HarnessCandidate['kind'], Partial<CapabilityBudget>>>;
  riskTolerance?: CapabilityManifestRisk;
  humanApprovedCapabilityIds?: string[];
}

export interface HarnessDefaultCandidateProjection {
  contract: 'sciforge.harness-default-candidates.v1';
  candidates: HarnessCandidate[];
  audit: Array<{
    id: string;
    manifestRef: string;
    kind: HarnessCandidate['kind'];
    capabilityClasses: HarnessDefaultCandidateClass[];
    score: number;
    reasons: string[];
    gate: 'passed' | 'blocked';
    blocked?: string;
    providerAvailability: NonNullable<HarnessCandidate['providerAvailability']>;
    budget?: Partial<CapabilityBudget>;
    fallbackCandidateIds: string[];
  }>;
  graph: UnifiedCapabilityGraph;
  callbackAudit: Array<{
    callbackId: string;
    capabilityClass: HarnessDefaultCandidateClass;
    manifestIds: string[];
    preferredCapabilityIds: string[];
    blockedCapabilityIds: string[];
    auditNotes: string[];
  }>;
}

export interface SkillPackagePolicyCallbackInput {
  id?: string;
  skills: Array<{
    id: string;
    available?: boolean;
    reason?: string;
    manifest: MatchableSkillManifest;
  }>;
  skillDomain: SkillDomain;
  prompt: string;
  explicitSkillIds?: string[];
}

export interface ToolPackageManifestCallbackInput {
  id?: string;
  manifests: CapabilityManifest[];
  explicitCapabilityIds?: string[];
  providerAvailability?: HarnessDefaultProviderAvailability[];
}

export interface ObserveProviderSelectionCallbackInput {
  id?: string;
  selectedSenseIds: string[];
  manifests?: CapabilityManifest[];
  providerAvailability?: HarnessDefaultProviderAvailability[];
}

export interface ComputerUseActionPlanCallbackInput {
  id?: string;
  actionPlan: {
    id?: string;
    providerId?: string;
    actions: Array<{
      type?: string;
      riskLevel?: 'low' | 'medium' | 'high';
      requiresConfirmation?: boolean;
    }>;
  };
  manifest?: CapabilityManifest;
  providerAvailability?: HarnessDefaultProviderAvailability[];
}

const RISK_RANK: Record<CapabilityManifestRisk, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export function buildSkillPackagePolicyCandidateCallback(
  input: SkillPackagePolicyCallbackInput,
): HarnessDefaultCandidateCallback {
  return {
    id: input.id ?? 'skill-package-policy',
    capabilityClass: 'skill-package-policy',
    project() {
      const prompt = input.prompt.toLowerCase();
      const explicit = new Set(input.explicitSkillIds ?? []);
      const manifests: CapabilityManifest[] = [];
      const preferredCapabilityIds: string[] = [];
      const blockedCapabilityIds: string[] = [];
      const availableProviders: HarnessDefaultProviderAvailability[] = [];
      const scoreAdjustments: Record<string, number> = {};
      const sourceReasons: Record<string, string[]> = {};
      const auditNotes: string[] = [];

      for (const skill of input.skills) {
        const score = scoreSkillByPackagePolicy(skill.manifest, input.skillDomain, prompt);
        const allowed = skillAllowedByPackagePolicy(skill, prompt);
        if (score <= 0 && !explicit.has(skill.id)) continue;
        manifests.push(skillManifestToCapabilityManifest(skill.manifest, skill.id));
        scoreAdjustments[skill.id] = Math.round(score);
        sourceReasons[skill.id] = [
          `scoreSkillByPackagePolicy=${score.toFixed(1)}`,
          `skill available=${skill.available !== false}`,
        ];
        availableProviders.push({
          id: skillProviderId(skill.id),
          available: skill.available !== false,
          reason: skill.available === false ? skill.reason ?? 'skill unavailable' : undefined,
        });
        if (explicit.has(skill.id)) preferredCapabilityIds.push(skill.id);
        if (!allowed) {
          blockedCapabilityIds.push(skill.id);
          auditNotes.push(`${skill.id} blocked by skillAllowedByPackagePolicy`);
        }
      }

      return {
        manifests,
        preferredCapabilityIds,
        blockedCapabilityIds,
        availableProviders,
        scoreAdjustments,
        sourceReasons,
        auditNotes,
      };
    },
  };
}

export function buildToolPackageManifestCandidateCallback(
  input: ToolPackageManifestCallbackInput,
): HarnessDefaultCandidateCallback {
  return {
    id: input.id ?? 'tool-package-manifest',
    capabilityClass: 'tool-package-manifest',
    project() {
      const scoreAdjustments: Record<string, number> = {};
      const sourceReasons: Record<string, string[]> = {};
      for (const manifest of input.manifests) {
        scoreAdjustments[manifest.id] = manifest.ownerPackage.startsWith('@') || manifest.ownerPackage.startsWith('packages/')
          ? 12
          : 6;
        sourceReasons[manifest.id] = [
          `tool package manifest:${manifest.ownerPackage}`,
          `provider count:${manifest.providers.length}`,
        ];
      }
      return {
        manifests: input.manifests,
        preferredCapabilityIds: input.explicitCapabilityIds,
        availableProviders: input.providerAvailability,
        scoreAdjustments,
        sourceReasons,
      };
    },
  };
}

export function buildObserveProviderSelectionCandidateCallback(
  input: ObserveProviderSelectionCallbackInput,
): HarnessDefaultCandidateCallback {
  return {
    id: input.id ?? 'observe-provider-selection',
    capabilityClass: 'observe-provider-selection',
    project() {
      const manifests = input.selectedSenseIds.map((selectedId) => {
        return findManifestByIdOrProvider(input.manifests ?? defaultCapabilityManifests(), selectedId)
          ?? synthesizeObserveManifest(selectedId);
      });
      const sourceReasons = Object.fromEntries(
        manifests.map((manifest, index) => [
          manifest.id,
          [`observe provider selected:${input.selectedSenseIds[index]}`],
        ]),
      );
      return {
        manifests,
        preferredCapabilityIds: manifests.map((manifest) => manifest.id),
        availableProviders: input.providerAvailability ?? input.selectedSenseIds,
        scoreAdjustments: Object.fromEntries(manifests.map((manifest) => [manifest.id, 18])),
        sourceReasons,
      };
    },
  };
}

export function buildComputerUseActionPlanCandidateCallback(
  input: ComputerUseActionPlanCallbackInput,
): HarnessDefaultCandidateCallback {
  return {
    id: input.id ?? 'computer-use-action-plan',
    capabilityClass: 'computer-use-action-plan',
    project() {
      const manifest = input.manifest ?? computerUseManifestFromCore() ?? synthesizeComputerUseManifest(input.actionPlan);
      const actionCount = input.actionPlan.actions.length;
      const highRiskActions = input.actionPlan.actions.filter((action) => action.riskLevel === 'high').length;
      return {
        manifests: [manifest],
        preferredCapabilityIds: [manifest.id],
        availableProviders: input.providerAvailability ?? [input.actionPlan.providerId ?? manifest.providers[0]?.id ?? 'sciforge.core.action.computer-use'],
        scoreAdjustments: { [manifest.id]: actionCount * 4 + (highRiskActions > 0 ? 8 : 0) },
        sourceReasons: {
          [manifest.id]: [
            `computer-use action plan:${input.actionPlan.id ?? 'anonymous'}`,
            `action steps:${actionCount}`,
            `high risk actions:${highRiskActions}`,
          ],
        },
        actionPlanSteps: { [manifest.id]: actionCount },
      };
    },
  };
}

export function projectHarnessDefaultCandidateCallbacks(
  input: HarnessDefaultCandidateCallbacksInput,
): HarnessDefaultCandidateProjection {
  const projected = input.callbacks.map((callback) => ({
    callback,
    projection: callback.project(),
  }));
  const manifests = uniqueManifests(projected.flatMap((item) => item.projection.manifests));
  const preferredCapabilityIds = uniqueStrings([
    ...(input.preferredCapabilityIds ?? []),
    ...projected.flatMap((item) => item.projection.preferredCapabilityIds ?? []),
  ]);
  const blockedCapabilityIds = uniqueStrings([
    ...(input.blockedCapabilityIds ?? []),
    ...projected.flatMap((item) => item.projection.blockedCapabilityIds ?? []),
  ]);
  const availableProviders = mergeProviderAvailability([
    ...(input.availableProviders ?? []),
    ...projected.flatMap((item) => item.projection.availableProviders ?? []),
  ]);
  const scoreAdjustments = mergeNumberMaps(projected.map((item) => item.projection.scoreAdjustments ?? {}));
  const sourceReasons = mergeStringListMaps(projected.map((item) => item.projection.sourceReasons ?? {}));
  const actionPlanSteps = mergeNumberMaps(projected.map((item) => item.projection.actionPlanSteps ?? {}));
  const classByManifestId = new Map<string, Set<HarnessDefaultCandidateClass>>();
  for (const item of projected) {
    for (const manifest of item.projection.manifests) {
      const classes = classByManifestId.get(manifest.id) ?? new Set<HarnessDefaultCandidateClass>();
      classes.add(item.callback.capabilityClass);
      classByManifestId.set(manifest.id, classes);
    }
  }
  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const graph = projectCapabilityManifestsToHarnessCandidates({
    manifests,
    preferredCapabilityIds,
    blockedCapabilityIds,
    availableProviders,
    budgetByKind: input.budgetByKind,
  });

  const passed: HarnessCandidate[] = [];
  const audit = graph.audit.map((entry) => {
    const manifest = manifestById.get(entry.id);
    const gateReason = manifest
      ? defaultCandidateGateReason({
        manifest,
        candidateKind: entry.kind,
        graphBlocked: entry.blocked,
        availableProviders,
        budgetByKind: input.budgetByKind,
        riskTolerance: input.riskTolerance ?? 'medium',
        humanApprovedCapabilityIds: input.humanApprovedCapabilityIds ?? [],
        actionPlanSteps: actionPlanSteps[entry.id],
      })
      : 'missing manifest';
    const score = gateReason ? 0 : entry.score + (scoreAdjustments[entry.id] ?? 0);
    const reasons = uniqueStrings([
      ...entry.reasons,
      ...(sourceReasons[entry.id] ?? []),
      ...(preferredCapabilityIds.includes(entry.id) ? ['explicit selection raises priority only'] : []),
    ]);
    const record = {
      id: entry.id,
      manifestRef: entry.manifestRef,
      kind: entry.kind,
      capabilityClasses: [...(classByManifestId.get(entry.id) ?? new Set<HarnessDefaultCandidateClass>())].sort(),
      score,
      reasons,
      gate: gateReason ? 'blocked' as const : 'passed' as const,
      blocked: gateReason,
      providerAvailability: entry.providerAvailability,
      budget: entry.budget,
      fallbackCandidateIds: entry.fallbackCandidateIds,
    };
    if (!gateReason) {
      passed.push({
        kind: entry.kind,
        id: entry.id,
        manifestRef: entry.manifestRef,
        score,
        reasons,
        providerAvailability: entry.providerAvailability,
        budget: entry.budget,
        fallbackCandidateIds: entry.fallbackCandidateIds,
      });
    }
    return record;
  });

  return {
    contract: 'sciforge.harness-default-candidates.v1',
    candidates: passed.sort(compareHarnessCandidates),
    audit: audit.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)),
    graph,
    callbackAudit: projected.map((item) => ({
      callbackId: item.callback.id,
      capabilityClass: item.callback.capabilityClass,
      manifestIds: uniqueStrings(item.projection.manifests.map((manifest) => manifest.id)),
      preferredCapabilityIds: uniqueStrings(item.projection.preferredCapabilityIds ?? []),
      blockedCapabilityIds: uniqueStrings(item.projection.blockedCapabilityIds ?? []),
      auditNotes: [...(item.projection.auditNotes ?? [])],
    })),
  };
}

function defaultCandidateGateReason(input: {
  manifest: CapabilityManifest;
  candidateKind: HarnessCandidate['kind'];
  graphBlocked?: string;
  availableProviders: HarnessDefaultProviderAvailability[];
  budgetByKind?: Partial<Record<HarnessCandidate['kind'], Partial<CapabilityBudget>>>;
  riskTolerance: CapabilityManifestRisk;
  humanApprovedCapabilityIds: string[];
  actionPlanSteps?: number;
}) {
  if (input.graphBlocked) return input.graphBlocked;
  if (RISK_RANK[input.manifest.safety.risk] > RISK_RANK[input.riskTolerance]) {
    return `risk ${input.manifest.safety.risk} exceeds ${input.riskTolerance} tolerance`;
  }
  if (input.manifest.safety.requiresHumanApproval && !input.humanApprovedCapabilityIds.includes(input.manifest.id)) {
    return 'human approval required by capability safety policy';
  }
  const configReason = requiredConfigGateReason(input.manifest, input.availableProviders);
  if (configReason) return configReason;
  return budgetGateReason(input.manifest, input.candidateKind, input.budgetByKind?.[input.candidateKind], input.actionPlanSteps);
}

function requiredConfigGateReason(manifest: CapabilityManifest, availableProviders: HarnessDefaultProviderAvailability[]) {
  const providersWithConfig = manifest.providers.filter((provider) => provider.requiredConfig.length > 0);
  if (providersWithConfig.length === 0) return undefined;
  const availability = normalizeAvailableProviders(availableProviders);
  if (availability.size === 0) return 'provider config not advertised';
  const configuredProvider = providersWithConfig.find((provider) => availability.get(provider.id) === true);
  if (configuredProvider) return undefined;
  const unavailableReason = providersWithConfig
    .map((provider) => availability.get(provider.id))
    .find((value): value is string => typeof value === 'string');
  return unavailableReason ? `provider config unavailable: ${unavailableReason}` : 'provider config not advertised';
}

function budgetGateReason(
  manifest: CapabilityManifest,
  candidateKind: HarnessCandidate['kind'],
  budget: Partial<CapabilityBudget> | undefined,
  actionPlanSteps: number | undefined,
) {
  if (!budget) return undefined;
  if (budget.maxProviders === 0 && manifest.providers.length > 0) return 'budget exhausted: maxProviders=0';
  if (budget.maxNetworkCalls === 0 && hasAnySideEffect(manifest, ['network', 'external-api'])) {
    return 'budget exhausted: maxNetworkCalls=0';
  }
  if (budget.maxToolCalls === 0 && ['skill', 'tool', 'runtime-adapter', 'composed'].includes(candidateKind)) {
    return `budget exhausted: maxToolCalls=0 for ${candidateKind}`;
  }
  if (budget.maxObserveCalls === 0 && candidateKind === 'observe') return 'budget exhausted: maxObserveCalls=0';
  if (budget.maxActionSteps === 0 && candidateKind === 'action') return 'budget exhausted: maxActionSteps=0';
  if (
    candidateKind === 'action'
    && typeof actionPlanSteps === 'number'
    && typeof budget.maxActionSteps === 'number'
    && Number.isFinite(budget.maxActionSteps)
    && actionPlanSteps > Math.max(0, Math.floor(budget.maxActionSteps))
  ) {
    return `budget exhausted: action plan requires ${actionPlanSteps} steps but maxActionSteps=${Math.max(0, Math.floor(budget.maxActionSteps))}`;
  }
  return undefined;
}

function skillManifestToCapabilityManifest(manifest: MatchableSkillManifest, id: string): CapabilityManifest {
  const providerId = skillProviderId(id);
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id,
    name: id,
    version: '0.1.0',
    ownerPackage: 'packages/skills',
    kind: 'skill',
    brief: manifest.description,
    routingTags: uniqueStrings([
      ...id.split(/[._-]/),
      ...manifest.skillDomains,
      manifest.entrypoint.type,
    ]),
    domains: uniqueStrings([...manifest.skillDomains]),
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffects: ['none'],
    safety: { risk: 'low', dataScopes: [] },
    examples: manifest.examplePrompts.slice(0, 3).map((prompt, index) => ({ title: `example ${index + 1}`, prompt })),
    validators: [{ id: `${providerId}.schema`, kind: 'schema', expectedRefs: [] }],
    repairHints: [{
      failureCode: 'skill-unavailable',
      summary: 'Use another available skill or ask for the missing package/configuration.',
      recoverActions: ['fallback-skill', 'request-package-install'],
    }],
    providers: [{
      id: providerId,
      label: id,
      kind: manifest.kind === 'workspace' ? 'workspace' : 'package',
      requiredConfig: [],
      contractRef: `packages/skills/${id}`,
    }],
    lifecycle: { status: 'validated', sourceRef: `packages/skills/${id}` },
  };
}

function synthesizeObserveManifest(providerId: string): CapabilityManifest {
  const id = providerId.startsWith('observe.') ? providerId : `observe.${sanitizeId(providerId)}`;
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id,
    name: id,
    version: '0.1.0',
    ownerPackage: 'packages/observe',
    kind: 'observe',
    brief: `Observe provider selected by harness: ${providerId}`,
    routingTags: uniqueStrings(['observe', 'sense', ...id.split(/[._-]/)]),
    domains: ['workspace'],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffects: ['workspace-read'],
    safety: { risk: 'medium', dataScopes: ['workspace'] },
    examples: [{ title: `${id} observe provider` }],
    validators: [{ id: `${id}.schema`, kind: 'schema', expectedRefs: [] }],
    repairHints: [{
      failureCode: 'observe-provider-unavailable',
      summary: 'Return provider-unavailable diagnostics and ask for a different observe provider.',
      recoverActions: ['record-diagnostic', 'fallback-observe-provider'],
    }],
    providers: [{
      id: providerId,
      label: providerId,
      kind: 'package',
      requiredConfig: [],
    }],
    lifecycle: { status: 'validated', sourceRef: `packages/observe/${providerId}` },
  };
}

function synthesizeComputerUseManifest(actionPlan: ComputerUseActionPlanCallbackInput['actionPlan']): CapabilityManifest {
  const providerId = actionPlan.providerId ?? 'sciforge.core.action.computer-use';
  const highRisk = actionPlan.actions.some((action) => action.riskLevel === 'high');
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id: actionPlan.id ?? 'action.computer-use',
    name: 'computer use action plan',
    version: '0.1.0',
    ownerPackage: 'packages/actions/computer-use',
    kind: 'action',
    brief: 'Perform guarded generic Computer Use desktop actions with trace evidence.',
    routingTags: ['action', 'computer', 'use', 'desktop', 'gui'],
    domains: ['workspace'],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffects: ['desktop'],
    safety: {
      risk: highRisk ? 'high' : 'medium',
      dataScopes: ['workspace'],
      requiresHumanApproval: highRisk && actionPlan.actions.some((action) => !action.requiresConfirmation),
    },
    examples: [{ title: 'computer use action plan' }],
    validators: [{ id: `${providerId}.schema`, kind: 'schema', expectedRefs: ['traceRef'] }],
    repairHints: [{
      failureCode: 'action-plan-blocked',
      summary: 'Stop before high-risk desktop actions without confirmation or sufficient budget.',
      recoverActions: ['request-confirmation', 'reduce-action-plan', 'record-blocked-ledger'],
    }],
    providers: [{
      id: providerId,
      label: 'Computer Use',
      kind: 'package',
      requiredConfig: [],
      contractRef: 'packages/actions/computer-use',
    }],
    lifecycle: { status: 'validated', sourceRef: 'packages/actions/computer-use' },
  };
}

function computerUseManifestFromCore() {
  return defaultCapabilityManifests().find((manifest) => manifest.id === 'action.computer-use');
}

function defaultCapabilityManifests() {
  return loadCoreCapabilityManifestRegistry().manifests;
}

function findManifestByIdOrProvider(manifests: CapabilityManifest[], id: string) {
  return manifests.find((manifest) => manifest.id === id || manifest.providers.some((provider) => provider.id === id));
}

function skillProviderId(id: string) {
  return `skill-package.${sanitizeId(id)}`;
}

function sanitizeId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function hasAnySideEffect(manifest: CapabilityManifest, effects: CapabilityManifestSideEffect[]) {
  return manifest.sideEffects.some((effect) => effects.includes(effect));
}

function compareHarnessCandidates(left: HarnessCandidate, right: HarnessCandidate) {
  return right.score - left.score || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id);
}

function uniqueManifests(manifests: CapabilityManifest[]) {
  const byId = new Map<string, CapabilityManifest>();
  for (const manifest of manifests) {
    if (!byId.has(manifest.id)) byId.set(manifest.id, manifest);
  }
  return [...byId.values()];
}

function mergeProviderAvailability(input: HarnessDefaultProviderAvailability[]) {
  const byId = new Map<string, { available: boolean; reason?: string; asString: boolean }>();
  for (const provider of input) {
    const id = typeof provider === 'string' ? provider : provider.id;
    if (!id) continue;
    const next = typeof provider === 'string'
      ? { available: true, asString: true }
      : { available: provider.available, reason: provider.reason, asString: false };
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, next);
      continue;
    }
    if (!existing.available || !next.available) {
      byId.set(id, {
        available: false,
        reason: !next.available ? next.reason ?? existing.reason : existing.reason,
        asString: false,
      });
      continue;
    }
    byId.set(id, { available: true, asString: existing.asString && next.asString });
  }
  return [...byId.entries()].map(([id, provider]) => (
    provider.available && provider.asString
      ? id
      : { id, available: provider.available, reason: provider.reason }
  ));
}

function normalizeAvailableProviders(input: HarnessDefaultProviderAvailability[]) {
  const result = new Map<string, string | true>();
  for (const provider of input) {
    if (typeof provider === 'string') {
      result.set(provider, true);
    } else {
      result.set(provider.id, provider.available ? true : provider.reason ?? 'unavailable');
    }
  }
  return result;
}

function mergeNumberMaps(maps: Array<Record<string, number>>) {
  const out: Record<string, number> = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

function mergeStringListMaps(maps: Array<Record<string, string[]>>) {
  const out: Record<string, string[]> = {};
  for (const map of maps) {
    for (const [key, values] of Object.entries(map)) {
      out[key] = uniqueStrings([...(out[key] ?? []), ...values]);
    }
  }
  return out;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}
