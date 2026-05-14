import {
  CORE_CAPABILITY_MANIFESTS,
  CAPABILITY_MANIFEST_CONTRACT_ID,
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
import { readFileSync } from 'node:fs';
import {
  projectCapabilityManifestsToHarnessCandidates,
  type UnifiedCapabilityGraph,
  type UnifiedCapabilityGraphInput,
} from './capability-harness-candidates.js';
import { uiComponentManifests } from '../../packages/presentation/components/manifest-registry';
import type { UIComponentManifest } from '../../packages/contracts/runtime/index.js';
import {
  discoverPackageCapabilityManifestsFromFiles,
  type CapabilityManifestFileDiscoveryAudit,
  type CapabilityManifestFileDiscoveryInput,
} from './capability-manifest-file-discovery.js';
import { skillAndToolPackageCapabilityManifests } from './capability-manifest-skill-package-projection.js';

export type CapabilityManifestDiscoverySource = 'package-discovery' | 'file-discovery';

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
  discoverySource?: CapabilityManifestDiscoverySource;
}

export interface PackageCapabilityManifestDiscoveryResult {
  packages: PackageCapabilityManifestDiscoveryEntry[];
  providerAvailability?: CapabilityProviderAvailabilityInput[];
}

export interface CapabilityManifestRegistryLoadInput {
  coreManifests?: CapabilityManifest[];
  packageDiscovery?: PackageCapabilityManifestDiscoveryResult;
  fileDiscoveryAudit?: CapabilityManifestFileDiscoveryAudit;
}

export type CapabilityManifestRegistryFileDiscoveryInput =
  | ({ enabled: true } & CapabilityManifestFileDiscoveryInput)
  | ({ enabled?: false } & Partial<CapabilityManifestFileDiscoveryInput>);

export interface CapabilityManifestRegistryLoadWithFileDiscoveryInput extends CapabilityManifestRegistryLoadInput {
  fileDiscovery?: CapabilityManifestRegistryFileDiscoveryInput;
}

export interface CompactCapabilityManifestRegistryAudit {
  contract: 'sciforge.capability-manifest-registry-audit.v1';
  manifestCount: number;
  providerCount: number;
  sourceCounts: {
    core: number;
    packageDiscovery: number;
    fileDiscovery?: number;
  };
  fileDiscovery?: CapabilityManifestFileDiscoveryAudit;
  entries: CompactCapabilityManifestRegistryAuditEntry[];
}

export interface CompactCapabilityManifestRegistryAuditEntry {
  id: string;
  version: string;
  ownerPackage: string;
  source: 'core' | CapabilityManifestDiscoverySource;
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
  manifests: CapabilityManifest[] = defaultCoreCapabilityManifests(),
): LoadedCapabilityManifestRegistry {
  return loadCapabilityManifestRegistry({ coreManifests: manifests });
}

export async function loadCapabilityManifestRegistryWithFileDiscovery(
  input: CapabilityManifestRegistryLoadWithFileDiscoveryInput = {},
): Promise<LoadedCapabilityManifestRegistry> {
  if (input.fileDiscovery?.enabled !== true) {
    return loadCapabilityManifestRegistry(input);
  }
  const fileDiscovery = await discoverPackageCapabilityManifestsFromFiles(input.fileDiscovery);
  return loadCapabilityManifestRegistry({
    ...input,
    packageDiscovery: mergePackageCapabilityManifestDiscovery(input.packageDiscovery, fileDiscovery),
    fileDiscoveryAudit: fileDiscovery.audit,
  });
}

export function loadCapabilityManifestRegistry(
  input: CapabilityManifestRegistryLoadInput = {},
): LoadedCapabilityManifestRegistry {
  const coreManifests = input.coreManifests ?? defaultCoreCapabilityManifests();
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
      source: source.discoverySource,
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
  const compactAudit = compactCapabilityManifestRegistryAudit(
    clonedManifests,
    sourceById,
    input.packageDiscovery?.providerAvailability,
    input.fileDiscoveryAudit,
  );

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
  discoverySource: CapabilityManifestDiscoverySource;
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
        discoverySource: packageEntry.discoverySource ?? 'package-discovery',
      });
    }
  }
  return sources;
}

