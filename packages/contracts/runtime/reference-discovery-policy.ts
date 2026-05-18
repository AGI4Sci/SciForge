export type RuntimeReferenceDiscoverySource = 'explicit-reference' | 'prompt-discovered-reference';

export function runtimeReferenceDiscoverySource(explicit: boolean): RuntimeReferenceDiscoverySource {
  return explicit ? 'explicit-reference' : 'prompt-discovered-reference';
}

export function runtimeReferenceDiscoverySourceAllowsTurnReference(value: unknown) {
  return value !== 'prompt-discovered-reference';
}
