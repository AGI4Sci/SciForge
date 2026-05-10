import {
  compactCapabilityManifestBrief,
  validateCapabilityManifestShape,
  type CapabilityManifest,
  type CapabilityManifestBrief,
  type CapabilityProviderManifest,
  type CapabilityRepairHint,
  type CapabilityValidatorManifest,
} from '../../packages/contracts/runtime/capability-manifest.js';
import type {
  CapabilityEvolutionCompactRecord,
  CapabilityEvolutionCompactSummary,
} from '../../packages/contracts/runtime/capability-evolution.js';

export interface CapabilityBrokerObjectRef {
  id?: string;
  ref?: string;
  kind?: string;
  artifactType?: string;
  title?: string;
  summary?: string;
  path?: string;
}

export interface CapabilityBrokerArtifactIndexEntry {
  id?: string;
  ref?: string;
  artifactType?: string;
  title?: string;
  summary?: string;
  path?: string;
  tags?: string[];
}

export interface CapabilityBrokerFailureHistoryEntry {
  capabilityId: string;
  failureCode?: string;
  recoverActions?: string[];
  refs?: string[];
  codeRef?: string;
  outputRef?: string;
  stdoutRef?: string;
  stderrRef?: string;
  traceRef?: string;
}

export interface CapabilityBrokerScenarioPolicy {
  id?: string;
  allowedCapabilityIds?: string[];
  blockedCapabilityIds?: string[];
  preferredCapabilityIds?: string[];
  allowedDomains?: string[];
  blockedDomains?: string[];
  requiredTags?: string[];
}

export interface CapabilityBrokerRuntimePolicy {
  topK?: number;
  maxPerKind?: Partial<Record<CapabilityManifest['kind'], number>>;
  allowDeprecated?: boolean;
  riskTolerance?: CapabilityManifest['safety']['risk'];
  allowSideEffects?: CapabilityManifest['sideEffects'];
  requireHumanApprovalFor?: CapabilityManifest['sideEffects'];
}

export interface CapabilityBrokerProviderAvailability {
  id: string;
  available: boolean;
  reason?: string;
}

export interface CapabilityBrokerSkillHint {
  id?: string;
  capabilityId?: string;
  manifestRef?: string;
  kind?: string;
  reason?: string;
  source?: string;
  selected?: boolean;
  tags?: string[];
  providerIds?: string[];
}

export interface CapabilityBrokerToolBudget {
  maxWallMs?: number;
  maxToolCalls?: number;
  maxObserveCalls?: number;
  maxActionSteps?: number;
  maxNetworkCalls?: number;
  maxDownloadBytes?: number;
  maxResultItems?: number;
  maxProviders?: number;
  maxRetries?: number;
  perProviderTimeoutMs?: number;
  costUnits?: number;
  exhaustedPolicy?: string;
}

export interface CapabilityBrokerVerificationPolicyHint {
  required?: boolean;
  mode?: string;
  riskLevel?: CapabilityManifest['safety']['risk'];
  selectedVerifierIds?: string[];
}

export interface CapabilityBrokerInput {
  prompt: string;
  objectRefs?: CapabilityBrokerObjectRef[];
  artifactIndex?: CapabilityBrokerArtifactIndexEntry[];
  failureHistory?: CapabilityBrokerFailureHistoryEntry[];
  capabilityEvolutionSummary?: CapabilityEvolutionCompactSummary;
  skillHints?: Array<string | CapabilityBrokerSkillHint>;
  blockedCapabilities?: string[];
  toolBudget?: CapabilityBrokerToolBudget;
  verificationPolicy?: CapabilityBrokerVerificationPolicyHint;
  scenarioPolicy?: CapabilityBrokerScenarioPolicy;
  runtimePolicy?: CapabilityBrokerRuntimePolicy;
  availableProviders?: Array<string | CapabilityBrokerProviderAvailability>;
}

