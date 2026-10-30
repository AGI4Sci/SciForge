import type { CapabilityDefinition } from '../registry'

export type AppCapabilityDomainPolicy = Readonly<{
  id: string
  title: string
  /**
   * Optional capability ID prefixes owned by this policy when an action ID
   * does not use the conventional `<domain>.<operation>` shape.
   *
   * Core capability IDs are part of the public wire contract and cannot be
   * renamed just to satisfy governance grouping. The owning contribution
   * declares those prefixes here so governance can still require an explicit
   * atomic-cutover policy without introducing aliases or a second registry.
   */
  capabilityIdPrefixes?: readonly string[]
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
      ...(policy.capabilityIdPrefixes
        ? { capabilityIdPrefixes: Object.freeze([...policy.capabilityIdPrefixes]) }
        : {}),
      directTransportPrefixes: Object.freeze([...policy.directTransportPrefixes]),
      allowedDirectTransports: Object.freeze([...policy.allowedDirectTransports])
    })
  })
}
