import { z } from 'zod'
import { CapabilityBroker } from './broker'
import { defineCapability, CapabilityRegistry } from './registry'
import { defineCapabilityProviderContractSuite } from './provider-contract-suite'

const ACTION_ID = 'contract-fixture.resource.update'

defineCapabilityProviderContractSuite('reusable test fixture', () => {
  let executions = 0
  let semanticRevision = 'revision-1'
  const definition = defineCapability({
    id: ACTION_ID,
    version: '1.0.0',
    title: 'Update contract fixture',
    description: 'Synthetic resource mutation used to verify the reusable provider contract suite.',
    audiences: ['ui', 'agent'],
    scope: 'resource',
    resourceKinds: ['contract-fixture'],
    effect: 'workspace-write',
    approval: 'none',
    concurrency: { revision: 'optimistic', idempotency: 'required' },
    inputSchema: z.object({ value: z.number().int() }).strict(),
    outputSchema: z.object({ value: z.number().int() }).strict(),
    handler: async (input) => {
      executions += 1
      semanticRevision = `revision-${executions + 1}`
      return {
        output: { value: input.value },
        changed: true,
        semanticRevision
      }
    }
  })
  const registry = new CapabilityRegistry([definition])
  const broker = new CapabilityBroker(registry)

  return {
    registry,
    broker,
    actionId: ACTION_ID,
    validInput: { value: 7 },
    invalidInput: { value: 'not-a-number' },
    callers: {
      ui: { audience: 'ui', callerId: 'contract-ui', workspaceId: '/contract-workspace' },
      agent: { audience: 'agent', callerId: 'contract-agent', workspaceId: '/contract-workspace' },
      system: { audience: 'system', callerId: 'contract-system', workspaceId: '/contract-workspace' }
    },
    executionCount: () => executions,
    createResource: () => ({
      resourceId: 'contract-resource',
      resourceKind: 'contract-fixture',
      workspaceId: '/contract-workspace',
      semanticRevision,
      observe: async () => ({
        state: { ready: true },
        semanticRevision,
        operationIds: [ACTION_ID]
      })
    })
  }
})
