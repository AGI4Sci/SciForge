// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enCommon from '../../locales/en/common.json'
import { ExtensionCatalog, type ExtensionCatalogItem, type ExtensionCatalogProps } from './ExtensionCatalog'

const plugin: ExtensionCatalogItem = {
  id: 'example.ui',
  displayName: 'Example UI',
  packageName: '@example/ui',
  publisher: 'Example',
  version: '0.1.0',
  source: 'development',
  official: false,
  verification: 'development-local',
  execution: 'sandboxed-runtime',
  status: 'disabled',
  enabled: false,
  permissions: [],
  contributionKinds: ['renderer.workbench-right-panel'],
  contributionCount: 1,
  canRollback: false
}

describe('extension details lifecycle controls', () => {
  let container: HTMLDivElement
  let root: Root
  let i18n: ReturnType<typeof i18next.createInstance>

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    i18n = i18next.createInstance()
    await i18n.init({ lng: 'en', resources: { en: { common: enCommon } } })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function render(props: ExtensionCatalogProps): Promise<void> {
    await act(async () => root.render(createElement(I18nextProvider, { i18n },
      createElement(ExtensionCatalog, props))))
  }

  function button(label: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label)
  }

  async function openDetails(): Promise<void> {
    await act(async () => container.querySelector<HTMLButtonElement>(
      '[aria-label="Show details for Example UI"]'
    )!.click())
  }

  it('enables a disabled plugin and uses refreshed host state to disable it without reopening details', async () => {
    const onSetEnabled = vi.fn()
    await render({ extensions: [plugin], onSetEnabled })
    await openDetails()
    expect(button('Enable')?.disabled).toBe(false)
    await act(async () => button('Enable')!.click())
    expect(onSetEnabled).toHaveBeenCalledWith(plugin, true)

    const active: ExtensionCatalogItem = { ...plugin, status: 'active', enabled: true, generation: 1 }
    await render({ extensions: [active], onSetEnabled })
    expect(container.textContent).toContain('Active')
    expect(button('Enable')).toBeUndefined()
    await act(async () => button('Disable')!.click())
    expect(onSetEnabled).toHaveBeenLastCalledWith(active, false)
  })

  it('shows the candidate and rollback actions after each host refresh without losing selection', async () => {
    const onCheckCandidate = vi.fn()
    const onApplyCandidate = vi.fn()
    const onRollback = vi.fn()
    const callbacks = { onCheckCandidate, onApplyCandidate, onRollback }
    const active: ExtensionCatalogItem = { ...plugin, status: 'active', enabled: true }
    await render({ extensions: [active], ...callbacks })
    await openDetails()
    await act(async () => button('Check candidate version')!.click())
    expect(onCheckCandidate).toHaveBeenCalledWith(active)

    const candidate = { ...active, candidateVersion: '0.2.0' }
    await render({ extensions: [candidate], ...callbacks })
    expect(container.textContent).toContain('candidate 0.2.0')
    await act(async () => button('Apply update')!.click())
    expect(onApplyCandidate).toHaveBeenCalledWith(candidate)

    const updated = { ...active, version: '0.2.0', canRollback: true }
    await render({ extensions: [updated], ...callbacks })
    expect(button('Apply update')).toBeUndefined()
    expect(container.textContent).toContain('0.2.0')
    await act(async () => button('Roll back')!.click())
    expect(onRollback).toHaveBeenCalledWith(updated)
  })

  it('prevents repeated lifecycle requests while an operation is in progress', async () => {
    const onSetEnabled = vi.fn()
    await render({ extensions: [plugin], busyPackageName: plugin.packageName, onSetEnabled })
    await openDetails()
    expect(button('Enable')?.disabled).toBe(true)
    await act(async () => button('Enable')!.click())
    expect(onSetEnabled).not.toHaveBeenCalled()
  })

  it('uses the desired enabled flag when a restart is pending', async () => {
    await render({ extensions: [{ ...plugin, status: 'restart-required' }], onSetEnabled: vi.fn() })
    await openDetails()
    expect(button('Enable')?.disabled).toBe(false)
    expect(button('Disable')).toBeUndefined()
  })

  it('blocks enabling an invalid plugin but still allows disabling a failed running plugin', async () => {
    const onSetEnabled = vi.fn()
    await render({ extensions: [{ ...plugin, status: 'invalid' }], onSetEnabled })
    await openDetails()
    expect(button('Enable')?.disabled).toBe(true)

    const failed: ExtensionCatalogItem = { ...plugin, status: 'invalid', enabled: true }
    await render({ extensions: [failed], onSetEnabled })
    expect(button('Disable')?.disabled).toBe(false)
    await act(async () => button('Disable')!.click())
    expect(onSetEnabled).toHaveBeenCalledWith(failed, false)
  })

  it('does not offer runtime lifecycle controls for bundled extensions', async () => {
    await render({ extensions: [{ ...plugin, source: 'bundled' }], onSetEnabled: vi.fn() })
    await openDetails()
    expect(button('Enable')).toBeUndefined()
    expect(button('Disable')).toBeUndefined()
  })
})