export interface CapabilityBrokerRequestShape {
  prompt?: string;
  goal?: string;
  refs?: Array<string | CapabilityBrokerObjectRef>;
  scenario?: string;
  riskTolerance?: CapabilityManifest['safety']['risk'];
  topK?: number;
  expectedArtifacts?: string[];
  explicitCapabilityIds?: string[];
  failureHistory?: CapabilityBrokerFailureHistoryEntry[];
  skillHints?: Array<string | CapabilityBrokerSkillHint>;
  blockedCapabilities?: string[];
  toolBudget?: CapabilityBrokerToolBudget;
  verificationPolicy?: CapabilityBrokerVerificationPolicyHint;
  availableProviders?: Array<string | CapabilityBrokerProviderAvailability>;
}

export interface BrokeredCapabilityBrief extends CapabilityManifestBrief {
  score: number;
  matchedSignals: string[];
  providerIds: string[];
  harnessSignals?: string[];
}

export interface CapabilityBrokerExclusion {
  id: string;
  reason: string;
}

export interface CapabilityBrokerOutput {
  contract: 'sciforge.capability-broker-output.v1';
  briefs: BrokeredCapabilityBrief[];
  excluded: CapabilityBrokerExclusion[];
  audit: Array<{
    id: string;
    score: number;
    matchedSignals: string[];
    harnessSignals?: string[];
    penalties: string[];
    excluded?: string;
  }>;
  inputSummary: {
    promptTokens: number;
    objectRefs: number;
    artifactIndexEntries: number;
    failureHistoryEntries: number;
    availableProviders: number;
    capabilityEvolutionRecords: number;
    capabilityEvolutionPromotionCandidates: number;
    harnessSkillHints: number;
    blockedCapabilities: number;
    toolBudgetKeys: string[];
    verificationPolicyMode?: string;
  };
}

export interface CapabilityContractSummary {
  id: string;
  name: string;
  version: string;
  ownerPackage: string;
  kind: CapabilityManifest['kind'];
  brief: string;
  routingTags: string[];
  domains: string[];
  sideEffects: CapabilityManifest['sideEffects'];
  safety: CapabilityManifest['safety'];
  providerIds: string[];
  validatorIds: string[];
  repairFailureCodes: string[];
}

export interface CapabilityExpansion {
  id: string;
  summary: CapabilityContractSummary;
  inputSchema?: CapabilityManifest['inputSchema'];
  outputSchema?: CapabilityManifest['outputSchema'];
  examples?: CapabilityManifest['examples'];
  repairHints?: CapabilityRepairHint[];
  failureRefs?: string[];
  validators?: CapabilityValidatorManifest[];
  providers?: CapabilityProviderManifest[];
}

export interface CapabilityExpansionOptions {
  includeSchemas?: boolean;
  includeExamples?: boolean;
  includeRepairHints?: boolean;
  includeFailureRefs?: boolean;
  failureHistory?: CapabilityBrokerFailureHistoryEntry[];
  includeValidators?: boolean;
  includeProviders?: boolean;
}

interface ScoredCapability {
  manifest: CapabilityManifest;
  score: number;
  matchedSignals: string[];
  harnessSignals: string[];
  penalties: string[];
  excluded?: string;
}

const DEFAULT_TOP_K = 8;
const DEFAULT_KIND_LIMIT = 4;
const RISK_RANK: Record<CapabilityManifest['safety']['risk'], number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export class CapabilityManifestRegistry {
  private readonly manifestsById = new Map<string, CapabilityManifest>();

  constructor(manifests: CapabilityManifest[]) {
    for (const manifest of manifests) {
      const failures = validateCapabilityManifestShape(manifest);
      if (failures.length > 0) {
        throw new Error(`Invalid capability manifest ${manifest.id || '<missing-id>'}: ${failures.join('; ')}`);
      }
      if (this.manifestsById.has(manifest.id)) {
        throw new Error(`Duplicate capability manifest id: ${manifest.id}`);
      }
      this.manifestsById.set(manifest.id, manifest);
    }
  }

  list(): CapabilityManifest[] {
    return [...this.manifestsById.values()];
  }

  get(id: string): CapabilityManifest | undefined {
    return this.manifestsById.get(id);
  }

  expand(briefOrId: CapabilityManifestBrief | BrokeredCapabilityBrief | string, options: CapabilityExpansionOptions = {}): CapabilityExpansion {
    const id = typeof briefOrId === 'string' ? briefOrId : briefOrId.id;
    const manifest = this.get(id);
    if (!manifest) throw new Error(`Unknown capability manifest: ${id}`);
    return expandCapabilityManifest(manifest, options);
  }
}

