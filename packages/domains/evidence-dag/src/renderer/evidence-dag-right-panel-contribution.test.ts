import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRACT,
  EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RESEARCH_SUMMARY_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_GLOBAL_OVERLAY_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import {
  createDomainRendererEntry,
  type EvidenceDagRightPanelContribution,
} from './evidence-dag-right-panel-contribution'
import type { EvidenceDagI18nResourceContribution } from './evidence-dag-messages'

test('contributes the package-owned Evidence panel and translations', () => {
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
  assert.equal(entry.contributions.length, 8)

  const panelRuntime = entry.contributions.find(({ kind }) =>
    kind === EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind
  )!
  const panel = panelRuntime.value as EvidenceDagRightPanelContribution
  assert.deepEqual(panelRuntime.contract, EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRACT)
  assert.deepEqual(EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRACT, {
    location: 'workbench.right-panel',
    title: 'Evidence DAG',
    titleKey: 'common:rightPanelEvidenceDag',
    resourceKind: 'evidence-dag',
    navigation: 'resource-only'
  })
  assert.deepEqual(Object.keys(panel), ['render'])
  const rendered = panel.render({
    active: true,
    className: 'panel',
    focused: true,
    onCollapse: () => undefined,
    surfaceId: 'surface-evidence-a',
    session: { id: 'thread-1', runtimeId: 'codex' },
    activation: {
      revision: 3,
      payload: { runtimeId: 'codex', threadId: 'thread-1' }
    }
  })
  const props = (rendered as ReactElement<Record<string, unknown>>).props
  assert.equal(props.className, 'panel')
  assert.equal(props.focused, true)
  assert.equal(props.surfaceId, 'surface-evidence-a')
  assert.deepEqual(props.activation, {
    contributionId: 'evidence-dag.workbench-right-panel',
    revision: 3,
    payload: { runtimeId: 'codex', threadId: 'thread-1' }
  })
  assert.equal(props.workspacePreview, host.workspacePreview)
  assert.equal(typeof props.client, 'object')
  const overlayRuntime = entry.contributions.find(({ kind }) => kind === EVIDENCE_DAG_RENDERER_GLOBAL_OVERLAY_CONTRIBUTION.kind)!
  const overlay = overlayRuntime.value as import('@sciforge/domain-sdk/renderer').DomainRendererWorkbenchGlobalOverlayValue<ReactElement>
  assert.equal(overlay.placement, 'workspace')
  const scope = { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '/workspace' }
  const overlayElement = overlay.render({ active: true, className: 'absolute inset-0', session: { id: 'other-active-thread' },
    activation: { revision: 1, payload: { recordScope: scope } }, onClose: () => undefined })
  const recordPanel = (overlayElement.props as { children: ReactElement<Record<string, unknown>> }).children
  assert.deepEqual(recordPanel.props.scope, scope)
  assert.equal(recordPanel.props.presentation, (props.getPresentation as (scope: unknown) => unknown)(scope))

  const summaryRuntime = entry.contributions.find(({ kind }) =>
    kind === EVIDENCE_DAG_RENDERER_RESEARCH_SUMMARY_CONTRIBUTION.kind
  )!
  assert.equal(typeof (summaryRuntime.value as { provide?: unknown }).provide, 'function')
  const navigationRuntime = entry.contributions.find(({ kind }) =>
    kind === EVIDENCE_DAG_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION.kind
  )!
  assert.equal(typeof (navigationRuntime.value as { resolve?: unknown }).resolve, 'function')

  const translations = entry.contributions.find(({ kind }) =>
    kind === EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION.kind
  )?.value as EvidenceDagI18nResourceContribution
  assert.equal(translations.resources.en.rightPanelEvidenceDag, 'Research record & evidence')
  assert.equal(translations.resources.zh.rightPanelEvidenceDag, '研究记录与证据')
})