function mergePackageCapabilityManifestDiscovery(
  first: PackageCapabilityManifestDiscoveryResult | undefined,
  second: PackageCapabilityManifestDiscoveryResult | undefined,
): PackageCapabilityManifestDiscoveryResult | undefined {
  if (!first) return second;
  if (!second) return first;
  return {
    packages: [...first.packages, ...second.packages],
    providerAvailability: [
      ...(first.providerAvailability ?? []),
      ...(second.providerAvailability ?? []),
    ].length
      ? [...(first.providerAvailability ?? []), ...(second.providerAvailability ?? [])]
      : undefined,
  };
}

function compactCapabilityManifestRegistryAudit(
  manifests: CapabilityManifest[],
  sourceById: Map<string, ManifestSourceRecord>,
  globalProviderAvailability: CapabilityProviderAvailabilityInput[] | undefined,
  fileDiscoveryAudit: CapabilityManifestFileDiscoveryAudit | undefined,
): CompactCapabilityManifestRegistryAudit {
  const entries = manifests.map((manifest) => auditEntryForManifest(manifest, sourceById, globalProviderAvailability));
  const providerCount = entries.reduce((total, entry) => total + entry.providerAvailability.length, 0);
  const fileDiscoveryCount = entries.filter((entry) => entry.source === 'file-discovery').length;
  return {
    contract: 'sciforge.capability-manifest-registry-audit.v1',
    manifestCount: entries.length,
    providerCount,
    sourceCounts: {
      core: entries.filter((entry) => entry.source === 'core').length,
      packageDiscovery: entries.filter((entry) => entry.source === 'package-discovery').length,
      ...(fileDiscoveryCount > 0 ? { fileDiscovery: fileDiscoveryCount } : {}),
    },
    ...(fileDiscoveryAudit ? { fileDiscovery: fileDiscoveryAudit } : {}),
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

function defaultCoreCapabilityManifests(): CapabilityManifest[] {
  return [
    ...CORE_CAPABILITY_MANIFESTS,
    ...skillAndToolPackageCapabilityManifests(),
    ...offlinePackageProviderCapabilityManifests(),
  ];
}

function offlinePackageProviderCapabilityManifests(): CapabilityManifest[] {
  return [
    projectActionProviderManifestToCapabilityManifest(
      loadJsonFile<ActionProviderManifestProjectionSource>('../../packages/actions/computer-use/action-provider.manifest.json'),
      'packages/actions/computer-use/action-provider.manifest.json',
    ),
    projectVerifierProviderManifestToCapabilityManifest(
      loadJsonFile<VerifierProviderManifestProjectionSource>('../../packages/verifiers/fixtures/human-approval.manifest.json'),
      'packages/verifiers/fixtures/human-approval.manifest.json',
    ),
    ...uiComponentManifests.map((manifest) => projectUIComponentManifestToCapabilityManifest(
      manifest,
      `packages/presentation/components/${manifest.componentId}/manifest.ts`,
    )),
  ];
}

function loadJsonFile<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as T;
}

interface ActionProviderManifestProjectionSource {
  schemaVersion: 'sciforge.action-provider.manifest.v1';
  id: string;
  version: string;
  kind: 'action';
  displayName: string;
  summary: string;
  domains: string[];
  triggers?: string[];
  antiTriggers?: string[];
  integrationLevel?: string;
  entrypoint?: {
    type: string;
    package?: string;
    module?: string;
    symbol?: string;
    path?: string;
    notes?: string;
  };
  actionSchema: {
    schemaRef: string;
    inputShape: Record<string, unknown>;
    outputShape: Record<string, unknown>;
    examples?: Array<Record<string, unknown>>;
  };
  environmentTargets: Array<{
    type: string;
    sideEffects: string[];
  }>;
  safetyGates: {
    riskClass: CapabilityManifestRisk;
    defaultPolicy: string;
    highRiskPolicy: string;
    supportsDryRun?: boolean;
    blockedActions?: string[];
    requiresExplicitTarget?: boolean;
  };
  confirmationRules: {
    requiredWhen: string[];
    approvalEvidence: string[];
    timeoutPolicy: string;
  };
  traceContract: {
    schemaRef: string;
    storagePolicy: string;
    eventTypes: string[];
    redaction?: string[];
  };
  verifierContract: {
    required: boolean;
    defaultVerifierTypes: string[];
    requiredWhen?: string[];
    requestShape: Record<string, unknown>;
    resultShape: Record<string, unknown>;
  };
  failureModes: Array<{
    code: string;
    description: string;
    repairHints?: string[];
  }>;
}

interface VerifierProviderManifestProjectionSource {
  schemaVersion: 'sciforge.verifier-provider.manifest.v1';
  id: string;
  version: string;
  kind: 'verifier';
  verifierType: string;
  displayName: string;
  summary: string;
  domains: string[];
  triggers?: string[];
  antiTriggers?: string[];
  integrationLevel?: string;
  entrypoint?: {
    type: string;
    command?: string;
    module?: string;
    symbol?: string;
    path?: string;
    notes?: string;
  };
  requestContract: {
    schemaRef: string;
    requiredFields: string[];
    shape: Record<string, unknown>;
    acceptedArtifactTypes?: string[];
  };
  resultContract: {
    schemaRef: string;
    shape: Record<string, unknown>;
    verdicts: string[];
    rewardRange?: Record<string, unknown>;
  };
  riskPolicy: {
    coversRiskLevels: CapabilityManifestRisk[];
    defaultMode: string;
    unverifiedAllowed: boolean;
    requiresHumanFor?: string[];
  };
  evidencePolicy: {
    storagePolicy: string;
    evidenceRefsRequired: boolean;
    redaction?: string[];
    retention?: string;
  };
  failureModes: Array<{
    code: string;
    description: string;
    repairHints?: string[];
  }>;
}

function projectActionProviderManifestToCapabilityManifest(
  provider: ActionProviderManifestProjectionSource,
  manifestSourceRef: string,
): CapabilityManifest {
  const capabilityId = `action.${provider.id}`;
  const sourceRef = provider.entrypoint?.path ?? packageRootFromManifestSourceRef(manifestSourceRef);
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id: capabilityId,
    name: provider.displayName,
    version: provider.version,
    ownerPackage: sourceRef.startsWith('packages/') ? sourceRef.split('/').slice(0, 3).join('/') : 'packages/actions',
    kind: 'action',
    brief: provider.summary,
    routingTags: uniqueSortedStrings([
      ...provider.id.split(/[.-]/),
      ...(provider.triggers ?? []),
      ...provider.domains,
      ...provider.verifierContract.defaultVerifierTypes.map((type) => `${type}-verification`),
    ]),
    domains: uniqueSortedStrings(provider.domains),
    inputSchema: provider.actionSchema.inputShape,
    outputSchema: provider.actionSchema.outputShape,
    sideEffects: actionSideEffects(provider),
    safety: {
      risk: provider.safetyGates.riskClass,
      dataScopes: actionDataScopes(provider),
      requiresHumanApproval: provider.confirmationRules.requiredWhen.length > 0,
    },
    examples: (provider.actionSchema.examples ?? []).slice(0, 1).map((_, index) => ({
      title: `${provider.displayName} example ${index + 1}`,
      inputRef: `capability:${capabilityId}/input.example.${index + 1}`,
      outputRef: `capability:${capabilityId}/output.example.${index + 1}`,
    })),
    validators: [
      {
        id: `${capabilityId}.action-schema`,
        kind: 'schema',
        contractRef: provider.actionSchema.schemaRef,
        expectedRefs: ['traceRef'],
      },
      {
        id: `${capabilityId}.default-verifier`,
        kind: 'verifier',
        contractRef: provider.verifierContract.defaultVerifierTypes.join(','),
        expectedRefs: ['verificationResult'],
      },
    ],
    repairHints: provider.failureModes.map((failure) => ({
      failureCode: failure.code,
      summary: failure.description,
      recoverActions: uniqueSortedStrings(failure.repairHints ?? ['retry-with-provider-diagnostics']),
    })),
    providers: [{
      id: provider.id,
      label: provider.displayName,
      kind: 'package',
      contractRef: sourceRef,
      requiredConfig: [],
      priority: 1,
    }],
    lifecycle: {
      status: 'validated',
      sourceRef: manifestSourceRef,
    },
    metadata: {
      sourceSchemaVersion: provider.schemaVersion,
      sourceProviderId: provider.id,
      integrationLevel: provider.integrationLevel,
      entrypoint: provider.entrypoint,
      antiTriggers: provider.antiTriggers ?? [],
      traceContractRef: provider.traceContract.schemaRef,
      verifierTypes: provider.verifierContract.defaultVerifierTypes,
      confirmationTimeoutPolicy: provider.confirmationRules.timeoutPolicy,
      budget: {
        maxActionSteps: actionMaxSteps(provider.actionSchema.inputShape) ?? 12,
        maxRetries: 1,
        exhaustedPolicy: 'fail-with-reason',
      },
    },
  };
}

