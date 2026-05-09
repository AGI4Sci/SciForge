import {
  CORE_CAPABILITY_MANIFESTS,
  type CapabilityManifest,
  type CapabilityManifestKind,
  type CapabilityManifestRisk,
} from './capability-manifest';

export type CapabilityCategory = 'observe' | 'reasoning' | 'action' | 'verify' | 'interactive-view';
export type CapabilityKind = 'sense' | 'skill' | 'tool' | 'action' | 'verifier' | 'interactive-view';
export type CapabilityRiskLevel = 'low' | 'medium' | 'high';
export type CapabilityCostClass = 'low' | 'medium' | 'high';
export type CapabilityReliability = 'metadata-only' | 'schema-checked' | 'validated' | 'human';

export interface CapabilitySummary {
  id: string;
  kind: CapabilityKind;
  category: CapabilityCategory;
  oneLine: string;
  domains: string[];
  triggers: string[];
  antiTriggers: string[];
  modalities: string[];
  producesArtifactTypes: string[];
  riskClass: CapabilityRiskLevel;
  costClass: CapabilityCostClass;
  latencyClass: CapabilityCostClass;
  reliability: CapabilityReliability;
  requiresNetwork: boolean;
  requiredConfig: string[];
  sideEffects?: string[];
  verifierTypes?: Array<'human' | 'agent' | 'schema' | 'environment' | 'simulator' | 'reward-model'>;
  detailRef?: string;
}

export interface CapabilityContract {
  id: string;
  schemaVersion: string;
  invocation?: Record<string, unknown>;
  inputContract?: Record<string, unknown>;
  outputContract?: Record<string, unknown>;
  safetyContract?: Record<string, unknown>;
  traceContract?: Record<string, unknown>;
  verifierContract?: Record<string, unknown>;
}

export interface CapabilityRegistryEntry {
  summary: CapabilitySummary;
  loadContract: () => CapabilityContract | Promise<CapabilityContract>;
}

export interface CapabilityRegistry {
  listBriefs(category?: CapabilityCategory): CapabilitySummary[];
  getBrief(id: string): CapabilitySummary | undefined;
  loadContract(id: string): Promise<CapabilityContract | undefined>;
}

export const WORKSPACE_RUNTIME_GATEWAY_REPAIR_TOOL_ID = 'sciforge.workspace-runtime-gateway' as const;
export const WORKSPACE_RUNTIME_ARTIFACT_PREVIEW_CAPABILITY_ID = 'artifact-preview' as const;

export function agentServerCapabilityRoutingPolicy(): Record<string, string> {
  return {
    decisionOwner: 'AgentServer',
    loadContracts: 'lazy-load selected capability docs/contracts only when needed',
    selectionRule: 'Prefer selected capabilities, then compatible domain/artifact capabilities; return failed-with-reason when a required executor/config is missing.',
  };
}

export function createCapabilityRegistry(entries: CapabilityRegistryEntry[]): CapabilityRegistry {
  const byId = new Map(entries.map((entry) => [entry.summary.id, entry]));
  return {
    listBriefs(category?: CapabilityCategory) {
      return entries
        .map((entry) => entry.summary)
        .filter((summary) => !category || summary.category === category)
        .map(compactCapabilitySummary);
    },
    getBrief(id: string) {
      const summary = byId.get(id)?.summary;
      return summary ? compactCapabilitySummary(summary) : undefined;
    },
    async loadContract(id: string) {
      const entry = byId.get(id);
      return entry ? await entry.loadContract() : undefined;
    },
  };
}

export function defaultCapabilityRegistry(): CapabilityRegistry {
  return createCapabilityRegistry(defaultCapabilitySummaries().map((summary) => ({
    summary,
    loadContract: () => ({
      id: summary.id,
      schemaVersion: 'sciforge.capability-contract.v1',
      invocation: { loadPolicy: 'on-selected-only' },
      safetyContract: {
        riskClass: summary.riskClass,
        sideEffects: summary.sideEffects ?? [],
      },
      verifierContract: summary.kind === 'verifier'
        ? { verifierTypes: summary.verifierTypes ?? [], evidence: 'refs-and-compact-critique' }
        : undefined,
    }),
  })));
}

export function defaultCapabilitySummaries(): CapabilitySummary[] {
  return CORE_CAPABILITY_MANIFESTS.map(capabilityManifestToSummary);
}

