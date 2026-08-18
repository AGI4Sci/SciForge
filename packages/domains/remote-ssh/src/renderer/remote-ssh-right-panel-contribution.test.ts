import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  REMOTE_SSH_RENDERER_COMMAND_CONTRIBUTION,
  REMOTE_SSH_RENDERER_I18N_CONTRIBUTION,
  REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRACT,
  REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  REMOTE_SSH_RENDERER_TOOLBAR_ACTION_CONTRACT,
  REMOTE_SSH_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import {
  createDomainRendererEntry,
  type RemoteSshRightPanelContribution,
  type RemoteSshToolbarActionContribution
} from './remote-ssh-right-panel-contribution'
import type { RemoteSshI18nResourceContribution } from './remote-ssh-messages'

describe('Remote SSH right-panel contribution', () => {
  it('creates declared Workbench and translation values without host side effects', () => {
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
      workspace: {
        pickFile: async () => ({ canceled: true, path: null }),
        openRemoteSession: async () => undefined
      },
      workbench: { openRightPanel: () => undefined }
    }

    const entry = createDomainRendererEntry(host)
    expect(entry.process).toBe('renderer')
    expect(entry.definition).toEqual(domainPackageDefinition)
    expect(entry.contributions).toHaveLength(4)

    const runtime = entry.contributions.find(({ kind }) =>
      kind === REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind
    )!
    const panel = runtime.value as RemoteSshRightPanelContribution
    expect(runtime.id).toBe(REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRIBUTION.id)
    expect(runtime.contract).toEqual(REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRACT)
    expect(REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRACT).toEqual({
      location: 'workbench.right-panel',
      title: 'Remote targets',
      resourceKind: 'remote-ssh-target'
    })
    expect(Object.keys(panel)).toEqual(['render'])
    const rendered = panel.render({
      active: true,
      className: 'panel',
      focused: true,
      onCollapse: () => undefined,
      surfaceId: 'surface-remote-a',
      session: {
        id: 'session-remote',
        workspaceRoot: '/workspace'
      }
    })
    const props = (rendered as ReactElement<Record<string, unknown>>).props
    expect(props.className).toBe('panel')
    expect(props.workspaceId).toBe('/workspace')
    expect(typeof props.capabilityClient).toBe('object')
    expect(props.openExternal).toBe(host.openExternal)
    expect(props.openRemoteSession).toBe(host.workspace?.openRemoteSession)

    const command = entry.contributions.find(({ kind }) =>
      kind === REMOTE_SSH_RENDERER_COMMAND_CONTRIBUTION.kind
    )!.value as { execute: unknown; isAvailable?: unknown; isActive?: unknown }
    expect(typeof command.execute).toBe('function')
    expect(typeof command.isAvailable).toBe('function')
    expect(typeof command.isActive).toBe('function')

    const toolbarRuntime = entry.contributions.find(({ kind }) =>
      kind === REMOTE_SSH_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.kind
    )!
    const toolbar = toolbarRuntime.value as RemoteSshToolbarActionContribution
    expect(toolbarRuntime.contract).toEqual(REMOTE_SSH_RENDERER_TOOLBAR_ACTION_CONTRACT)
    expect(typeof toolbar.icon).toBe('object')

    const translations = entry.contributions.find(({ kind }) =>
      kind === REMOTE_SSH_RENDERER_I18N_CONTRIBUTION.kind
    )?.value as RemoteSshI18nResourceContribution
    expect(translations.namespace).toBe('common')
    expect(translations.resources.en.remoteSshTitle).toBe('Remote Targets')
    expect(translations.resources.zh.remoteSshTitle).toBe('远程资源')
  })
})