function projectVerifierProviderManifestToCapabilityManifest(
  provider: VerifierProviderManifestProjectionSource,
  manifestSourceRef: string,
): CapabilityManifest {
  const capabilityId = `verifier.${provider.id}`;
  const sourceRef = provider.entrypoint?.path ?? packageRootFromManifestSourceRef(manifestSourceRef);
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id: capabilityId,
    name: provider.displayName,
    version: provider.version,
    ownerPackage: sourceRef.startsWith('packages/') ? sourceRef.split('/').slice(0, 3).join('/') : 'packages/verifiers',
    kind: 'verifier',
    brief: provider.summary,
    routingTags: uniqueSortedStrings([
      ...provider.id.split(/[.-]/),
      provider.verifierType,
      ...(provider.triggers ?? []),
      ...provider.domains,
      ...provider.requestContract.requiredFields,
    ]),
    domains: uniqueSortedStrings(provider.domains),
    inputSchema: provider.requestContract.shape,
    outputSchema: provider.resultContract.shape,
    sideEffects: ['none'],
    safety: {
      risk: verifierManifestRisk(provider),
      dataScopes: provider.evidencePolicy.evidenceRefsRequired ? ['workspace-refs'] : [],
      requiresHumanApproval: provider.verifierType === 'human',
    },
    examples: [{
      title: `${provider.displayName} fixture`,
      inputRef: `capability:${capabilityId}/input.example`,
      outputRef: `capability:${capabilityId}/output.example`,
    }],
    validators: [{
      id: `${capabilityId}.result-schema`,
      kind: 'schema',
      contractRef: provider.resultContract.schemaRef,
      expectedRefs: ['verificationResult'],
    }],
    repairHints: provider.failureModes.map((failure) => ({
      failureCode: failure.code,
      summary: failure.description,
      recoverActions: uniqueSortedStrings(failure.repairHints ?? ['retry-verification']),
    })),
    providers: [{
      id: provider.id,
      label: provider.displayName,
      kind: 'package',
      contractRef: sourceRef,
      requiredConfig: [],
      priority: 1,
    }],
    lifecycle: {
      status: 'validated',
      sourceRef: manifestSourceRef,
    },
    metadata: {
      sourceSchemaVersion: provider.schemaVersion,
      sourceProviderId: provider.id,
      verifierType: provider.verifierType,
      integrationLevel: provider.integrationLevel,
      entrypoint: provider.entrypoint,
      antiTriggers: provider.antiTriggers ?? [],
      requestContractRef: provider.requestContract.schemaRef,
      resultContractRef: provider.resultContract.schemaRef,
      acceptedArtifactTypes: provider.requestContract.acceptedArtifactTypes ?? [],
      verdicts: provider.resultContract.verdicts,
      evidencePolicy: {
        storagePolicy: provider.evidencePolicy.storagePolicy,
        evidenceRefsRequired: provider.evidencePolicy.evidenceRefsRequired,
      },
      budget: {
        maxRetries: 0,
        exhaustedPolicy: provider.riskPolicy.defaultMode === 'human' ? 'needs-human' : 'fail-with-reason',
      },
    },
  };
}