export function brokerCapabilities(input: CapabilityBrokerInput, registry: CapabilityManifestRegistry): CapabilityBrokerOutput {
  const availableProviders = normalizeAvailableProviders(input.availableProviders);
  const scored = registry.list().map((manifest) => scoreCapability(input, manifest, availableProviders));
  const topK = Math.max(0, input.runtimePolicy?.topK ?? DEFAULT_TOP_K);
  const maxPerKind = input.runtimePolicy?.maxPerKind ?? {};
  const selected: ScoredCapability[] = [];
  const kindCounts = new Map<CapabilityManifest['kind'], number>();
  const excluded: CapabilityBrokerExclusion[] = [];

  for (const item of scored.sort(compareScoredCapability)) {
    if (item.excluded) {
      excluded.push({ id: item.manifest.id, reason: item.excluded });
      continue;
    }
    const kindLimit = maxPerKind[item.manifest.kind] ?? DEFAULT_KIND_LIMIT;
    const kindCount = kindCounts.get(item.manifest.kind) ?? 0;
    if (selected.length >= topK) {
      excluded.push({ id: item.manifest.id, reason: 'outside broker topK' });
      continue;
    }
    if (kindCount >= kindLimit) {
      excluded.push({ id: item.manifest.id, reason: `${item.manifest.kind} kind limit reached` });
      continue;
    }
    if (item.score <= 0) {
      excluded.push({ id: item.manifest.id, reason: 'no prompt, ref, artifact, policy, or history match' });
      continue;
    }
    selected.push(item);
    kindCounts.set(item.manifest.kind, kindCount + 1);
  }

  return {
    contract: 'sciforge.capability-broker-output.v1',
    briefs: selected.map(toBrokeredBrief),
    excluded: excluded.sort((left, right) => left.id.localeCompare(right.id)),
    audit: scored.map((item) => ({
      id: item.manifest.id,
      score: item.score,
      matchedSignals: [...item.matchedSignals],
      harnessSignals: item.harnessSignals.length ? [...item.harnessSignals] : undefined,
      penalties: [...item.penalties],
      excluded: item.excluded,
    })),
    inputSummary: {
      promptTokens: tokens(input.prompt).size,
      objectRefs: input.objectRefs?.length ?? 0,
      artifactIndexEntries: input.artifactIndex?.length ?? 0,
      failureHistoryEntries: input.failureHistory?.length ?? 0,
      availableProviders: availableProviders.size,
      capabilityEvolutionRecords: compactLedgerRecords(input.capabilityEvolutionSummary).length,
      capabilityEvolutionPromotionCandidates: input.capabilityEvolutionSummary?.promotionCandidates.length ?? 0,
      harnessSkillHints: normalizeSkillHints(input.skillHints).length,
      blockedCapabilities: unique(input.blockedCapabilities ?? []).length,
      toolBudgetKeys: definedToolBudgetKeys(input.toolBudget),
      verificationPolicyMode: input.verificationPolicy?.mode,
    },
  };
}

export function brokerCapabilitiesForRequestShape(
  request: CapabilityBrokerRequestShape,
  registry: CapabilityManifestRegistry,
): CapabilityBrokerOutput {
  return brokerCapabilities(capabilityBrokerInputFromRequestShape(request), registry);
}

