import type { AgentProviderCapabilities } from '../agent/types'

export function providerSupportsCapability(
  provider: { getCapabilities?: () => Partial<AgentProviderCapabilities> },
  capability: keyof AgentProviderCapabilities
): boolean {
  return provider.getCapabilities?.()[capability] !== false
}