function projectUIComponentManifestToCapabilityManifest(
  component: UIComponentManifest,
  manifestSourceRef: string,
): CapabilityManifest {
  const capabilityId = `view.${component.componentId}`;
  const providerId = `sciforge.presentation.${component.componentId}`;
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id: capabilityId,
    name: component.title,
    version: component.version,
    ownerPackage: component.packageName,
    kind: 'view',
    brief: component.docs.agentSummary || component.description,
    routingTags: uniqueSortedStrings([
      component.componentId,
      component.moduleId,
      ...component.componentId.split(/[.-]/),
      ...component.moduleId.split(/[.-]/),
      ...(component.acceptsArtifactTypes ?? []),
      ...(component.outputArtifactTypes ?? []),
      ...(component.viewParams ?? []),
      ...(component.interactionEvents ?? []),
      ...(component.roleDefaults ?? []),
    ]),
    domains: uniqueSortedStrings([
      'presentation',
      'view',
      ...component.acceptsArtifactTypes,
      ...(component.outputArtifactTypes ?? []),
    ]),
    inputSchema: {
      type: 'object',
      required: ['artifactRef'],
      properties: {
        artifactRef: { type: 'string' },
        artifactType: { enum: component.acceptsArtifactTypes },
        viewParamsRef: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['componentId', 'renderedArtifactRef'],
      properties: {
        componentId: { const: component.componentId },
        renderedArtifactRef: { type: 'string' },
        interactionEventRefs: { type: 'array', items: { type: 'string' } },
      },
    },
    sideEffects: uiComponentSideEffects(component),
    safety: {
      risk: uiComponentRisk(component),
      dataScopes: uiComponentDataScopes(component),
    },
    examples: [{
      title: `${component.componentId} package view`,
      inputRef: `capability:${capabilityId}/input.example`,
      outputRef: `capability:${capabilityId}/output.example`,
    }],
    validators: [{
      id: `${capabilityId}.ui-component-manifest`,
      kind: 'schema',
      contractRef: `${manifestSourceRef}#UIComponentManifest`,
      expectedRefs: ['renderedArtifactRef'],
    }],
    repairHints: [
      {
        failureCode: 'missing-artifact-ref',
        summary: 'Provide a stable artifact ref instead of inlining large artifact payloads into the view request.',
        recoverActions: ['preserve-artifact-ref', 'reload-view-manifest', 'fallback-to-generic-inspector'],
      },
      {
        failureCode: 'missing-required-fields',
        summary: 'Route to a fallback view or repair the artifact fields required by the component manifest.',
        recoverActions: ['validate-artifact-shape', 'select-fallback-view', 'request-artifact-repair'],
      },
    ],
    providers: [{
      id: providerId,
      label: component.title,
      kind: 'package',
      contractRef: manifestSourceRef,
      requiredConfig: [],
      priority: component.priority,
    }],
    lifecycle: {
      status: component.lifecycle,
      sourceRef: manifestSourceRef,
    },
    metadata: {
      sourceSchemaVersion: 'sciforge.ui-component-manifest.v1',
      sourceComponentId: component.componentId,
      sourceModuleId: component.moduleId,
      sourcePackageName: component.packageName,
      readmePath: component.docs.readmePath,
      acceptedArtifactTypes: [...component.acceptsArtifactTypes],
      outputArtifactTypes: [...(component.outputArtifactTypes ?? [])],
      consumes: (component.consumes ?? []).map((contract) => ({
        kinds: [...contract.kinds],
        mediaTypes: [...(contract.mediaTypes ?? [])],
        extensions: [...(contract.extensions ?? [])],
        previewPolicies: [...(contract.previewPolicies ?? [])],
      })),
      viewParams: [...(component.viewParams ?? [])],
      interactionEvents: [...(component.interactionEvents ?? [])],
      defaultSection: component.defaultSection,
      presentation: component.presentation ? {
        dedupeScope: component.presentation.dedupeScope,
        identityFields: [...(component.presentation.identityFields ?? [])],
      } : undefined,
      fallbackCandidateIds: (component.fallbackModuleIds ?? []).map((componentId) => `view.${componentId}`),
      budget: {
        maxResultItems: 1,
        maxRetries: 0,
        exhaustedPolicy: 'partial-payload',
      },
    },
  };
}