export function capabilityBrokerInputFromRequestShape(request: CapabilityBrokerRequestShape): CapabilityBrokerInput {
  const prompt = [request.prompt, request.goal].filter((item): item is string => Boolean(item?.trim())).join('\n');
  return {
    prompt,
    objectRefs: request.refs?.map(toObjectRef),
    artifactIndex: request.expectedArtifacts?.map((artifactType) => ({ artifactType, tags: [...tokens(artifactType)] })),
    failureHistory: request.failureHistory,
    scenarioPolicy: {
      id: request.scenario,
      preferredCapabilityIds: request.explicitCapabilityIds,
      blockedCapabilityIds: request.blockedCapabilities,
    },
    runtimePolicy: {
      topK: request.topK,
      riskTolerance: request.riskTolerance ?? request.verificationPolicy?.riskLevel,
    },
    skillHints: request.skillHints,
    blockedCapabilities: request.blockedCapabilities,
    toolBudget: request.toolBudget,
    verificationPolicy: request.verificationPolicy,
    availableProviders: request.availableProviders,
  };
}

export function expandCapabilityManifest(manifest: CapabilityManifest, options: CapabilityExpansionOptions = {}): CapabilityExpansion {
  const brief = compactCapabilityManifestBrief(manifest);
  const expansion: CapabilityExpansion = {
    id: manifest.id,
    summary: {
      id: brief.id,
      name: brief.name,
      version: brief.version,
      ownerPackage: brief.ownerPackage,
      kind: brief.kind,
      brief: brief.brief,
      routingTags: [...brief.routingTags],
      domains: [...brief.domains],
      sideEffects: [...brief.sideEffects],
      safety: { ...brief.safety, dataScopes: [...brief.safety.dataScopes] },
      providerIds: [...brief.providerIds],
      validatorIds: [...brief.validatorIds],
      repairFailureCodes: [...brief.repairFailureCodes],
    },
  };
  if (options.includeSchemas) {
    expansion.inputSchema = manifest.inputSchema;
    expansion.outputSchema = manifest.outputSchema;
  }
  if (options.includeExamples) expansion.examples = manifest.examples.map((example) => ({ ...example }));
  if (options.includeRepairHints) expansion.repairHints = manifest.repairHints.map((hint) => ({ ...hint, recoverActions: [...hint.recoverActions] }));
  if (options.includeFailureRefs) {
    expansion.failureRefs = unique(
      (options.failureHistory ?? [])
        .filter((entry) => entry.capabilityId === manifest.id)
        .flatMap((entry) => [
          ...(entry.refs ?? []),
          entry.codeRef ?? '',
          entry.outputRef ?? '',
          entry.stdoutRef ?? '',
          entry.stderrRef ?? '',
          entry.traceRef ?? '',
        ].filter(Boolean)),
    );
  }
  if (options.includeValidators) expansion.validators = manifest.validators.map((validator) => ({ ...validator, expectedRefs: validator.expectedRefs ? [...validator.expectedRefs] : undefined }));
  if (options.includeProviders) expansion.providers = manifest.providers.map((provider) => ({ ...provider, requiredConfig: [...provider.requiredConfig] }));
  return expansion;
}

