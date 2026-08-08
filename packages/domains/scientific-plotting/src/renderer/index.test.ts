import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import type { DomainRendererCommandHandler } from '@sciforge/domain-sdk/renderer'
import {
  SCIENTIFIC_PLOTTING_RENDERER_COMMAND_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_RENDERER_I18N_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRACT,
  SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_RENDERER_TOOLBAR_ACTION_CONTRIBUTION
} from '../definition.js'
import {
  createDomainRendererEntry,
  type ScientificPlottingRightPanelContribution
} from './index.js'
import type { ScientificPlottingI18nResourceContribution } from './scientific-plotting-messages.js'

test('renderer installs provenance panel, command, toolbar, and translations', () => {
  const opened: unknown[] = []
  const host = {
    capabilityInvoker: {},
    openExternal: () => undefined,
    workbench: { openRightPanel: (input: unknown) => opened.push(input) }
  } as unknown as DomainRendererHost
  const entry = createDomainRendererEntry(host)
  assert.equal(entry.contributions.length, 4)

  const panelRuntime = entry.contributions.find(
    ({ id }) => id === SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  )!
  assert.deepEqual(panelRuntime.contract, SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRACT)
  const panel = panelRuntime.value as ScientificPlottingRightPanelContribution
  const rendered = panel.render({
    active: true,
    className: 'plot-panel',
    onCollapse: () => undefined,
    session: { id: 'session-1', workspaceRoot: '/workspace' },
    activation: {
      revision: 2,
      payload: { manifestVersionId: 'artifact-version:manifest-v2' }
    }
  }) as ReactElement<Record<string, unknown>>
  assert.equal(rendered.props.workspaceRoot, '/workspace')
  assert.equal(rendered.props.preferredManifestVersionId, 'artifact-version:manifest-v2')
  assert.equal(typeof rendered.props.onOpenArtifactHistory, 'function')

  const command = entry.contributions.find(
    ({ id }) => id === SCIENTIFIC_PLOTTING_RENDERER_COMMAND_CONTRIBUTION.id
  )!.value as DomainRendererCommandHandler
  assert.equal(command.isAvailable?.({
    sessionId: 'session-1',
    workspaceRoot: '/workspace'
  }), true)
  command.execute({
    sessionId: 'session-1',
    workspaceRoot: '/workspace',
    payload: { manifestVersionId: 'artifact-version:manifest-v2' }
  })
  assert.deepEqual(opened, [{
    contributionId: SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    sessionId: 'session-1',
    activation: {
      contributionId: SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
      revision: 1,
      payload: { manifestVersionId: 'artifact-version:manifest-v2' }
    }
  }])

  assert.ok(entry.contributions.some(
    ({ id }) => id === SCIENTIFIC_PLOTTING_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id
  ))
  const translations = entry.contributions.find(
    ({ id }) => id === SCIENTIFIC_PLOTTING_RENDERER_I18N_CONTRIBUTION.id
  )?.value as ScientificPlottingI18nResourceContribution
  assert.equal(translations.resources.en.rightPanelScientificPlotting, 'Plot provenance')
  assert.equal(translations.resources.zh.rightPanelScientificPlotting, '图表溯源')
})
