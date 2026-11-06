// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DshMarketPlugin, DshMarketView } from '@shared/dsh-market'
import enCommon from '../../locales/en/common.json'
import zhCommon from '../../locales/zh/common.json'
import { MarketCatalog } from './MarketCatalog'

const plugin: DshMarketPlugin = {
  name: '@example/view', title: 'Example view', version: '1.0.0', categories: [], tools: [], capabilities: [],
  ports: ['view.list', 'view.capture'], hostDependencies: [], publisher: null, sizeBytes: 100, sha256: 'a'.repeat(64),
  approvalSnapshot: { packageName: '@example/view', version: '1.0.0', sha256: 'a'.repeat(64), publisher: null, entry: 'dist/main.js', tools: [], ports: ['view.list', 'view.capture'], hostDependencies: [] },
  runtimeNote: null, installed: false, enabled: false, installedVersion: null
}

describe('market installation Host operation approval', () => {
  let container: HTMLDivElement
  let root: Root
  const install = vi.fn(async () => ({ packageName: plugin.name, version: plugin.version, sha256: plugin.sha256, tools: [] }))
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    install.mockClear()
    Object.defineProperty(window, 'sciforge', { configurable: true, value: { market: {
      list: async () => ({ source: null, generatedAt: null, dshRuntimeVersion: null, plugins: [plugin], notInstallable: [], error: null }),
      install, progress: async () => null
    } } })
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
  async function render() {
    const i18n = i18next.createInstance()
    await i18n.init({ lng: 'en', defaultNS: 'common', resources: { en: { common: enCommon } } })
    await act(async () => root.render(createElement(I18nextProvider, { i18n }, createElement(MarketCatalog))))
  }
  function button(text: string) { return [...container.querySelectorAll('button')].find(item => item.textContent === text)! }
  it('starts unchecked, requires each operation, and sends exactly the checked approvals', async () => {
    await render()
    await act(async () => button('Install').click())
    const checks = [...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
    expect(checks).toHaveLength(3)
    expect(checks.every(input => !input.checked)).toBe(true)
    expect(button('Approve and install').disabled).toBe(true)
    await act(async () => checks[1].click())
    expect(button('Approve and install').disabled).toBe(true)
    expect(install).not.toHaveBeenCalled()
    await act(async () => checks[2].click())
    expect(button('Approve and install').disabled).toBe(false)
    await act(async () => button('Approve and install').click())
    expect(install).toHaveBeenCalledWith({ packageName: plugin.name, approvalSnapshot: plugin.approvalSnapshot, approvedToolNames: [], approvedPorts: ['view.list', 'view.capture'] })
  })
  it('refresh discards the reviewed identity and all checked approvals', async () => {
    await render()
    await act(async () => button('Install').click())
    await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
    expect(button('Approve and install').disabled).toBe(false)
    await act(async () => button('Refresh').click())
    expect(button('Approve and install')).toBeUndefined()
    await act(async () => button('Install').click())
    expect([...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].every(input => !input.checked)).toBe(true)
    expect(install).not.toHaveBeenCalled()
  })
  it('group approval is explicit and cancelling discards it', async () => {
    await render()
    await act(async () => button('Install').click())
    await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
    expect(button('Approve and install').disabled).toBe(false)
    await act(async () => button('Cancel').click())
    await act(async () => button('Install').click())
    expect([...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].every(input => !input.checked)).toBe(true)
    expect(button('Approve and install').disabled).toBe(true)
    expect(install).not.toHaveBeenCalled()
  })
})

const versionPlugin: DshMarketPlugin = {
  name: '@example/analysis',
  title: 'Example analysis',
  version: '0.4.0-mvp.2',
  categories: ['analysis'],
  tools: [
    { name: 'analyze', id: 'example.analyze', effect: 'compute' },
    { name: 'save', id: 'example.save', effect: 'workspace-write' }
  ],
  capabilities: [],
  ports: [],
  approvalSnapshot: {
    packageName: '@example/analysis', version: '0.4.0-mvp.2', sha256: 'a'.repeat(64),
    publisher: null, entry: 'dist/main.js',
    tools: [
      { name: 'analyze', id: 'example.analyze', effect: 'compute' },
      { name: 'save', id: 'example.save', effect: 'workspace-write' }
    ],
    ports: [], hostDependencies: ['python']
  },
  hostDependencies: ['python'],
  publisher: null,
  sizeBytes: 2048,
  sha256: 'a'.repeat(64),
  runtimeNote: null,
  installed: true,
  enabled: true,
  installedVersion: 'v1'
}

function marketView(entry: DshMarketPlugin): DshMarketView {
  return {
    plugins: [entry],
    notInstallable: [],
    source: null,
    generatedAt: null,
    dshRuntimeVersion: null,
    error: null
  }
}

describe('market catalog version installation', () => {
  let container: HTMLDivElement
  let root: Root
  let i18n: ReturnType<typeof i18next.createInstance>
  let current: DshMarketPlugin
  const market = {
    list: vi.fn(),
    install: vi.fn(),
    setEnabled: vi.fn(),
    uninstall: vi.fn(),
    progress: vi.fn()
  }

  beforeEach(async () => {
    vi.resetAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('sciforge', { market })
    current = { ...versionPlugin }
    market.list.mockImplementation(async () => marketView(current))
    market.install.mockImplementation(async () => {
      current = { ...current, installed: true, enabled: true, installedVersion: current.version }
    })
    market.progress.mockResolvedValue(null)
    i18n = i18next.createInstance()
    await i18n.init({
      lng: 'en',
      defaultNS: 'common',
      resources: { en: { common: enCommon }, zh: { common: zhCommon } }
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function render(): Promise<void> {
    await act(async () => root.render(createElement(I18nextProvider, { i18n },
      createElement(MarketCatalog))))
  }

  function button(label: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label)
  }

  it('shows the actual installed version and requires approval of catalog tools before replacing it', async () => {
    await render()
    expect(container.textContent).toContain('Installed: v1')
    expect(container.textContent).toContain(`${versionPlugin.name} · ${versionPlugin.version}`)
    expect(button('Disable')?.disabled).toBe(false)
    expect(button('Uninstall')?.disabled).toBe(false)

    await act(async () => button(`Install ${versionPlugin.version}`)!.click())
    expect(market.install).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Confirm installation')
    expect(container.textContent).toContain('analyze → example.analyze (compute; scope: global; readResource: none; approval: none; tags: )')
    expect(container.textContent).toContain('save → example.save (workspace write; scope: global; readResource: none; approval: none; tags: )')
    expect(container.textContent).toContain('Host-provided dependencies: python')

    await act(async () => button('Cancel')!.click())
    expect(button('Approve and install')).toBeUndefined()
    expect(market.install).not.toHaveBeenCalled()

    await act(async () => button(`Install ${versionPlugin.version}`)!.click())
    await act(async () => button('Approve and install')!.click())
    expect(market.install).toHaveBeenCalledExactlyOnceWith({
      packageName: versionPlugin.name,
      approvalSnapshot: versionPlugin.approvalSnapshot,
      approvedToolNames: ['analyze', 'save'], approvedPorts: []
    })
    expect(market.list).toHaveBeenCalledTimes(2)
    expect(button(`Install ${versionPlugin.version}`)).toBeUndefined()
    expect(container.textContent).not.toContain('Installed: v1')
    expect(button('Disable')).toBeDefined()
    expect(button('Uninstall')).toBeDefined()
  })

  it.each([versionPlugin.version, null])('keeps existing controls without offering replacement for installedVersion %s', async (installedVersion) => {
    current = { ...versionPlugin, installedVersion, enabled: false }
    await render()
    expect(button(`Install ${versionPlugin.version}`)).toBeUndefined()
    expect(button('Install')).toBeUndefined()
    expect(container.textContent).not.toContain('Installed:')
    await act(async () => button('Enable')!.click())
    expect(market.setEnabled).toHaveBeenCalledExactlyOnceWith({ packageName: versionPlugin.name, enabled: true })
    await act(async () => button('Uninstall')!.click())
    expect(market.uninstall).toHaveBeenCalledExactlyOnceWith({ packageName: versionPlugin.name })
    expect(market.install).not.toHaveBeenCalled()
  })

  it('offers a differing catalog version without assuming it is a semver upgrade', async () => {
    current = { ...versionPlugin, version: '1.0.0', installedVersion: '2.0.0', enabled: false }
    await render()
    expect(container.textContent).toContain('Installed: 2.0.0')
    expect(button('Install 1.0.0')?.disabled).toBe(false)
    expect(button('Enable')?.disabled).toBe(false)
    expect(button('Uninstall')?.disabled).toBe(false)
  })

  it('preserves first installation through the same approval flow', async () => {
    current = { ...versionPlugin, installed: false, installedVersion: null, enabled: false }
    await render()
    expect(button('Enable')).toBeUndefined()
    expect(button('Uninstall')).toBeUndefined()
    await act(async () => button('Install')!.click())
    expect(market.install).not.toHaveBeenCalled()
    await act(async () => button('Approve and install')!.click())
    expect(market.install).toHaveBeenCalledExactlyOnceWith({
      packageName: versionPlugin.name, approvalSnapshot: versionPlugin.approvalSnapshot,
      approvedToolNames: ['analyze', 'save'], approvedPorts: []
    })
  })

  it('translates both differing-version labels in Chinese', async () => {
    await i18n.changeLanguage('zh')
    await render()
    expect(container.textContent).toContain('已安装：v1')
    expect(button(`安装 ${versionPlugin.version}`)?.disabled).toBe(false)
  })
})