function scoreCapability(
  input: CapabilityBrokerInput,
  manifest: CapabilityManifest,
  availableProviders: Map<string, string | true>,
): ScoredCapability {
  const matchedSignals: string[] = [];
  const harnessSignals = harnessSignalsForCapability(input, manifest, availableProviders);
  const penalties: string[] = [];
  let score = 0;

  const exclusion = hardExclusion(input, manifest, availableProviders);
  const searchableText = [
    input.prompt,
    ...refTexts(input.objectRefs ?? []),
    ...artifactTexts(input.artifactIndex ?? []),
    input.scenarioPolicy?.id ?? '',
  ].join(' ');
  const requestTokens = tokens(searchableText);

  const routingMatches = matchingTerms(requestTokens, [...manifest.routingTags, ...manifest.domains]);
  if (routingMatches.length > 0) {
    score += routingMatches.length * 8;
    matchedSignals.push(`routing/domain match: ${routingMatches.slice(0, 4).join(', ')}`);
  }

  const briefMatches = matchingTerms(requestTokens, [...tokens(manifest.brief), manifest.name, manifest.kind]);
  if (briefMatches.length > 0) {
    score += Math.min(12, briefMatches.length * 3);
    matchedSignals.push(`brief match: ${briefMatches.slice(0, 4).join(', ')}`);
  }

  const refMatches = matchingTerms(tokens(refTexts(input.objectRefs ?? []).join(' ')), [...manifest.routingTags, ...manifest.domains, manifest.kind]);
  if (refMatches.length > 0) {
    score += refMatches.length * 10;
    matchedSignals.push(`object ref match: ${refMatches.slice(0, 4).join(', ')}`);
  }

  const artifactMatches = matchingTerms(tokens(artifactTexts(input.artifactIndex ?? []).join(' ')), [...manifest.routingTags, ...manifest.domains, manifest.kind]);
  if (artifactMatches.length > 0) {
    score += artifactMatches.length * 7;
    matchedSignals.push(`artifact index match: ${artifactMatches.slice(0, 4).join(', ')}`);
  }

  const ledgerSignals = scoreCapabilityEvolutionLedger(input.capabilityEvolutionSummary, manifest);
  if (ledgerSignals.scoreDelta !== 0) score += ledgerSignals.scoreDelta;
  matchedSignals.push(...ledgerSignals.matchedSignals);
  penalties.push(...ledgerSignals.penalties);

  const scenario = input.scenarioPolicy;
  if (scenario?.preferredCapabilityIds?.includes(manifest.id)) {
    score += 30;
    matchedSignals.push('scenario preferred capability');
  }
  const scenarioRequiredMatches = matchingTerms(new Set(scenario?.requiredTags ?? []), manifest.routingTags);
  if (scenarioRequiredMatches.length > 0) {
    score += scenarioRequiredMatches.length * 6;
    matchedSignals.push(`scenario required tag match: ${scenarioRequiredMatches.join(', ')}`);
  }

  const failures = input.failureHistory?.filter((entry) => entry.capabilityId === manifest.id) ?? [];
  if (failures.length > 0) {
    score -= Math.min(20, failures.length * 5);
    penalties.push('recent failure history');
    const repairedCodes = new Set(manifest.repairHints.map((hint) => hint.failureCode));
    const repairableFailures = failures.filter((entry) => entry.failureCode && repairedCodes.has(entry.failureCode));
    if (repairableFailures.length > 0) {
      score += repairableFailures.length * 8;
      matchedSignals.push('repair hint covers recent failure');
    }
  }

  if (matchedSignals.length === 0) matchedSignals.push('no strong broker signal');
  return {
    manifest,
    score,
    matchedSignals,
    harnessSignals,
    penalties,
    excluded: exclusion,
  };
}

