import assert from 'node:assert/strict'
import test from 'node:test'
import {
  domainRendererWorkbenchRightPanelContractSchema,
  domainRendererWorkbenchToolbarActionContractSchema
} from '@sciforge/domain-sdk/renderer'
import {
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
