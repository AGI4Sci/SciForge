import type { GatewayRequest } from '../runtime-types.js';
import { isRecord, toRecordList, toStringList } from '../gateway-utils.js';
import type {
  CapabilityBrokerProviderAvailability,
  CapabilityBrokerSkillHint,
  CapabilityBrokerToolBudget,
  CapabilityBrokerVerificationPolicyHint,
} from '../capability-broker.js';

export interface CapabilityBrokerHarnessInputProjection {
  enabled: boolean;
  skillHints: Array<string | CapabilityBrokerSkillHint>;
  blockedCapabilities: string[];
  preferredCapabilityIds: string[];
  availableProviders?: Array<string | CapabilityBrokerProviderAvailability>;
  toolBudget?: CapabilityBrokerToolBudget;
  verificationPolicy?: CapabilityBrokerVerificationPolicyHint;
  audit?: Record<string, unknown>;
}

interface HarnessInputSource {
  source: string;
  value: Record<string, unknown>;
}

const TOOL_BUDGET_NUMBER_FIELDS = [
  'maxWallMs',
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
] as const;

export function capabilityBrokerHarnessInputProjectionForRequest(request: GatewayRequest): CapabilityBrokerHarnessInputProjection {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (!capabilityBrokerHarnessInputEnabled(uiState)) {
    return {
      enabled: false,
      skillHints: [],
      blockedCapabilities: [],
      preferredCapabilityIds: [],
    };
  }

  const skillHints: Array<string | CapabilityBrokerSkillHint> = [];
  const blockedCapabilities: string[] = [];
  const preferredCapabilityIds: string[] = [];
  const availableProviders: Array<string | CapabilityBrokerProviderAvailability> = [];
  const sourceAudits: Array<Record<string, unknown>> = [];
  let toolBudget: CapabilityBrokerToolBudget | undefined;
  let verificationPolicy: CapabilityBrokerVerificationPolicyHint | undefined;
  let contractRef: string | undefined;
  let traceRef: string | undefined;
  let profileId: string | undefined;

  for (const source of harnessInputSources(uiState)) {
    const contract = harnessContractFromSource(source.value);
    const capabilityPolicy = isRecord(contract?.capabilityPolicy)
      ? contract.capabilityPolicy
      : isRecord(source.value.capabilityPolicy)
        ? source.value.capabilityPolicy
        : {};
    const sourceContractRef = stringField(contract?.contractRef)
      ?? stringField(source.value.contractRef)
      ?? stringField(source.value.harnessContractRef);
    const sourceTraceRef = stringField(contract?.traceRef)
      ?? stringField(source.value.traceRef)
      ?? stringField(source.value.harnessTraceRef);
    const sourceProfileId = stringField(contract?.profileId)
      ?? stringField(source.value.profileId)
      ?? stringField(source.value.harnessProfileId);
    contractRef ??= sourceContractRef;
    traceRef ??= sourceTraceRef;
    profileId ??= sourceProfileId;

    const sourceSkillHints = [
      ...skillHintsFromValue(capabilityPolicy.skillHints, source.source),
      ...skillHintsFromValue(capabilityPolicy.hints, source.source),
      ...candidateSkillHints(capabilityPolicy.candidates, source.source),
    ];
    const sourceBlockedCapabilities = uniqueStrings([
      ...toStringList(capabilityPolicy.blockedCapabilities),
      ...toStringList(capabilityPolicy.blockedCapabilityIds),
      ...toStringList(contract?.blockedCapabilities),
    ]);
    const sourcePreferredCapabilityIds = uniqueStrings([
      ...toStringList(capabilityPolicy.preferredCapabilityIds),
      ...toRecordList(capabilityPolicy.candidates).flatMap((candidate) => {
        const id = stringField(candidate.id);
        return id ? [id] : [];
      }),
    ]);
    const sourceAvailableProviders = uniqueProviderAvailability([
      ...providerAvailabilityFromValue(capabilityPolicy.providerAvailability),
      ...providerAvailabilityFromValue(capabilityPolicy.availableProviders),
      ...providerAvailabilityFromValue(contract?.providerAvailability),
      ...providerAvailabilityFromValue(contract?.availableProviders),
      ...candidateProviderAvailability(capabilityPolicy.candidates),
    ]);
    const sourceToolBudget = toolBudgetFromSources(
      contract?.toolBudget,
      capabilityPolicy.toolBudget,
      capabilityPolicy.capabilityBudget,
      isRecord(source.value.budgetSummary) ? source.value.budgetSummary.tool : undefined,
    );
    const sourceVerificationPolicy = verificationPolicyFromSources(
      contract?.verificationPolicy,
      capabilityPolicy.verificationPolicy,
    );

    skillHints.push(...sourceSkillHints);
    blockedCapabilities.push(...sourceBlockedCapabilities);
    preferredCapabilityIds.push(...sourcePreferredCapabilityIds);
    availableProviders.push(...sourceAvailableProviders);
    toolBudget = mergeCapabilityBrokerToolBudgets(toolBudget, sourceToolBudget);
    verificationPolicy = mergeCapabilityBrokerVerificationPolicies(verificationPolicy, sourceVerificationPolicy);
    sourceAudits.push({
      source: source.source,
      contractRef: sourceContractRef,
      traceRef: sourceTraceRef,
      profileId: sourceProfileId,
      skillHints: sourceSkillHints.length,
      blockedCapabilities: sourceBlockedCapabilities.length,
      preferredCapabilityIds: sourcePreferredCapabilityIds.length,
      providerAvailability: sourceAvailableProviders.length,
      toolBudgetKeys: definedToolBudgetKeys(sourceToolBudget),
      verificationPolicyKeys: definedVerificationPolicyKeys(sourceVerificationPolicy),
    });
  }

  const uniqueSkillHintValues = uniqueSkillHints(skillHints);
  const uniqueBlockedCapabilities = uniqueStrings(blockedCapabilities);
  const uniquePreferredCapabilityIds = uniqueStrings(preferredCapabilityIds);
  const uniqueAvailableProviders = uniqueProviderAvailability(availableProviders);
  const toolBudgetKeys = definedToolBudgetKeys(toolBudget);
  const verificationPolicyKeys = definedVerificationPolicyKeys(verificationPolicy);
  const consumedAny = uniqueSkillHintValues.length > 0
    || uniqueBlockedCapabilities.length > 0
    || uniquePreferredCapabilityIds.length > 0
    || uniqueAvailableProviders.length > 0
    || toolBudgetKeys.length > 0
    || verificationPolicyKeys.length > 0;
  return {
    enabled: true,
    skillHints: uniqueSkillHintValues,
    blockedCapabilities: uniqueBlockedCapabilities,
    preferredCapabilityIds: uniquePreferredCapabilityIds,
    availableProviders: uniqueAvailableProviders.length ? uniqueAvailableProviders : undefined,
    toolBudget,
    verificationPolicy,
    audit: {
      schemaVersion: 'sciforge.agentserver.capability-broker-harness-input-audit.v1',
      status: consumedAny ? 'consumed' : 'enabled-no-input',
      source: 'request.uiState.agentHarness',
      contractRef,
      traceRef,
      profileId,
      consumed: {
        skillHints: uniqueSkillHintValues.length,
        blockedCapabilities: uniqueBlockedCapabilities.length,
        preferredCapabilityIds: uniquePreferredCapabilityIds.length,
        providerAvailability: uniqueAvailableProviders.length,
        toolBudgetKeys,
        verificationPolicyKeys,
        verificationPolicyMode: verificationPolicy?.mode,
      },
      sources: sourceAudits,
    },
  };
}

