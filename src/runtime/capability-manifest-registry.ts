import {
  CORE_CAPABILITY_MANIFESTS,
  compactCapabilityManifestBrief,
  validateCapabilityManifestRegistry,
  type CapabilityManifest,
  type CapabilityManifestBrief,
  type CapabilityManifestKind,
  type CapabilityManifestRegistry,
  type CapabilityManifestRisk,
  type CapabilityManifestSideEffect,
  type CapabilityProviderManifest,
  type CapabilityRepairHint,
  type CapabilityValidatorManifest,
} from '../../packages/contracts/runtime/capability-manifest.js';
import {
  projectCapabilityManifestsToHarnessCandidates,
  type UnifiedCapabilityGraph,
  type UnifiedCapabilityGraphInput,
} from './capability-harness-candidates.js';

export type CapabilityProviderAvailabilityInput =
  | string
  | {
    id: string;
    available: boolean;
    reason?: string;
  };

export interface PackageCapabilityManifestDiscoveryEntry {
  packageName: string;
  packageRoot?: string;
  manifests: CapabilityManifest[];
  providerAvailability?: CapabilityProviderAvailabilityInput[];
}

export interface PackageCapabilityManifestDiscoveryResult {
  packages: PackageCapabilityManifestDiscoveryEntry[];
  providerAvailability?: CapabilityProviderAvailabilityInput[];
}

export interface CapabilityManifestRegistryLoadInput {
  coreManifests?: CapabilityManifest[];
  packageDiscovery?: PackageCapabilityManifestDiscoveryResult;
}

export interface CompactCapabilityManifestRegistryAudit {
  contract: 'sciforge.capability-manifest-registry-audit.v1';
  manifestCount: number;
  providerCount: number;
  sourceCounts: {
    core: number;
    packageDiscovery: number;
  };
  entries: CompactCapabilityManifestRegistryAuditEntry[];
}

export interface CompactCapabilityManifestRegistryAuditEntry {
  id: string;
  version: string;
  ownerPackage: string;
  source: 'core' | 'package-discovery';
  packageName?: string;
  packageRoot?: string;
  sideEffects: CapabilityManifestSideEffect[];
  risk: CapabilityManifestRisk;
  requiresHumanApproval: boolean;
  providerAvailability: Array<{
    providerId: string;
    providerKind: CapabilityProviderManifest['kind'];
    available: boolean;
    reason?: string;
    requiredConfig: string[];
  }>;
  requiredConfig: string[];
  validatorIds: string[];
  validatorKinds: CapabilityValidatorManifest['kind'][];
  repairFailureCodes: string[];
  repairRecoverActions: string[];
}

export interface LoadedCapabilityManifestRegistry extends CapabilityManifestRegistry {
  byId: Map<string, CapabilityManifest>;
  byProviderId: Map<string, CapabilityManifest>;
  compactAudit: CompactCapabilityManifestRegistryAudit;
  getManifest(id: string): CapabilityManifest | undefined;
  getManifestByProviderId(providerId: string): CapabilityManifest | undefined;
  listBriefs(input?: { kind?: CapabilityManifestKind; domain?: string; routingTag?: string }): CapabilityManifestBrief[];
  projectHarnessCandidates(input?: Omit<UnifiedCapabilityGraphInput, 'manifests'>): UnifiedCapabilityGraph;
}

export function loadCoreCapabilityManifestRegistry(
  manifests: CapabilityManifest[] = CORE_CAPABILITY_MANIFESTS,
): LoadedCapabilityManifestRegistry {
  return loadCapabilityManifestRegistry({ coreManifests: manifests });
}

export function loadCapabilityManifestRegistry(
  input: CapabilityManifestRegistryLoadInput = {},
): LoadedCapabilityManifestRegistry {
  const coreManifests = input.coreManifests ?? CORE_CAPABILITY_MANIFESTS;
  const packageSources = packageManifestSources(input.packageDiscovery);
  const manifests = [
    ...coreManifests,
    ...packageSources.map((source) => source.manifest),
  ];
  const failures = validateCapabilityManifestRegistry(manifests);
  if (failures.length > 0) {
    throw new Error(`Invalid capability manifest registry:\n${failures.join('\n')}`);
  }

  const clonedManifests = manifests.map(cloneManifest);
  const sourceById = new Map<string, ManifestSourceRecord>();
  for (const manifest of coreManifests) sourceById.set(manifest.id, { source: 'core' });
  for (const source of packageSources) {
    sourceById.set(source.manifest.id, {
      source: 'package-discovery',
      packageName: source.packageName,
      packageRoot: source.packageRoot,
      providerAvailability: source.providerAvailability,
    });
  }
  const briefs = clonedManifests.map(compactCapabilityManifestBrief);
  const byId = new Map(clonedManifests.map((manifest) => [manifest.id, manifest]));
  const byProviderId = new Map<string, CapabilityManifest>();
  for (const manifest of clonedManifests) {
    for (const provider of manifest.providers) byProviderId.set(provider.id, manifest);
  }
  const compactAudit = compactCapabilityManifestRegistryAudit(clonedManifests, sourceById, input.packageDiscovery?.providerAvailability);

  return {
    manifests: clonedManifests,
    briefs,
    manifestIds: clonedManifests.map((manifest) => manifest.id),
    providerIds: [...byProviderId.keys()],
    byId,
    byProviderId,
    compactAudit,
    getManifest: (id) => byId.get(id),
    getManifestByProviderId: (providerId) => byProviderId.get(providerId),
    listBriefs: (input = {}) =>
      briefs.filter((brief) => {
        if (input.kind && brief.kind !== input.kind) return false;
        if (input.domain && !brief.domains.includes(input.domain)) return false;
        if (input.routingTag && !brief.routingTags.includes(input.routingTag)) return false;
        return true;
      }),
    projectHarnessCandidates: (input = {}) =>
      projectCapabilityManifestsToHarnessCandidates({
        ...input,
        manifests: clonedManifests,
      }),
  };
}