function actionSideEffects(provider: ActionProviderManifestProjectionSource): CapabilityManifestSideEffect[] {
  const targetTypes = new Set(provider.environmentTargets.map((target) => target.type));
  const rawEffects = new Set(provider.environmentTargets.flatMap((target) => target.sideEffects));
  const effects: CapabilityManifestSideEffect[] = [];
  if ([...targetTypes].some((type) => type === 'window' || type === 'browser' || type === 'remote-desktop') || rawEffects.has('pointer') || rawEffects.has('keyboard')) {
    effects.push('desktop');
  }
  if (targetTypes.has('filesystem') || targetTypes.has('kernel')) effects.push('workspace-write');
  if (targetTypes.has('external-api') || rawEffects.has('external-send')) effects.push('external-api');
  if (targetTypes.has('lab-instrument')) effects.push('external-api');
  return effects.length ? uniqueSortedStrings(effects) as CapabilityManifestSideEffect[] : ['none'];
}

function actionDataScopes(provider: ActionProviderManifestProjectionSource): string[] {
  const scopes = ['workspace'];
  if (provider.traceContract.storagePolicy === 'ref-only') scopes.push('trace-refs');
  if (provider.environmentTargets.some((target) => target.type === 'remote-desktop')) scopes.push('remote-session');
  return uniqueSortedStrings(scopes);
}