export function mergeCapabilityBrokerToolBudgets(
  left: CapabilityBrokerToolBudget | undefined,
  right: CapabilityBrokerToolBudget | undefined,
): CapabilityBrokerToolBudget | undefined {
  if (!left) return right;
  if (!right) return left;
  const merged: CapabilityBrokerToolBudget = { ...left };
  for (const key of TOOL_BUDGET_NUMBER_FIELDS) {
    const leftValue = left[key];
    const rightValue = right[key];
    if (leftValue === undefined) {
      merged[key] = rightValue;
    } else if (rightValue !== undefined) {
      merged[key] = Math.min(leftValue, rightValue);
    }
  }
  merged.exhaustedPolicy ??= right.exhaustedPolicy;
  return Object.values(merged).some((value) => value !== undefined) ? merged : undefined;
}

export function mergeCapabilityBrokerVerificationPolicies(
  left: CapabilityBrokerVerificationPolicyHint | undefined,
  right: CapabilityBrokerVerificationPolicyHint | undefined,
): CapabilityBrokerVerificationPolicyHint | undefined {
  if (!left) return right;
  if (!right) return left;
  const merged: CapabilityBrokerVerificationPolicyHint = {
    required: left.required || right.required || undefined,
    mode: stricterVerificationMode(left.mode, right.mode),
    riskLevel: stricterRiskLevel(left.riskLevel, right.riskLevel),
    selectedVerifierIds: uniqueStrings([
      ...(left.selectedVerifierIds ?? []),
      ...(right.selectedVerifierIds ?? []),
    ]),
  };
  return definedVerificationPolicyKeys(merged).length ? merged : undefined;
}