function hardExclusion(
  input: CapabilityBrokerInput,
  manifest: CapabilityManifest,
  availableProviders: Map<string, string | true>,
): string | undefined {
  const scenario = input.scenarioPolicy;
  if (matchesCapabilityId(input.blockedCapabilities, manifest)) return 'blocked by harness capability policy';
  if (scenario?.blockedCapabilityIds?.includes(manifest.id)) return 'blocked by scenario policy';
  if (scenario?.allowedCapabilityIds?.length && !scenario.allowedCapabilityIds.includes(manifest.id)) return 'not in scenario allowed capability ids';
  if (scenario?.blockedDomains?.some((domain) => manifest.domains.includes(domain))) return 'blocked by scenario domain policy';
  if (scenario?.allowedDomains?.length && !manifest.domains.some((domain) => scenario.allowedDomains?.includes(domain))) return 'outside scenario allowed domains';
  if (!input.runtimePolicy?.allowDeprecated && manifest.lifecycle.status === 'deprecated') return 'deprecated capability hidden by runtime policy';
  const riskTolerance = input.runtimePolicy?.riskTolerance ?? 'medium';
  if (RISK_RANK[manifest.safety.risk] > RISK_RANK[riskTolerance]) return `risk ${manifest.safety.risk} exceeds ${riskTolerance} tolerance`;
  const allowedSideEffects = input.runtimePolicy?.allowSideEffects;
  if (allowedSideEffects?.length && !manifest.sideEffects.every((effect) => allowedSideEffects.includes(effect))) return 'side effect outside runtime policy';
  const approvedSideEffects = input.runtimePolicy?.requireHumanApprovalFor ?? [];
  if (approvedSideEffects.some((effect) => manifest.sideEffects.includes(effect)) && manifest.safety.requiresHumanApproval) return 'human approval required by runtime policy';
  if (availableProviders.size === 0) return undefined;
  const manifestProviderIds = manifest.providers.map((provider) => provider.id);
  const availableManifestProviders = manifestProviderIds.filter((id) => availableProviders.get(id) === true);
  if (availableManifestProviders.length === 0) {
    const unavailableReason = manifestProviderIds.map((id) => availableProviders.get(id)).find((value): value is string => typeof value === 'string');
    return unavailableReason ? `provider unavailable: ${unavailableReason}` : 'no available provider';
  }
  return undefined;
}

function toBrokeredBrief(item: ScoredCapability): BrokeredCapabilityBrief {
  return {
    ...compactCapabilityManifestBrief(item.manifest),
    score: item.score,
    matchedSignals: [...item.matchedSignals],
    harnessSignals: item.harnessSignals.length ? [...item.harnessSignals] : undefined,
  };
}

function harnessSignalsForCapability(
  input: CapabilityBrokerInput,
  manifest: CapabilityManifest,
  availableProviders: Map<string, string | true>,
) {
  const signals: string[] = [];
  const matchingHints = normalizeSkillHints(input.skillHints).filter((hint) => skillHintMatchesManifest(hint, manifest));
  for (const hint of matchingHints.slice(0, 4)) {
    const source = hint.source ? ` from ${hint.source}` : '';
    const reason = hint.reason ? `: ${hint.reason}` : '';
    signals.push(`skill hint${source}${reason}`.slice(0, 240));
  }
  if (matchesCapabilityId(input.blockedCapabilities, manifest)) signals.push('blocked by harness capability policy');

  const providerSignals = providerAvailabilitySignals(manifest, availableProviders);
  signals.push(...providerSignals);

  const budgetSignal = budgetSignalForCapability(input.toolBudget, manifest);
  if (budgetSignal) signals.push(budgetSignal);

  const verificationSignal = verificationSignalForCapability(input.verificationPolicy, manifest);
  if (verificationSignal) signals.push(verificationSignal);

  return unique(signals);
}

function normalizeSkillHints(input: CapabilityBrokerInput['skillHints']): CapabilityBrokerSkillHint[] {
  const out: CapabilityBrokerSkillHint[] = [];
  for (const hint of input ?? []) {
    if (typeof hint === 'string') {
      out.push({ id: hint });
      continue;
    }
    if (!hint || typeof hint !== 'object') continue;
    out.push({
      ...hint,
      tags: hint.tags ? [...hint.tags] : undefined,
      providerIds: hint.providerIds ? [...hint.providerIds] : undefined,
    });
  }
  return out;
}

function skillHintMatchesManifest(hint: CapabilityBrokerSkillHint, manifest: CapabilityManifest) {
  const ids = unique([
    hint.id ?? '',
    hint.capabilityId ?? '',
    hint.manifestRef ?? '',
  ].filter(Boolean));
  if (matchesCapabilityId(ids, manifest)) return true;
  if (hint.kind && hint.kind === manifest.kind) return true;
  if (hint.providerIds?.some((providerId) => manifest.providers.some((provider) => provider.id === providerId))) return true;
  return Boolean(hint.tags?.some((tag) => manifest.routingTags.includes(tag) || manifest.domains.includes(tag)));
}

