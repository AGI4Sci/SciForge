import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  PROJECT_DAG_RENDERER_I18N_CONTRIBUTION,
  PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import {
  createDomainRendererEntry,
  type ProjectDagRightPanelContribution
} from './project-dag-right-panel-contribution'
import type { ProjectDagI18nResourceContribution } from './project-dag-messages'

test('contributes the package-owned Project panel and translations', () => {
  const host: DomainRendererHost = {
    capabilityInvoker: {
      observe: async () => {
        throw new Error('not observed')
      },
      invoke: async <TInput, TOutput>(): Promise<TOutput> => {
        throw new Error('not invoked')
      }
    },
    openExternal: () => undefined,
    workspacePreview: { open: () => undefined },
    workbench: { openRightPanel: () => undefined }
  }
  const entry = createDomainRendererEntry(host)
  assert.equal(entry.process, 'renderer')
  assert.deepEqual(entry.definition, domainPackageDefinition)
  assert.equal(entry.contributions.length, 2)

  const panel = entry.contributions.find(({ kind }) =>
    kind === PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind
  )?.value as ProjectDagRightPanelContribution
  assert.deepEqual({
    id: panel.id,
    mode: panel.mode,
    label: panel.label,
    title: panel.title,
    resourceKind: panel.resourceKind
  }, {
    id: 'project-dag.workbench-right-panel',
    mode: 'project-dag',
    label: 'rightPanelProjectDag',
    title: 'Project DAG',
    resourceKind: 'project-dag'
  })
  const rendered = panel.render({
    active: true,
    className: 'panel',
    onCollapse: () => undefined,
    session: { id: 'session-1', workspaceRoot: '/workspace/lab' }
  })
  const props = (rendered as ReactElement<Record<string, unknown>>).props
  assert.equal(props.className, 'panel')
  assert.equal(props.workspacePreview, host.workspacePreview)
  assert.equal(props.workbench, host.workbench)
  assert.equal(typeof props.client, 'object')

  const translations = entry.contributions.find(({ kind }) =>
    kind === PROJECT_DAG_RENDERER_I18N_CONTRIBUTION.kind
  )?.value as ProjectDagI18nResourceContribution
  assert.equal(translations.resources.en.rightPanelProjectDag, 'Project DAG')
  assert.equal(translations.resources.zh.rightPanelProjectDag, '项目 DAG')
})
