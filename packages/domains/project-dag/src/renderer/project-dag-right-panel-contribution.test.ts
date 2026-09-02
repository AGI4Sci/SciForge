import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  PROJECT_DAG_RENDERER_I18N_CONTRIBUTION,
  PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRACT,
  PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  PROJECT_DAG_RENDERER_RESEARCH_SUMMARY_CONTRIBUTION,
  PROJECT_DAG_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import {
  createDomainRendererEntry,
  createProjectDagResourceNavigationContribution,
  type ProjectDagRightPanelContribution,
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
  assert.equal(entry.contributions.length, 4)

  const panelRuntime = entry.contributions.find(({ kind }) =>
    kind === PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind
  )!
  const panel = panelRuntime.value as ProjectDagRightPanelContribution
  assert.deepEqual(panelRuntime.contract, PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRACT)
  assert.deepEqual(PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRACT, {
    location: 'workbench.right-panel',
    title: 'Project DAG',
    resourceKind: 'project-dag'
  })
  assert.deepEqual(Object.keys(panel), ['render'])
  const rendered = panel.render({
    active: true,
    className: 'panel',
    focused: true,
    onCollapse: () => undefined,
    surfaceId: 'surface-project-a',
    session: { id: 'session-1', workspaceRoot: '/workspace/lab' },
    activation: {
      revision: 4,
      payload: { view: 'home' }
    }
  })
  const props = (rendered as ReactElement<Record<string, unknown>>).props
  assert.equal(props.className, 'panel')
  assert.equal(props.surfaceId, 'surface-project-a')
  assert.deepEqual(props.activation, {
    contributionId: 'project-dag.workbench-right-panel',
    revision: 4,
    payload: { view: 'home' }
  })
  assert.equal(props.workspacePreview, host.workspacePreview)
  assert.equal(props.workbench, host.workbench)
  assert.equal(typeof props.client, 'object')

  const summaryRuntime = entry.contributions.find(({ kind }) =>
    kind === PROJECT_DAG_RENDERER_RESEARCH_SUMMARY_CONTRIBUTION.kind
  )!
  assert.equal(typeof (summaryRuntime.value as { provide?: unknown }).provide, 'function')
  const navigationRuntime = entry.contributions.find(({ kind }) =>
    kind === PROJECT_DAG_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION.kind
  )!
  assert.equal(typeof (navigationRuntime.value as { resolve?: unknown }).resolve, 'function')

  const translations = entry.contributions.find(({ kind }) =>
    kind === PROJECT_DAG_RENDERER_I18N_CONTRIBUTION.kind
  )?.value as ProjectDagI18nResourceContribution
  assert.equal(translations.resources.en.rightPanelProjectDag, 'Project DAG')
  assert.equal(translations.resources.zh.rightPanelProjectDag, '项目 DAG')
})

test('preserves exact Project resource identities during contextual navigation', () => {
  const resolve = createProjectDagResourceNavigationContribution().resolve
  assert.deepEqual(resolve({
    sessionId: 'session-1',
    resource: { resourceKind: 'project-goal', resourceId: 'goal-7' }
  }), {
    activation: {
      revision: 1,
      payload: { view: 'goals', focus: { nodeId: 'goal-7' } }
    }
  })
  assert.deepEqual(resolve({
    sessionId: 'session-1',
    resource: { resourceKind: 'project-snapshot', resourceId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
  }), {
    activation: {
      revision: 1,
      payload: {
        view: 'graph',
        focus: { nodeId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
      }
    }
  })
})