function matchesCapabilityId(values: string[] | undefined, manifest: CapabilityManifest) {
  const ids = new Set((values ?? []).map((value) => value.trim()).filter(Boolean));
  if (!ids.size) return false;
  if (ids.has(manifest.id) || ids.has(manifest.kind)) return true;
  return manifest.providers.some((provider) => ids.has(provider.id));
}

function providerAvailabilitySignals(manifest: CapabilityManifest, availableProviders: Map<string, string | true>) {
  if (availableProviders.size === 0) return [];
  return manifest.providers.map((provider) => {
    const availability = availableProviders.get(provider.id);
    if (availability === true) return `provider available: ${provider.id}`;
    if (typeof availability === 'string') return `provider unavailable: ${provider.id} (${availability})`;
    return `provider not advertised: ${provider.id}`;
  });
}

function budgetSignalForCapability(budget: CapabilityBrokerToolBudget | undefined, manifest: CapabilityManifest) {
  if (!budget || definedToolBudgetKeys(budget).length === 0) return undefined;
  const compact = [
    numericBudgetPart('maxToolCalls', budget.maxToolCalls),
    numericBudgetPart('maxObserveCalls', budget.maxObserveCalls),
    numericBudgetPart('maxActionSteps', budget.maxActionSteps),
    numericBudgetPart('maxNetworkCalls', budget.maxNetworkCalls),
    numericBudgetPart('maxProviders', budget.maxProviders),
    budget.exhaustedPolicy ? `exhaustedPolicy=${budget.exhaustedPolicy}` : undefined,
  ].filter(Boolean).join(', ');
  return compact ? `tool budget hint for ${manifest.kind}: ${compact}` : `tool budget hint for ${manifest.kind}`;
}

