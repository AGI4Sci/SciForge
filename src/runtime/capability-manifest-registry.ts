import {
  CORE_CAPABILITY_MANIFESTS,
  compactCapabilityManifestBrief,
  validateCapabilityManifestRegistry,
  type CapabilityManifest,
  type CapabilityManifestBrief,
  type CapabilityManifestKind,
  type CapabilityManifestRegistry,
} from '../../packages/contracts/runtime/capability-manifest.js';

export interface LoadedCapabilityManifestRegistry extends CapabilityManifestRegistry {
  byId: Map<string, CapabilityManifest>;
  byProviderId: Map<string, CapabilityManifest>;
  getManifest(id: string): CapabilityManifest | undefined;
  getManifestByProviderId(providerId: string): CapabilityManifest | undefined;
  listBriefs(input?: { kind?: CapabilityManifestKind; domain?: string; routingTag?: string }): CapabilityManifestBrief[];
}

export function loadCoreCapabilityManifestRegistry(
  manifests: CapabilityManifest[] = CORE_CAPABILITY_MANIFESTS,
): LoadedCapabilityManifestRegistry {
  const failures = validateCapabilityManifestRegistry(manifests);
  if (failures.length > 0) {
    throw new Error(`Invalid capability manifest registry:\n${failures.join('\n')}`);
  }

  const clonedManifests = manifests.map(cloneManifest);
  const briefs = clonedManifests.map(compactCapabilityManifestBrief);
  const byId = new Map(clonedManifests.map((manifest) => [manifest.id, manifest]));
  const byProviderId = new Map<string, CapabilityManifest>();
  for (const manifest of clonedManifests) {
    for (const provider of manifest.providers) byProviderId.set(provider.id, manifest);
  }

  return {
    manifests: clonedManifests,
    briefs,
    manifestIds: clonedManifests.map((manifest) => manifest.id),
    providerIds: [...byProviderId.keys()],
    byId,
    byProviderId,
    getManifest: (id) => byId.get(id),
    getManifestByProviderId: (providerId) => byProviderId.get(providerId),
    listBriefs: (input = {}) =>
      briefs.filter((brief) => {
        if (input.kind && brief.kind !== input.kind) return false;
        if (input.domain && !brief.domains.includes(input.domain)) return false;
        if (input.routingTag && !brief.routingTags.includes(input.routingTag)) return false;
        return true;
      }),
  };
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
    })),
    repairHints: manifest.repairHints.map((hint) => ({
      ...hint,
      recoverActions: [...hint.recoverActions],
    })),
    providers: manifest.providers.map((provider) => ({
      ...provider,
      requiredConfig: [...provider.requiredConfig],
    })),
    lifecycle: { ...manifest.lifecycle, replaces: manifest.lifecycle.replaces ? [...manifest.lifecycle.replaces] : undefined },
    metadata: manifest.metadata ? { ...manifest.metadata } : undefined,
  };
}
