import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  SCIENTIFIC_PLOTTING_RENDERER_I18N_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRACT,
  SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION
} from '../definition.js'
import {
  createDomainRendererEntry,
  createScientificPlottingResourceNavigationContribution,
  type ScientificPlottingRightPanelContribution
} from './index.js'
import type { ScientificPlottingI18nResourceContribution } from './scientific-plotting-messages.js'

test('renderer installs contextual provenance panel and translations', () => {
  const opened: unknown[] = []
  const host = {
    capabilityInvoker: {},
    openExternal: () => undefined,
    workbench: {
      openRightPanel: (input: unknown) => opened.push(input),
      openResource: (input: unknown) => {
        opened.push(input)
        return true
      }
    }
  } as unknown as DomainRendererHost
  const entry = createDomainRendererEntry(host)
  assert.equal(entry.contributions.length, 3)

  const panelRuntime = entry.contributions.find(
    ({ id }) => id === SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  )!
  assert.deepEqual(panelRuntime.contract, SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRACT)
  const panel = panelRuntime.value as ScientificPlottingRightPanelContribution
  const rendered = panel.render({
    active: true,
    className: 'plot-panel',
    focused: true,
    onCollapse: () => undefined,
    surfaceId: 'surface-plot-a',
    session: { id: 'session-1', workspaceRoot: '/workspace' },
    activation: {
      revision: 2,
      payload: { manifestVersionId: 'artifact-version:manifest-v2' }
    }
  }) as ReactElement<Record<string, unknown>>
  assert.equal(rendered.props.workspaceRoot, '/workspace')
  assert.equal(rendered.props.preferredManifestVersionId, 'artifact-version:manifest-v2')
  assert.equal(typeof rendered.props.onOpenArtifactHistory, 'function')
  const exactFigureRef = {
    artifactId: 'artifact:figure:1',
    versionId: 'artifact-version:figure:1',
    contentDigest: 'a'.repeat(64),
    byteLength: 12,
    mediaType: 'image/png',
    availability: 'available',
    retention: 'snapshot',
    accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
  } as const
  ;(rendered.props.onOpenArtifactHistory as (ref: typeof exactFigureRef) => void)(exactFigureRef)
  assert.deepEqual(opened, [{
    sessionId: 'session-1',
    surfaceId: 'surface-plot-a',
    resource: {
      resourceKind: 'artifact-version',
      resourceId: exactFigureRef.versionId,
      integrity: {
        algorithm: 'sha256',
        expectedDigest: `sha256:${exactFigureRef.contentDigest}`
      }
    }
  }])
  const translations = entry.contributions.find(
    ({ id }) => id === SCIENTIFIC_PLOTTING_RENDERER_I18N_CONTRIBUTION.id
  )?.value as ScientificPlottingI18nResourceContribution
  assert.equal(translations.resources.en.rightPanelScientificPlotting, 'Plot provenance')
  assert.equal(translations.resources.zh.rightPanelScientificPlotting, '图表溯源')
})

test('resolves exact Figure and render-manifest resources to Plot-owned activation', () => {
  const navigation = createScientificPlottingResourceNavigationContribution()
  const digest = `sha256:${'a'.repeat(64)}`
  assert.deepEqual(navigation.resolve({
    sessionId: 'session-1',
    resource: {
      resourceKind: 'scientific-plot',
      resourceId: 'artifact-version:figure:1',
      integrity: { algorithm: 'sha256', expectedDigest: digest }
    }
  }), {
    activation: {
      revision: 1,
      payload: {
        figureVersionId: 'artifact-version:figure:1',
        expectedDigest: digest
      }
    }
  })
  assert.deepEqual(navigation.resolve({
    sessionId: 'session-1',
    resource: {
      resourceKind: 'scientific-plot-render-manifest',
      resourceId: 'artifact-version:manifest:1'
    }
  }), {
    activation: {
      revision: 1,
      payload: { manifestVersionId: 'artifact-version:manifest:1' }
    }
  })
  assert.equal(navigation.resolve({
    sessionId: 'session-1',
    resource: { resourceKind: 'artifact-version', resourceId: 'artifact-version:figure:1' }
  }), null)
})
