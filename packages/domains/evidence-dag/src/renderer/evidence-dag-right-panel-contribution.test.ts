import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  EVIDENCE_DAG_RENDERER_COMMAND_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRACT,
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
    workspacePreview: { open: () => undefined },
    workbench: { openRightPanel: () => undefined }
  }
  const entry = createDomainRendererEntry(host)
  assert.equal(entry.process, 'renderer')
  assert.deepEqual(entry.definition, domainPackageDefinition)
  assert.equal(entry.contributions.length, 4)

  const panelRuntime = entry.contributions.find(({ kind }) =>
    kind === EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind
  )!
  const panel = panelRuntime.value as EvidenceDagRightPanelContribution
  assert.deepEqual(panelRuntime.contract, EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRACT)
  assert.deepEqual(EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRACT, {
    location: 'workbench.right-panel',
    title: 'Evidence DAG',
    resourceKind: 'evidence-dag'
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

  const command = entry.contributions.find(({ kind }) =>
    kind === EVIDENCE_DAG_RENDERER_COMMAND_CONTRIBUTION.kind
  )!.value as { execute: unknown; isAvailable?: unknown; isActive?: unknown }
  assert.equal(typeof command.execute, 'function')
  assert.equal(typeof command.isAvailable, 'function')
  assert.equal(typeof command.isActive, 'function')

  const toolbarRuntime = entry.contributions.find(({ kind }) =>
    kind === EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.kind
  )!
  const toolbar = toolbarRuntime.value as EvidenceDagToolbarActionContribution
  assert.deepEqual(toolbarRuntime.contract, EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRACT)
  assert.equal(typeof toolbar.icon, 'object')

  const translations = entry.contributions.find(({ kind }) =>
    kind === EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION.kind
  )?.value as EvidenceDagI18nResourceContribution
  assert.equal(translations.resources.en.rightPanelEvidenceDag, 'Evidence DAG')
  assert.equal(translations.resources.zh.rightPanelEvidenceDag, '证据 DAG')
})
