import assert from 'node:assert/strict'
import test from 'node:test'
import {
  domainRendererWorkbenchRightPanelContractSchema,
  domainRendererWorkbenchToolbarActionContractSchema
} from '@sciforge/domain-sdk/renderer'
import { domainMainAgentRoutingContractSchema } from '@sciforge/domain-sdk/agent-routing'
import {
  SCIENTIFIC_PLOTTING_AGENT_ROUTING_CONTRACT,
  SCIENTIFIC_PLOTTING_AGENT_ROUTING_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_RENDERER_COMMAND_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRACT,
  SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_RENDERER_TOOLBAR_ACTION_CONTRACT
} from './definition.js'

test('manifest publishes governed Scientific Plotting provenance renderer contributions', () => {
  assert.deepEqual(
    domainRendererWorkbenchRightPanelContractSchema.parse(
      SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRACT
    ),
    {
      location: 'workbench.right-panel',
      title: 'Scientific Plot Provenance',
      resourceKind: 'scientific-plot'
    }
  )
  assert.deepEqual(
    domainRendererWorkbenchToolbarActionContractSchema.parse(
      SCIENTIFIC_PLOTTING_RENDERER_TOOLBAR_ACTION_CONTRACT
    ),
    {
      location: 'workbench.topbar',
      commandId: SCIENTIFIC_PLOTTING_RENDERER_COMMAND_CONTRIBUTION.id,
      label: 'rightPanelScientificPlotting'
    }
  )
  assert.equal(
    SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind,
    'renderer.workbench-right-panel'
  )
})

test('manifest publishes a package-owned Agent routing contract for plot provenance', () => {
  const contract = domainMainAgentRoutingContractSchema.parse(
    SCIENTIFIC_PLOTTING_AGENT_ROUTING_CONTRACT
  )
  assert.equal(SCIENTIFIC_PLOTTING_AGENT_ROUTING_CONTRIBUTION.kind, 'main.agent-routing')
  assert.equal(contract.intent, 'scientific-plot-provenance')
  assert.deepEqual(contract.allowedRoutes, ['code', 'model', 'hybrid'])
  assert.match(contract.summary, /default to a code or hybrid route through Scientific Plotting render/)
  assert.equal(
    contract.workflow.find((step) => step.capabilityId === 'scientific-plotting.render')
      ?.appliesToRoutes?.includes('hybrid'),
    true
  )
  const modelStep = contract.workflow.find((step) => step.id === 'render-model')
  assert.match(modelStep?.description ?? '', /Image Generation/u)
  assert.match(modelStep?.description ?? '', /Visual Review/u)
  assert.match(modelStep?.description ?? '', /sole human-gated path/u)
  assert.ok(
    contract.reproducibilityRequirements.some((requirement) => requirement.includes('model-only'))
  )
})