function actionMaxSteps(inputShape: Record<string, unknown>): number | undefined {
  const properties = isRecord(inputShape.properties) ? inputShape.properties : {};
  const maxSteps = isRecord(properties.max_steps) ? properties.max_steps : undefined;
  return typeof maxSteps?.default === 'number' && Number.isFinite(maxSteps.default) ? maxSteps.default : undefined;
}

function verifierManifestRisk(provider: VerifierProviderManifestProjectionSource): CapabilityManifestRisk {
  if (provider.verifierType === 'human') return 'low';
  return provider.riskPolicy.coversRiskLevels.includes('high') ? 'medium' : 'low';
}

function uiComponentSideEffects(component: UIComponentManifest): CapabilityManifestSideEffect[] {
  if (component.safety?.externalResources && component.safety.externalResources !== 'none') return ['workspace-read', 'network'];
  return ['none'];
}

function uiComponentRisk(component: UIComponentManifest): CapabilityManifestRisk {
  if (component.safety?.executesCode) return 'high';
  if (component.safety?.externalResources && component.safety.externalResources !== 'none') return 'medium';
  return 'low';
}

function uiComponentDataScopes(component: UIComponentManifest): string[] {
  const scopes = ['workspace-refs'];
  if (component.safety?.externalResources && component.safety.externalResources !== 'none') scopes.push('declared-external-resources');
  return uniqueSortedStrings(scopes);
}

function packageRootFromManifestSourceRef(sourceRef: string) {
  return sourceRef.split('/').slice(0, -1).join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
