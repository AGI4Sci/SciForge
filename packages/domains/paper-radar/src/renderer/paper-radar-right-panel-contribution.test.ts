import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import type { DomainRendererCommandHandler } from '@sciforge/domain-sdk/renderer'
import {
  PAPER_RADAR_RENDERER_COMMAND_CONTRIBUTION,
  PAPER_RADAR_RENDERER_I18N_CONTRIBUTION,
  PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRACT,
  PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  PAPER_RADAR_RENDERER_TOOLBAR_ACTION_CONTRACT,
  PAPER_RADAR_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import {
  createDomainRendererEntry,
  type PaperRadarRightPanelContribution,
  type PaperRadarToolbarActionContribution
} from './paper-radar-right-panel-contribution'
import type { PaperRadarI18nResourceContribution } from './paper-radar-messages'

test('creates declared Workbench and translation values without host side effects', async () => {
  const openedPanels: unknown[] = []
  const host: DomainRendererHost = {
    capabilityInvoker: {
      observe: async () => {
        throw new Error('not observed while creating the panel contribution')
      },
      invoke: async <TInput, TOutput>(): Promise<TOutput> => {
        throw new Error('not invoked while creating the panel contribution')
      }
    },
    openExternal: () => undefined,
    workbench: { openRightPanel: (input) => openedPanels.push(input) }
  }

  const entry = createDomainRendererEntry(host)
  assert.equal(entry.process, 'renderer')
  assert.deepEqual(entry.definition, domainPackageDefinition)
  assert.equal(entry.contributions.length, 4)

  const runtime = entry.contributions.find(({ kind }) =>
    kind === PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind
  )!
  const panel = runtime.value as PaperRadarRightPanelContribution
  assert.equal(runtime.id, PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRIBUTION.id)
  assert.deepEqual(runtime.contract, PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRACT)
  assert.deepEqual(PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRACT, {
    location: 'workbench.right-panel',
    title: 'Paper radar',
    resourceKind: 'paper-radar'
  })
  assert.deepEqual(Object.keys(panel), ['render'])
  const rendered = panel.render({
    active: true,
    className: 'panel',
    focused: true,
    onCollapse: () => undefined,
    surfaceId: 'surface-paper-a',
    session: { id: 'session-paper' }
  })
  const props = (rendered as ReactElement<Record<string, unknown>>).props
  assert.equal(props.className, 'panel')
  assert.equal(typeof props.capabilityClient, 'object')
  assert.equal(props.openExternal, host.openExternal)

  const command = entry.contributions.find(({ kind }) =>
    kind === PAPER_RADAR_RENDERER_COMMAND_CONTRIBUTION.kind
  )!.value as DomainRendererCommandHandler
  assert.equal(typeof command.execute, 'function')
  assert.equal(typeof command.isAvailable, 'function')
  assert.equal(typeof command.isActive, 'function')
  await command.execute({
    sessionId: 'session-paper',
    payload: { source: 'timeline', nodeId: 'paper-7' }
  })
  assert.deepEqual(openedPanels, [{
    contributionId: 'paper-radar.workbench-right-panel',
    sessionId: 'session-paper',
    activation: {
      contributionId: 'paper-radar.workbench-right-panel',
      revision: 1,
      payload: { source: 'timeline', nodeId: 'paper-7' }
    }
  }])

  const toolbarRuntime = entry.contributions.find(({ kind }) =>
    kind === PAPER_RADAR_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.kind
  )!
  const toolbar = toolbarRuntime.value as PaperRadarToolbarActionContribution
  assert.deepEqual(toolbarRuntime.contract, PAPER_RADAR_RENDERER_TOOLBAR_ACTION_CONTRACT)
  assert.equal(typeof toolbar.icon, 'object')

  const translations = entry.contributions.find(({ kind }) =>
    kind === PAPER_RADAR_RENDERER_I18N_CONTRIBUTION.kind
  )?.value as PaperRadarI18nResourceContribution
  assert.equal(translations.namespace, 'common')
  assert.equal(translations.resources.en.paperRadarTitle, 'Paper Radar')
  assert.equal(translations.resources.zh.paperRadarTitle, '论文雷达')
})
