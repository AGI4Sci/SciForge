import type { GatewayRequest } from '../runtime-types.js';
import { isRecord, toRecordList, toStringList } from '../gateway-utils.js';
import type { CapabilityBrokerSkillHint, CapabilityBrokerToolBudget } from '../capability-broker.js';

export interface CapabilityBrokerHarnessInputProjection {
  enabled: boolean;
  skillHints: Array<string | CapabilityBrokerSkillHint>;
  blockedCapabilities: string[];
  preferredCapabilityIds: string[];
  toolBudget?: CapabilityBrokerToolBudget;
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
  const sourceAudits: Array<Record<string, unknown>> = [];
  let toolBudget: CapabilityBrokerToolBudget | undefined;
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
    const sourceToolBudget = toolBudgetFromSources(
      contract?.toolBudget,
      capabilityPolicy.toolBudget,
      capabilityPolicy.capabilityBudget,
      isRecord(source.value.budgetSummary) ? source.value.budgetSummary.tool : undefined,
    );

    skillHints.push(...sourceSkillHints);
    blockedCapabilities.push(...sourceBlockedCapabilities);
    preferredCapabilityIds.push(...sourcePreferredCapabilityIds);
    toolBudget = mergeCapabilityBrokerToolBudgets(toolBudget, sourceToolBudget);
    sourceAudits.push({
      source: source.source,
      contractRef: sourceContractRef,
      traceRef: sourceTraceRef,
      profileId: sourceProfileId,
      skillHints: sourceSkillHints.length,
      blockedCapabilities: sourceBlockedCapabilities.length,
      preferredCapabilityIds: sourcePreferredCapabilityIds.length,
      toolBudgetKeys: definedToolBudgetKeys(sourceToolBudget),
    });
  }

  const uniqueSkillHintValues = uniqueSkillHints(skillHints);
  const uniqueBlockedCapabilities = uniqueStrings(blockedCapabilities);
  const uniquePreferredCapabilityIds = uniqueStrings(preferredCapabilityIds);
  const toolBudgetKeys = definedToolBudgetKeys(toolBudget);
  const consumedAny = Boolean(
    uniqueSkillHintValues.length
    || uniqueBlockedCapabilities.length
    || uniquePreferredCapabilityIds.length
    || toolBudgetKeys.length,
  );
  return {
    enabled: true,
    skillHints: uniqueSkillHintValues,
    blockedCapabilities: uniqueBlockedCapabilities,
    preferredCapabilityIds: uniquePreferredCapabilityIds,
    toolBudget,
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
        toolBudgetKeys,
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
