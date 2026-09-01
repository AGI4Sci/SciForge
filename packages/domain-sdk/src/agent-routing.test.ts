import assert from 'node:assert/strict'
import test from 'node:test'

import { defineDomainMainAgentRoutingContract } from './agent-routing.js'

test('omits absent route restrictions from immutable workflow steps', () => {
  const contract = defineDomainMainAgentRoutingContract({
    intent: 'scientific-plot-provenance',
    title: 'Scientific plot provenance routing',
    summary: 'Route a traceable scientific figure through its package-owned workflow.',
    allowedRoutes: ['code', 'hybrid'],
    workflow: [{
      id: 'visual-plan',
      description: 'Select the governed rendering route.',
      tool: 'visual_generate'
    }, {
      id: 'render-code',
      description: 'Render through the canonical plotting capability.',
      capabilityId: 'scientific-plotting.render',
      appliesToRoutes: ['code', 'hybrid']
    }],
    reproducibilityRequirements: ['Persist exact inputs and immutable outputs.']
  })

  assert.equal(Object.hasOwn(contract.workflow[0]!, 'appliesToRoutes'), false)
  assert.deepEqual(contract.workflow[1]!.appliesToRoutes, ['code', 'hybrid'])
  assert.equal(Object.isFrozen(contract.workflow), true)
  assert.equal(Object.isFrozen(contract.workflow[1]!.appliesToRoutes), true)
})