export function mergeCapabilityBrokerAvailableProviders(
  left: Array<string | CapabilityBrokerProviderAvailability> | undefined,
  right: Array<string | CapabilityBrokerProviderAvailability> | undefined,
): Array<string | CapabilityBrokerProviderAvailability> | undefined {
  const merged = uniqueProviderAvailability([...(left ?? []), ...(right ?? [])]);
  return merged.length ? merged : undefined;
}

function capabilityBrokerHarnessInputEnabled(uiState: Record<string, unknown>) {
  const agentHarness = isRecord(uiState.agentHarness) ? uiState.agentHarness : {};
  const harness = isRecord(uiState.harness) ? uiState.harness : {};
  return [
    uiState.agentHarnessCapabilityBrokerEnabled,
    uiState.agentHarnessCapabilityBrokerInputEnabled,
    uiState.agentHarnessConsumeCapabilityBroker,
    uiState.agentHarnessConsumeCapabilityBrokerInput,
    agentHarness.capabilityBrokerEnabled,
    agentHarness.capabilityBrokerInputEnabled,
    agentHarness.consumeCapabilityBroker,
    agentHarness.consumeCapabilityBrokerInput,
    harness.capabilityBrokerEnabled,
    harness.capabilityBrokerInputEnabled,
    harness.consumeCapabilityBroker,
    harness.consumeCapabilityBrokerInput,
  ].some(isEnabledFlag);
}

function harnessInputSources(uiState: Record<string, unknown>): HarnessInputSource[] {
  const sources: HarnessInputSource[] = [];
  const agentHarness = isRecord(uiState.agentHarness) ? uiState.agentHarness : undefined;
  if (agentHarness) sources.push({ source: 'request.uiState.agentHarness.contract', value: agentHarness });
  const harnessContract = isRecord(uiState.harnessContract) ? uiState.harnessContract : undefined;
  if (harnessContract) sources.push({ source: 'request.uiState.harnessContract', value: harnessContract });
  const handoff = isRecord(uiState.agentHarnessHandoff) ? uiState.agentHarnessHandoff : undefined;
  if (handoff) sources.push({ source: 'request.uiState.agentHarnessHandoff', value: handoff });
  return sources;
}

function harnessContractFromSource(source: Record<string, unknown>) {
  return isRecord(source.contract) ? source.contract : source;
}

function candidateSkillHints(value: unknown, source: string): CapabilityBrokerSkillHint[] {
  return toRecordList(value).map((candidate) => {
    const providerIds = toRecordList(candidate.providerAvailability)
      .map((provider) => stringField(provider.providerId) ?? stringField(provider.id))
      .filter((providerId): providerId is string => Boolean(providerId));
    return {
      id: stringField(candidate.id),
      capabilityId: stringField(candidate.id),
      manifestRef: stringField(candidate.manifestRef),
      kind: stringField(candidate.kind),
      reason: toStringList(candidate.reasons).slice(0, 3).join('; ') || undefined,
      source: 'agent-harness-contract',
      selected: true,
      providerIds,
      tags: toStringList(candidate.tags),
    };
  }).filter((hint) => hint.id || hint.capabilityId || hint.manifestRef || hint.kind || hint.providerIds?.length)
    .map((hint) => ({ ...hint, source: hint.source ?? source }));
}