interface ManifestSourceRecord {
  source: CompactCapabilityManifestRegistryAuditEntry['source'];
  packageName?: string;
  packageRoot?: string;
  providerAvailability?: CapabilityProviderAvailabilityInput[];
}

interface PackageManifestSourceRecord {
  manifest: CapabilityManifest;
  packageName: string;
  packageRoot?: string;
  providerAvailability?: CapabilityProviderAvailabilityInput[];
}

function packageManifestSources(discovery?: PackageCapabilityManifestDiscoveryResult): PackageManifestSourceRecord[] {
  const sources: PackageManifestSourceRecord[] = [];
  for (const packageEntry of discovery?.packages ?? []) {
    for (const manifest of packageEntry.manifests) {
      sources.push({
        manifest,
        packageName: packageEntry.packageName,
        packageRoot: packageEntry.packageRoot,
        providerAvailability: packageEntry.providerAvailability,
      });
    }
  }
  return sources;
}

function compactCapabilityManifestRegistryAudit(
  manifests: CapabilityManifest[],
  sourceById: Map<string, ManifestSourceRecord>,
  globalProviderAvailability: CapabilityProviderAvailabilityInput[] | undefined,
): CompactCapabilityManifestRegistryAudit {
  const entries = manifests.map((manifest) => auditEntryForManifest(manifest, sourceById, globalProviderAvailability));
  const providerCount = entries.reduce((total, entry) => total + entry.providerAvailability.length, 0);
  return {
    contract: 'sciforge.capability-manifest-registry-audit.v1',
    manifestCount: entries.length,
    providerCount,
    sourceCounts: {
      core: entries.filter((entry) => entry.source === 'core').length,
      packageDiscovery: entries.filter((entry) => entry.source === 'package-discovery').length,
    },
    entries,
  };
}

function auditEntryForManifest(
  manifest: CapabilityManifest,
  sourceById: Map<string, ManifestSourceRecord>,
  globalProviderAvailability: CapabilityProviderAvailabilityInput[] | undefined,
): CompactCapabilityManifestRegistryAuditEntry {
  const source = sourceById.get(manifest.id) ?? { source: 'core' };
  const availability = normalizeProviderAvailability([
    ...(globalProviderAvailability ?? []),
    ...(source.providerAvailability ?? []),
  ]);
  const providerAvailability = manifest.providers.map((provider) => {
    const availabilityRecord = availability.get(provider.id);
    const available = availabilityRecord?.available ?? true;
    const reason = availabilityRecord?.reason;
    return {
      providerId: provider.id,
      providerKind: provider.kind,
      available,
      ...(reason ? { reason } : {}),
      requiredConfig: [...provider.requiredConfig],
    };
  });
  return {
    id: manifest.id,
    version: manifest.version,
    ownerPackage: manifest.ownerPackage,
    source: source.source,
    packageName: source.packageName,
    packageRoot: source.packageRoot,
    sideEffects: [...manifest.sideEffects],
    risk: manifest.safety.risk,
    requiresHumanApproval: manifest.safety.requiresHumanApproval ?? false,
    providerAvailability,
    requiredConfig: uniqueSortedStrings(manifest.providers.flatMap((provider) => provider.requiredConfig)),
    validatorIds: manifest.validators.map((validator) => validator.id),
    validatorKinds: uniqueSortedStrings(manifest.validators.map((validator) => validator.kind)) as CapabilityValidatorManifest['kind'][],
    repairFailureCodes: manifest.repairHints.map((hint) => hint.failureCode),
    repairRecoverActions: uniqueSortedStrings(manifest.repairHints.flatMap((hint) => hint.recoverActions)),
  };
}

function normalizeProviderAvailability(input: CapabilityProviderAvailabilityInput[]) {
  const result = new Map<string, { available: boolean; reason?: string }>();
  for (const provider of input) {
    if (typeof provider === 'string') {
      result.set(provider, { available: true });
    } else {
      result.set(provider.id, { available: provider.available, reason: provider.reason });
    }
  }
  return result;
}

function uniqueSortedStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}

function cloneManifest(manifest: CapabilityManifest): CapabilityManifest {
  return {
    ...manifest,
    routingTags: [...manifest.routingTags],
    domains: [...manifest.domains],
    inputSchema: { ...manifest.inputSchema },
    outputSchema: { ...manifest.outputSchema },
    sideEffects: [...manifest.sideEffects],
    safety: { ...manifest.safety, dataScopes: [...manifest.safety.dataScopes] },
    examples: manifest.examples.map((example) => ({ ...example })),
    validators: manifest.validators.map((validator) => ({
      ...validator,
      expectedRefs: validator.expectedRefs ? [...validator.expectedRefs] : undefined,
    })) satisfies CapabilityValidatorManifest[],
    repairHints: manifest.repairHints.map(cloneRepairHint),
    providers: manifest.providers.map((provider) => ({
      ...provider,
      requiredConfig: [...provider.requiredConfig],
    })),
    lifecycle: { ...manifest.lifecycle, replaces: manifest.lifecycle.replaces ? [...manifest.lifecycle.replaces] : undefined },
    metadata: manifest.metadata ? { ...manifest.metadata } : undefined,
  };
}

function cloneRepairHint(hint: CapabilityRepairHint): CapabilityRepairHint {
  return {
    ...hint,
    recoverActions: [...hint.recoverActions],
  };
}
