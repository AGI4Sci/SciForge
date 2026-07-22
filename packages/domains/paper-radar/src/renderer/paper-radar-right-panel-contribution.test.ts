import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  PAPER_RADAR_RENDERER_I18N_CONTRIBUTION,
  PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import {
  createDomainRendererEntry,
  type PaperRadarRightPanelContribution
} from './paper-radar-right-panel-contribution'
import type { PaperRadarI18nResourceContribution } from './paper-radar-messages'

test('creates declared Workbench and translation values without host side effects', () => {
  const host: DomainRendererHost = {
    capabilityInvoker: {
      invoke: async <TInput, TOutput>(): Promise<TOutput> => {
        throw new Error('not invoked while creating the panel contribution')
      }
    },
    openExternal: () => undefined
  }

  const entry = createDomainRendererEntry(host)
  assert.equal(entry.process, 'renderer')
  assert.deepEqual(entry.definition, domainPackageDefinition)
  assert.equal(entry.contributions.length, 2)

  const runtime = entry.contributions.find(({ kind }) =>
    kind === PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind
  )!
  const panel = runtime.value as PaperRadarRightPanelContribution
  assert.equal(runtime.id, PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRIBUTION.id)
  assert.deepEqual({
    id: panel.id,
    mode: panel.mode,
    label: panel.label,
    title: panel.title,
    resourceKind: panel.resourceKind
  }, {
    id: 'paper-radar.workbench-right-panel',
    mode: 'paper',
    label: 'rightPanelPaperRadar',
    title: 'Paper radar',
    resourceKind: 'paper-radar'
  })
  assert.equal(typeof panel.icon, 'object')
  assert.equal(panel.isAvailable(), true)

  const rendered = panel.render({ className: 'panel', onCollapse: () => undefined })
  const props = (rendered as ReactElement<Record<string, unknown>>).props
  assert.equal(props.className, 'panel')
  assert.equal(typeof props.capabilityClient, 'object')
  assert.equal(props.openExternal, host.openExternal)

  const translations = entry.contributions.find(({ kind }) =>
    kind === PAPER_RADAR_RENDERER_I18N_CONTRIBUTION.kind
  )?.value as PaperRadarI18nResourceContribution
  assert.equal(translations.namespace, 'common')
  assert.equal(translations.resources.en.paperRadarTitle, 'Paper Radar')
  assert.equal(translations.resources.zh.paperRadarTitle, '论文雷达')
})
