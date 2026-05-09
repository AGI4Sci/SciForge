export const CAPABILITY_MANIFEST_CONTRACT_ID = 'sciforge.capability-manifest.v1' as const;

export type CapabilityManifestKind =
  | 'observe'
  | 'skill'
  | 'action'
  | 'verifier'
  | 'view'
  | 'memory'
  | 'importer'
  | 'exporter'
  | 'runtime-adapter'
  | 'composed';

export type CapabilityManifestLifecycle = 'draft' | 'validated' | 'published' | 'deprecated';
export type CapabilityManifestRisk = 'low' | 'medium' | 'high';
export type CapabilityManifestSideEffect = 'none' | 'workspace-read' | 'workspace-write' | 'network' | 'desktop' | 'external-api';

export interface CapabilityProviderManifest {
  id: string;
  label: string;
  kind: 'built-in' | 'package' | 'workspace' | 'external';
  contractRef?: string;
  requiredConfig: string[];
  priority?: number;
}

export interface CapabilityValidatorManifest {
  id: string;
  kind: 'schema' | 'smoke' | 'verifier' | 'human' | 'external';
  contractRef?: string;
  command?: string;
  expectedRefs?: string[];
}

export interface CapabilityRepairHint {
  failureCode: string;
  summary: string;
  recoverActions: string[];
  exampleRef?: string;
}

export interface CapabilityManifest {
  contract: typeof CAPABILITY_MANIFEST_CONTRACT_ID;
  id: string;
  name: string;
  version: string;
  ownerPackage: string;
  kind: CapabilityManifestKind;
  brief: string;
  routingTags: string[];
  domains: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  sideEffects: CapabilityManifestSideEffect[];
  safety: {
    risk: CapabilityManifestRisk;
    dataScopes: string[];
    requiresHumanApproval?: boolean;
  };
  examples: Array<{
    title: string;
    prompt?: string;
    inputRef?: string;
    outputRef?: string;
  }>;
  validators: CapabilityValidatorManifest[];
  repairHints: CapabilityRepairHint[];
  providers: CapabilityProviderManifest[];
  lifecycle: {
    status: CapabilityManifestLifecycle;
    sourceRef: string;
    createdAt?: string;
    updatedAt?: string;
    replaces?: string[];
  };
  metadata?: Record<string, unknown>;
}

export type CapabilityManifestBrief = Pick<
  CapabilityManifest,
  'contract' | 'id' | 'name' | 'version' | 'ownerPackage' | 'kind' | 'brief' | 'routingTags' | 'domains' | 'sideEffects' | 'safety' | 'lifecycle'
> & {
  providerIds: string[];
  validatorIds: string[];
  repairFailureCodes: string[];
};

export const capabilityManifestSchema = {
  $id: 'sciforge.capability-manifest.schema.json',
  type: 'object',
  required: [
    'contract',
    'id',
    'name',
    'version',
    'ownerPackage',
    'kind',
    'brief',
    'routingTags',
    'domains',
    'inputSchema',
    'outputSchema',
    'sideEffects',
    'safety',
    'examples',
    'validators',
    'repairHints',
    'providers',
    'lifecycle',
  ],
  properties: {
    contract: { const: CAPABILITY_MANIFEST_CONTRACT_ID },
    id: { type: 'string' },
    name: { type: 'string' },
    version: { type: 'string' },
    ownerPackage: { type: 'string' },
    kind: { enum: ['observe', 'skill', 'action', 'verifier', 'view', 'memory', 'importer', 'exporter', 'runtime-adapter', 'composed'] },
    brief: { type: 'string' },
    routingTags: { type: 'array', items: { type: 'string' } },
    domains: { type: 'array', items: { type: 'string' } },
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffects: { type: 'array', items: { enum: ['none', 'workspace-read', 'workspace-write', 'network', 'desktop', 'external-api'] } },
    safety: {
      type: 'object',
      required: ['risk', 'dataScopes'],
      properties: {
        risk: { enum: ['low', 'medium', 'high'] },
        dataScopes: { type: 'array', items: { type: 'string' } },
        requiresHumanApproval: { type: 'boolean' },
      },
    },
    examples: { type: 'array' },
    validators: { type: 'array' },
    repairHints: { type: 'array' },
    providers: { type: 'array' },
    lifecycle: {
      type: 'object',
      required: ['status', 'sourceRef'],
      properties: {
        status: { enum: ['draft', 'validated', 'published', 'deprecated'] },
        sourceRef: { type: 'string' },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
        replaces: { type: 'array', items: { type: 'string' } },
      },
    },
    metadata: { type: 'object' },
  },
} as const;

export function compactCapabilityManifestBrief(manifest: CapabilityManifest): CapabilityManifestBrief {
  return {
    contract: manifest.contract,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    ownerPackage: manifest.ownerPackage,
    kind: manifest.kind,
    brief: manifest.brief,
    routingTags: [...manifest.routingTags],
    domains: [...manifest.domains],
    sideEffects: [...manifest.sideEffects],
    safety: { ...manifest.safety, dataScopes: [...manifest.safety.dataScopes] },
    lifecycle: { ...manifest.lifecycle, replaces: manifest.lifecycle.replaces ? [...manifest.lifecycle.replaces] : undefined },
    providerIds: manifest.providers.map((provider) => provider.id),
    validatorIds: manifest.validators.map((validator) => validator.id),
    repairFailureCodes: manifest.repairHints.map((hint) => hint.failureCode),
  };
}

export function validateCapabilityManifestShape(manifest: CapabilityManifest): string[] {
  const failures: string[] = [];
  if (manifest.contract !== CAPABILITY_MANIFEST_CONTRACT_ID) failures.push('contract must be sciforge.capability-manifest.v1');
  for (const field of ['id', 'name', 'version', 'ownerPackage', 'brief'] as const) {
    if (!manifest[field]?.trim()) failures.push(`${field} must be non-empty`);
  }
  if (!manifest.routingTags.length) failures.push('routingTags must include at least one tag');
  if (!manifest.providers.length) failures.push('providers must include at least one provider');
  if (!manifest.validators.length) failures.push('validators must include at least one validator');
  if (!manifest.lifecycle.sourceRef.trim()) failures.push('lifecycle.sourceRef must be non-empty');
  if (manifest.sideEffects.includes('none') && manifest.sideEffects.length > 1) failures.push('sideEffects none cannot be combined with other side effects');
  return failures;
}
