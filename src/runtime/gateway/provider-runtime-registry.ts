import type {
  CapabilityProviderRef,
  ComposedCapabilityAtomicTrace,
  SelectedCapabilityRef,
} from '../../../packages/contracts/runtime/capability-evolution.js';

type ProviderKind = NonNullable<CapabilityProviderRef['kind']>;
type CapabilityKind = NonNullable<SelectedCapabilityRef['kind']>;
type CapabilityRole = NonNullable<SelectedCapabilityRef['role']>;

export interface GatewayProviderRuntimeRegistryEntry {
  capabilityId?: string;
  capabilityKind?: CapabilityKind;
  providerId: string;
  providerKind: ProviderKind;
}

type GatewayProviderRuntimeCapabilityEntry = GatewayProviderRuntimeRegistryEntry & {
  capabilityId: string;
  capabilityKind: CapabilityKind;
};

export const GATEWAY_PROVIDER_RUNTIME_REGISTRY = {
  workspaceRuntime: {
    providerId: 'sciforge.workspace-runtime',
    providerKind: 'local-runtime',
  },
  pythonTask: {
    capabilityId: 'runtime.python-task',
    capabilityKind: 'tool',
    providerId: 'sciforge.core.runtime.python-task',
    providerKind: 'local-runtime',
  },
  workspaceWrite: {
    capabilityId: 'runtime.workspace-write',
    capabilityKind: 'action',
    providerId: 'sciforge.core.runtime.workspace-write',
    providerKind: 'local-runtime',
  },
  schemaVerifier: {
    capabilityId: 'verifier.schema',
    capabilityKind: 'verifier',
    providerId: 'sciforge.core.verifier.schema',
    providerKind: 'local-runtime',
  },
} as const satisfies Record<string, GatewayProviderRuntimeRegistryEntry>;

export function providerRefForRegistryEntry(
  entry: Pick<GatewayProviderRuntimeRegistryEntry, 'providerId' | 'providerKind'>,
): CapabilityProviderRef {
  return {
    id: entry.providerId,
    kind: entry.providerKind,
  };
}

export function selectedCapabilityForRegistryEntry(
  entry: GatewayProviderRuntimeCapabilityEntry,
  role: CapabilityRole,
): SelectedCapabilityRef {
  return {
    id: entry.capabilityId,
    kind: entry.capabilityKind,
    providerId: entry.providerId,
    role,
  };
}

export function atomicTraceForRegistryEntry(
  entry: GatewayProviderRuntimeCapabilityEntry,
  trace: Omit<ComposedCapabilityAtomicTrace, 'capabilityId' | 'providerId'>,
): ComposedCapabilityAtomicTrace {
  return {
    capabilityId: entry.capabilityId,
    providerId: entry.providerId,
    ...trace,
  };
}
