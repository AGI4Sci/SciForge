import type { CapabilityDefinition } from '../registry'

export type AppCapabilityDomainPolicy = Readonly<{
  id: string
  title: string
  directTransportPrefixes: readonly string[]
  allowedDirectTransports: readonly string[]
}>

export type AppCapabilityContributionFactory<Dependencies> = Readonly<{
  moduleId: string
  policy: AppCapabilityDomainPolicy
  createDefinitions: (dependencies: Dependencies) => readonly CapabilityDefinition[]
}>

export function defineAppCapabilityContribution<Dependencies>(
  moduleId: string,
  createDefinitions: (dependencies: Dependencies) => readonly CapabilityDefinition[],
  policy: AppCapabilityDomainPolicy
): AppCapabilityContributionFactory<Dependencies> {
  return Object.freeze({
    moduleId,
    createDefinitions,
    policy: Object.freeze({
      ...policy,
      directTransportPrefixes: Object.freeze([...policy.directTransportPrefixes]),
      allowedDirectTransports: Object.freeze([...policy.allowedDirectTransports])
    })
  })
}