function compactCapabilitySummary(summary: CapabilitySummary): CapabilitySummary {
  return {
    id: summary.id,
    kind: summary.kind,
    category: summary.category,
    oneLine: summary.oneLine,
    domains: uniqueStrings(summary.domains),
    triggers: uniqueStrings(summary.triggers).slice(0, 8),
    antiTriggers: uniqueStrings(summary.antiTriggers).slice(0, 6),
    modalities: uniqueStrings(summary.modalities),
    producesArtifactTypes: uniqueStrings(summary.producesArtifactTypes),
    riskClass: summary.riskClass,
    costClass: summary.costClass,
    latencyClass: summary.latencyClass,
    reliability: summary.reliability,
    requiresNetwork: summary.requiresNetwork,
    requiredConfig: uniqueStrings(summary.requiredConfig),
    sideEffects: uniqueStrings(summary.sideEffects ?? []),
    verifierTypes: summary.verifierTypes ? [...summary.verifierTypes] : undefined,
    detailRef: summary.detailRef,
  };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function capabilityManifestToSummary(manifest: CapabilityManifest): CapabilitySummary {
  const category = capabilityKindToCategory(manifest.kind);
  const kind = capabilityKindToLegacyKind(manifest.kind);
  return {
    id: manifest.id,
    kind,
    category,
    oneLine: manifest.brief,
    domains: manifest.domains,
    triggers: manifest.routingTags,
    antiTriggers: [],
    modalities: capabilityModalities(manifest),
    producesArtifactTypes: capabilityProducedArtifactTypes(manifest),
    riskClass: manifest.safety.risk,
    costClass: riskToCostClass(manifest.safety.risk),
    latencyClass: capabilityLatencyClass(manifest),
    reliability: capabilityReliability(manifest),
    requiresNetwork: manifest.sideEffects.includes('network') || manifest.sideEffects.includes('external-api'),
    requiredConfig: uniqueStrings(manifest.providers.flatMap((provider) => provider.requiredConfig)),
    sideEffects: manifest.sideEffects,
    verifierTypes: manifest.kind === 'verifier' ? capabilityVerifierTypes(manifest) : undefined,
    detailRef: manifest.lifecycle.sourceRef,
  };
}

function capabilityKindToCategory(kind: CapabilityManifestKind): CapabilityCategory {
  if (kind === 'observe') return 'observe';
  if (kind === 'skill' || kind === 'composed') return 'reasoning';
  if (kind === 'verifier') return 'verify';
  if (kind === 'view') return 'interactive-view';
  return 'action';
}

function capabilityKindToLegacyKind(kind: CapabilityManifestKind): CapabilityKind {
  if (kind === 'observe') return 'sense';
  if (kind === 'verifier') return 'verifier';
  if (kind === 'view') return 'interactive-view';
  if (kind === 'skill' || kind === 'composed') return 'skill';
  if (kind === 'action') return 'action';
  return 'tool';
}

function riskToCostClass(risk: CapabilityManifestRisk): CapabilityCostClass {
  if (risk === 'high') return 'high';
  if (risk === 'medium') return 'medium';
  return 'low';
}

function capabilityLatencyClass(manifest: CapabilityManifest): CapabilityCostClass {
  if (manifest.sideEffects.includes('network') || manifest.sideEffects.includes('external-api') || manifest.sideEffects.includes('desktop')) return 'high';
  if (manifest.sideEffects.includes('workspace-write')) return 'medium';
  return 'low';
}

function capabilityReliability(manifest: CapabilityManifest): CapabilityReliability {
  if (manifest.validators.some((validator) => validator.kind === 'human')) return 'human';
  if (manifest.lifecycle.status === 'validated' || manifest.lifecycle.status === 'published') return 'validated';
  if (manifest.validators.length) return 'schema-checked';
  return 'metadata-only';
}

function capabilityVerifierTypes(manifest: CapabilityManifest): CapabilitySummary['verifierTypes'] {
  return uniqueStrings(manifest.validators.map((validator) => {
    if (validator.kind === 'smoke') return 'environment';
    if (validator.kind === 'external') return 'agent';
    return validator.kind;
  })).filter((value): value is NonNullable<CapabilitySummary['verifierTypes']>[number] =>
    ['human', 'agent', 'schema', 'environment', 'simulator', 'reward-model'].includes(value),
  );
}

function capabilityModalities(manifest: CapabilityManifest): string[] {
  if (manifest.kind === 'observe') return ['image', 'vision'];
  if (manifest.kind === 'view') return ['json', 'table'];
  return ['text', 'json'];
}

function capabilityProducedArtifactTypes(manifest: CapabilityManifest): string[] {
  if (Array.isArray(manifest.metadata?.producesArtifactTypes)) {
    return manifest.metadata.producesArtifactTypes.map(String);
  }
  if (manifest.kind === 'view') return ['interactive-view'];
  if (manifest.kind === 'verifier') return ['verification-result'];
  if (manifest.kind === 'observe') return ['observation', 'trace'];
  if (manifest.kind === 'skill' || manifest.kind === 'composed') return ['tool-payload', 'execution-unit', 'artifact'];
  if (manifest.sideEffects.includes('workspace-write')) return ['tool-payload', 'execution-unit', 'trace'];
  return ['runtime-artifact'];
}
