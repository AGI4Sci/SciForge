import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  REMOTE_SSH_RENDERER_I18N_CONTRIBUTION,
  REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import {
  createDomainRendererEntry,
  type RemoteSshRightPanelContribution
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
      openExternal: () => undefined
    }

    const entry = createDomainRendererEntry(host)
    expect(entry.process).toBe('renderer')
    expect(entry.definition).toEqual(domainPackageDefinition)
    expect(entry.contributions).toHaveLength(2)

    const runtime = entry.contributions.find(({ kind }) =>
      kind === REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind
    )!
    const panel = runtime.value as RemoteSshRightPanelContribution
    expect(runtime.id).toBe(REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRIBUTION.id)
    expect({
      id: panel.id,
      mode: panel.mode,
      label: panel.label,
      title: panel.title,
      resourceKind: panel.resourceKind
    }).toEqual({
      id: 'remote-ssh.workbench-right-panel',
      mode: 'remote-ssh',
      label: 'rightPanelRemoteSsh',
      title: 'Remote targets',
      resourceKind: 'remote-ssh-target'
    })
    expect(panel.isAvailable()).toBe(true)

    const rendered = panel.render({
      active: true,
      className: 'panel',
      onCollapse: () => undefined,
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

    const translations = entry.contributions.find(({ kind }) =>
      kind === REMOTE_SSH_RENDERER_I18N_CONTRIBUTION.kind
    )?.value as RemoteSshI18nResourceContribution
    expect(translations.namespace).toBe('common')
    expect(translations.resources.en.remoteSshTitle).toBe('Remote Targets')
    expect(translations.resources.zh.remoteSshTitle).toBe('远程资源')
  })
})