function definedToolBudgetKeys(budget: CapabilityBrokerToolBudget | undefined) {
  return Object.entries(budget ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort();
}

function numericBudgetPart(key: string, value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${key}=${value}` : undefined;
}

function verificationSignalForCapability(policy: CapabilityBrokerVerificationPolicyHint | undefined, manifest: CapabilityManifest) {
  if (!policy) return undefined;
  const selected = policy.selectedVerifierIds?.includes(manifest.id)
    || manifest.providers.some((provider) => policy.selectedVerifierIds?.includes(provider.id));
  if (manifest.kind === 'verifier' || selected) {
    const parts = [
      `mode=${policy.mode ?? 'unspecified'}`,
      `required=${policy.required === true}`,
      policy.riskLevel ? `risk=${policy.riskLevel}` : undefined,
    ].filter(Boolean).join(', ');
    return `verification policy hint: ${parts}`;
  }
  return undefined;
}

function scoreCapabilityEvolutionLedger(
  summary: CapabilityEvolutionCompactSummary | undefined,
  manifest: CapabilityManifest,
) {
  const matchedSignals: string[] = [];
  const penalties: string[] = [];
  let scoreDelta = 0;
  const records = compactLedgerRecords(summary);
  if (!records.length) return { scoreDelta, matchedSignals, penalties };

  const matchingRecords = records.filter((record) => compactRecordCapabilityIds(record).includes(manifest.id));
  const successfulRecords = matchingRecords.filter(isSuccessfulLedgerRecord);
  const failedRecords = matchingRecords.filter(isFailedLedgerRecord);
  if (successfulRecords.length > 0) {
    scoreDelta += Math.min(16, successfulRecords.length * 4);
    matchedSignals.push(`capability evolution ledger success: ${successfulRecords.length}`);
  }
  if (failedRecords.length > 0) {
    scoreDelta -= Math.min(16, failedRecords.length * 4);
    penalties.push(`capability evolution ledger failure: ${failedRecords.length}`);
  }

  const repairableFailureCodes = new Set(manifest.repairHints.map((hint) => hint.failureCode));
  const repairableFailures = records.filter((record) => record.failureCode && repairableFailureCodes.has(record.failureCode));
  if (repairableFailures.length > 0) {
    scoreDelta += Math.min(12, repairableFailures.length * 4);
    matchedSignals.push(`capability evolution repair hint match: ${[...new Set(repairableFailures.map((record) => record.failureCode))].slice(0, 3).join(', ')}`);
  }

  const promotionMatches = (summary?.promotionCandidates ?? []).filter((record) => {
    const candidate = record.promotionCandidate;
    return candidate?.suggestedCapabilityId === manifest.id
      || Boolean(candidate?.suggestedUpdates?.capabilityIds?.includes(manifest.id))
      || compactRecordCapabilityIds(record).includes(manifest.id);
  });
  if (promotionMatches.length > 0) {
    scoreDelta += Math.min(14, promotionMatches.length * 7);
    matchedSignals.push(`capability evolution promotion candidate: ${promotionMatches.length}`);
  }

  return { scoreDelta, matchedSignals, penalties };
}

function compactLedgerRecords(summary: CapabilityEvolutionCompactSummary | undefined) {
  return summary ? [...summary.recentRecords, ...summary.promotionCandidates] : [];
}

function compactRecordCapabilityIds(record: CapabilityEvolutionCompactRecord) {
  return unique([
    ...record.selectedCapabilityIds,
    ...(record.atomicTrace ?? []).map((entry) => entry.capabilityId),
    ...(record.promotionCandidate?.suggestedUpdates?.capabilityIds ?? []),
    record.promotionCandidate?.suggestedCapabilityId ?? '',
  ].filter(Boolean));
}

function isSuccessfulLedgerRecord(record: CapabilityEvolutionCompactRecord) {
  return record.finalStatus === 'succeeded'
    || record.finalStatus === 'fallback-succeeded'
    || record.finalStatus === 'repair-succeeded';
}

function isFailedLedgerRecord(record: CapabilityEvolutionCompactRecord) {
  return record.finalStatus === 'failed'
    || record.finalStatus === 'fallback-failed'
    || record.finalStatus === 'repair-failed'
    || record.finalStatus === 'needs-human';
}

function compareScoredCapability(left: ScoredCapability, right: ScoredCapability): number {
  return right.score - left.score || left.manifest.kind.localeCompare(right.manifest.kind) || left.manifest.id.localeCompare(right.manifest.id);
}

function normalizeAvailableProviders(input: CapabilityBrokerInput['availableProviders']): Map<string, string | true> {
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

function toObjectRef(ref: string | CapabilityBrokerObjectRef): CapabilityBrokerObjectRef {
  return typeof ref === 'string' ? { ref } : { ...ref };
}

function refTexts(refs: CapabilityBrokerObjectRef[]): string[] {
  return refs.map((ref) => [ref.id, ref.ref, ref.kind, ref.artifactType, ref.title, ref.summary, ref.path].filter(Boolean).join(' '));
}

function artifactTexts(entries: CapabilityBrokerArtifactIndexEntry[]): string[] {
  return entries.map((entry) => [entry.id, entry.ref, entry.artifactType, entry.title, entry.summary, entry.path, ...(entry.tags ?? [])].filter(Boolean).join(' '));
}

function matchingTerms(haystack: Set<string>, candidates: Iterable<string>): string[] {
  const matched: string[] = [];
  for (const candidate of candidates) {
    const candidateTokens = tokens(candidate);
    if (candidateTokens.size === 0) continue;
    const allMatch = [...candidateTokens].every((token) => haystack.has(token));
    const partialMatch = [...candidateTokens].some((token) => token.length >= 5 && haystack.has(token));
    if (allMatch || partialMatch) matched.push(candidate);
  }
  return unique(matched);
}

function tokens(value: string): Set<string> {
  const result = new Set<string>();
  for (const match of value.toLowerCase().replaceAll('_', '-').matchAll(/[a-z0-9][a-z0-9_.:/+-]*/g)) {
    const token = match[0];
    result.add(token);
    for (const part of token.split(/[-_./:]+/)) {
      if (part) result.add(part);
    }
  }
  return result;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}
