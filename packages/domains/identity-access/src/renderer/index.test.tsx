import { describe, expect, it, vi } from 'vitest'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import { IDENTITY_CAPABILITY_IDS } from '../contract.js'
import { createDomainRendererEntry } from './index.js'

describe('Identity renderer entry', () => {
  it('uses only the generic command, toolbar action, and global overlay hosts', () => {
    const entry = createDomainRendererEntry(rendererHost())

    expect(entry.contributions.map(({ kind }) => kind)).toEqual([
      'renderer.command',
      'renderer.workbench-toolbar-action',
      'renderer.workbench-global-overlay',
      'renderer.lifecycle',
      'renderer.i18n-resource'
    ])
  })

  it('opens the package-owned global overlay through its generic command', () => {
    const toggleGlobalOverlay = vi.fn()
    const entry = createDomainRendererEntry(rendererHost(toggleGlobalOverlay))
    const command = entry.contributions.find(({ kind }) => kind === 'renderer.command')!
      .value as { execute(input: { sessionId: string }): void }

    command.execute({ sessionId: 'thread-1' })

    expect(toggleGlobalOverlay).toHaveBeenCalledWith({
      contributionId: 'identity-access.account-overlay',
      sessionId: 'thread-1',
      open: true
    })
  })

  it('offers the optional first-run prompt through the same global overlay', async () => {
    const toggleGlobalOverlay = vi.fn()
    const entry = createDomainRendererEntry(rendererHost(toggleGlobalOverlay))
    const lifecycle = entry.contributions.find(({ kind }) => kind === 'renderer.lifecycle')!
      .value as { activate(): void | (() => void) }

    const dispose = lifecycle.activate()
    await vi.waitFor(() => expect(toggleGlobalOverlay).toHaveBeenCalledWith({
      contributionId: 'identity-access.account-overlay',
      open: true,
      activation: {
        revision: 1,
        payload: { mode: 'first-run' }
      }
    }))
    dispose?.()
  })
})

function rendererHost(toggleGlobalOverlay = vi.fn()): DomainRendererHost {
  return {
    capabilityInvoker: {
      observe: vi.fn(),
      invoke: vi.fn(async (contract) => {
        if (contract.actionId !== IDENTITY_CAPABILITY_IDS.listAccounts) {
          throw new Error(`Unexpected action ${contract.actionId}`)
        }
        return {
          state: {
            status: 'available',
            identityVersion: 0,
            currentAccount: null,
            accountCount: 0,
            firstPromptDismissed: false
          },
          accounts: []
        } as never
      })
    },
    openExternal: vi.fn(),
    workbench: {
      openRightPanel: vi.fn(),
      toggleGlobalOverlay
    }
  }
}
