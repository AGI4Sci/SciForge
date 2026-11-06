import { createEvidenceDagCapabilityFactory } from '@sciforge/domain-evidence-dag/main'
import { createResearchDossierCapabilityClient } from '@sciforge/domain-research-dossier/renderer'

// Shared adapter to registered production definitions; no alternate audit logic.
export function auditClient(runtime) {
  const definitions = createEvidenceDagCapabilityFactory({ defineCapability: value => value, getRuntime: () => runtime }).createDefinitions()
  return createResearchDossierCapabilityClient({ invoke: async (contract, input, options) => {
    const definition = definitions.find(value => value.id === contract.actionId)
    if (!definition) throw new Error(`Missing production capability: ${contract.actionId}`)
    const response = await definition.handler(definition.inputSchema.parse(input), { caller: { workspaceId: options.workspaceId } })
    return contract.outputSchema.parse(definition.outputSchema.parse(response.output))
  } })
}