function skillHintsFromValue(value: unknown, source: string): Array<string | CapabilityBrokerSkillHint> {
  if (typeof value === 'string' && value.trim()) return [{ id: value.trim(), source }];
  if (!Array.isArray(value)) return [];
  const out: Array<string | CapabilityBrokerSkillHint> = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      out.push({ id: entry.trim(), source });
      continue;
    }
    if (!isRecord(entry)) continue;
    out.push({
      id: stringField(entry.id),
      capabilityId: stringField(entry.capabilityId),
      manifestRef: stringField(entry.manifestRef) ?? stringField(entry.ref),
      kind: stringField(entry.kind),
      reason: stringField(entry.reason),
      source: stringField(entry.source) ?? source,
      selected: booleanField(entry.selected),
      tags: toStringList(entry.tags),
      providerIds: toStringList(entry.providerIds),
    });
  }
  return out;
}

function toolBudgetFromSources(...values: unknown[]) {
  let out: CapabilityBrokerToolBudget | undefined;
  for (const value of values) {
    if (!isRecord(value)) continue;
    out = mergeCapabilityBrokerToolBudgets(out, toolBudgetFromRecord(value));
  }
  return out;
}

function toolBudgetFromRecord(source: Record<string, unknown>): CapabilityBrokerToolBudget | undefined {
  const out: CapabilityBrokerToolBudget = {
    maxWallMs: numberField(source.maxWallMs),
    maxToolCalls: numberField(source.maxToolCalls),
    maxObserveCalls: numberField(source.maxObserveCalls),
    maxActionSteps: numberField(source.maxActionSteps),
    maxNetworkCalls: numberField(source.maxNetworkCalls),
    maxDownloadBytes: numberField(source.maxDownloadBytes),
    maxResultItems: numberField(source.maxResultItems),
    maxProviders: numberField(source.maxProviders),
    maxRetries: numberField(source.maxRetries),
    perProviderTimeoutMs: numberField(source.perProviderTimeoutMs),
    costUnits: numberField(source.costUnits),
    exhaustedPolicy: stringField(source.exhaustedPolicy),
  };
  return Object.values(out).some((value) => value !== undefined) ? out : undefined;
}

function candidateProviderAvailability(value: unknown): Array<string | CapabilityBrokerProviderAvailability> {
  return toRecordList(value).flatMap((candidate) => providerAvailabilityFromValue(candidate.providerAvailability));
}

function providerAvailabilityFromValue(value: unknown): Array<string | CapabilityBrokerProviderAvailability> {
  if (Array.isArray(value)) {
    const out: Array<string | CapabilityBrokerProviderAvailability> = [];
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) {
        out.push(entry.trim());
        continue;
      }
      if (!isRecord(entry)) continue;
      const id = stringField(entry.id) ?? stringField(entry.providerId);
      if (!id) continue;
      out.push({
        id,
        available: booleanField(entry.available) ?? stringField(entry.status) !== 'unavailable',
        reason: stringField(entry.reason),
      });
    }
    return out;
  }
  if (!isRecord(value)) return [];
  const out: Array<string | CapabilityBrokerProviderAvailability> = [];
  for (const [id, status] of Object.entries(value)) {
    if (!id.trim()) continue;
    if (typeof status === 'boolean') {
      out.push({ id, available: status });
      continue;
    }
    if (typeof status === 'string') {
      out.push({ id, available: status !== 'unavailable', reason: status === 'unavailable' ? status : undefined });
      continue;
    }
    if (!isRecord(status)) continue;
    out.push({
      id,
      available: booleanField(status.available) ?? stringField(status.status) !== 'unavailable',
      reason: stringField(status.reason),
    });
  }
  return out;
}

function uniqueProviderAvailability(
  values: Array<string | CapabilityBrokerProviderAvailability>,
): Array<string | CapabilityBrokerProviderAvailability> {
  const byId = new Map<string, string | CapabilityBrokerProviderAvailability>();
  for (const value of values) {
    const id = typeof value === 'string' ? value.trim() : value.id.trim();
    if (!id) continue;
    const current = byId.get(id);
    const next = typeof value === 'string' ? id : { ...value, id };
    if (!current) {
      byId.set(id, next);
      continue;
    }
    const currentAvailable = typeof current === 'string' ? true : current.available;
    const nextAvailable = typeof next === 'string' ? true : next.available;
    if (currentAvailable && !nextAvailable) byId.set(id, next);
  }
  return [...byId.values()];
}

