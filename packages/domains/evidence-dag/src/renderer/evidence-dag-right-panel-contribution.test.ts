import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRACT,
  EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import {
  createDomainRendererEntry,
  type EvidenceDagRightPanelContribution,
  type EvidenceDagToolbarActionContribution
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
    workspacePreview: { open: () => undefined }
  }
  const entry = createDomainRendererEntry(host)
  assert.equal(entry.process, 'renderer')
  assert.deepEqual(entry.definition, domainPackageDefinition)
  assert.equal(entry.contributions.length, 3)

  const panel = entry.contributions.find(({ kind }) =>
    kind === EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind
  )?.value as EvidenceDagRightPanelContribution
  assert.deepEqual({
    id: panel.id,
    mode: panel.mode,
    title: panel.title,
    resourceKind: panel.resourceKind
  }, {
    id: 'evidence-dag.workbench-right-panel',
    mode: 'evidence-dag',
    title: 'Evidence DAG',
    resourceKind: 'evidence-dag'
  })
  const rendered = panel.render({
    active: true,
    className: 'panel',
    onCollapse: () => undefined,
    session: { id: 'thread-1', runtimeId: 'codex' }
  })
  const props = (rendered as ReactElement<Record<string, unknown>>).props
  assert.equal(props.className, 'panel')
  assert.equal(props.workspacePreview, host.workspacePreview)
  assert.equal(typeof props.client, 'object')

  const toolbarRuntime = entry.contributions.find(({ kind }) =>
    kind === EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.kind
  )!
  const toolbar = toolbarRuntime.value as EvidenceDagToolbarActionContribution
  assert.deepEqual(toolbarRuntime.contract, EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRACT)
  assert.equal(typeof toolbar.icon, 'object')
  assert.equal(toolbar.isAvailable(), true)

  const translations = entry.contributions.find(({ kind }) =>
    kind === EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION.kind
  )?.value as EvidenceDagI18nResourceContribution
  assert.equal(translations.resources.en.rightPanelEvidenceDag, 'Evidence DAG')
  assert.equal(translations.resources.zh.rightPanelEvidenceDag, '证据 DAG')
})