function verificationPolicyFromSources(...values: unknown[]): CapabilityBrokerVerificationPolicyHint | undefined {
  let out: CapabilityBrokerVerificationPolicyHint | undefined;
  for (const value of values) {
    if (!isRecord(value)) continue;
    out = mergeCapabilityBrokerVerificationPolicies(out, verificationPolicyFromRecord(value));
  }
  return out;
}

function verificationPolicyFromRecord(source: Record<string, unknown>): CapabilityBrokerVerificationPolicyHint | undefined {
  const intensity = stringField(source.intensity);
  const mapped = verificationPolicyForHarnessIntensity(intensity, [
    booleanField(source.requireCitations),
    booleanField(source.requireCurrentRefs),
    booleanField(source.requireArtifactRefs),
  ].some(Boolean));
  const out: CapabilityBrokerVerificationPolicyHint = {
    required: booleanField(source.required) ?? booleanField(source.requireVerification) ?? mapped?.required,
    mode: stringField(source.mode) ?? mapped?.mode,
    riskLevel: riskLevelField(source.riskLevel) ?? riskLevelField(source.risk) ?? mapped?.riskLevel,
    selectedVerifierIds: uniqueStrings([
      ...toStringList(source.selectedVerifierIds),
      ...toStringList(source.verifierIds),
    ]),
  };
  return definedVerificationPolicyKeys(out).length ? out : undefined;
}

function verificationPolicyForHarnessIntensity(
  intensity: string | undefined,
  strictEvidence: boolean,
): CapabilityBrokerVerificationPolicyHint | undefined {
  if (!intensity) return undefined;
  if (intensity === 'none') return { required: false, mode: 'none', riskLevel: 'low' };
  if (intensity === 'light') return { required: true, mode: 'lightweight', riskLevel: strictEvidence ? 'medium' : 'low' };
  if (intensity === 'strict' || intensity === 'audit') return { required: true, mode: 'hybrid', riskLevel: 'high' };
  return { required: true, mode: 'automatic', riskLevel: strictEvidence ? 'high' : 'medium' };
}

function uniqueSkillHints(values: Array<string | CapabilityBrokerSkillHint>) {
  const seen = new Set<string>();
  const out: Array<string | CapabilityBrokerSkillHint> = [];
  for (const value of values) {
    const key = typeof value === 'string'
      ? value
      : value.id ?? value.capabilityId ?? value.manifestRef ?? `${value.kind ?? ''}:${value.reason ?? ''}:${value.source ?? ''}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function definedToolBudgetKeys(budget: CapabilityBrokerToolBudget | undefined) {
  return Object.entries(budget ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort();
}

function definedVerificationPolicyKeys(policy: CapabilityBrokerVerificationPolicyHint | undefined) {
  return Object.entries(policy ?? {})
    .filter(([, value]) => Array.isArray(value) ? value.length > 0 : value !== undefined)
    .map(([key]) => key)
    .sort();
}

function stricterVerificationMode(left: string | undefined, right: string | undefined) {
  if (!left) return right;
  if (!right) return left;
  const rank: Record<string, number> = { none: 0, unverified: 1, lightweight: 2, automatic: 3, human: 4, hybrid: 5 };
  return (rank[right] ?? 0) > (rank[left] ?? 0) ? right : left;
}

function stricterRiskLevel(
  left: CapabilityBrokerVerificationPolicyHint['riskLevel'] | undefined,
  right: CapabilityBrokerVerificationPolicyHint['riskLevel'] | undefined,
) {
  if (!left) return right;
  if (!right) return left;
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[right] > rank[left] ? right : left;
}

function riskLevelField(value: unknown): CapabilityBrokerVerificationPolicyHint['riskLevel'] | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function uniqueStrings(values: unknown) {
  return [...new Set(toStringList(values))];
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanField(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
  }
  return undefined;
}

function isEnabledFlag(value: unknown) {
  return value === true || ['1', 'true', 'on', 'enabled'].includes(String(value).trim().toLowerCase());
}
