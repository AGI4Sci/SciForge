// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeDiscoveryResult } from '@shared/agent-runtime-contract'
import { applyDshRuntimePatch, normalizeAppSettings, type AppSettingsV1 } from '@shared/app-settings'
import { RuntimeSettingsCard, runLatestRuntimeDiscovery } from './runtime-settings-card'
import { defaultCapabilities } from '../agent/agent-runtime-provider'
import en from '../locales/en/settings.json'
import zh from '../locales/zh/settings.json'
import enCommon from '../locales/en/common.json'
import zhCommon from '../locales/zh/common.json'

const provider = vi.hoisted(() => ({
  probe: vi.fn(),
  getRuntimeCapabilities: vi.fn(),
  getRecoveryOptions: vi.fn(() => ({})),
  normalizeExecutablePath: vi.fn((_id: string, path: string) => path)
}))
vi.mock('../agent/registry', () => ({ getProvider: () => provider }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const t = (key: string): string => (en as Record<string, string>)[key] ?? key
const tCommon = (key: string): string => {
  const value = enCommon[key as keyof typeof enCommon]
  return typeof value === 'string' ? value : key
}
const unavailable = (command: string): AgentRuntimeDiscoveryResult => ({
  runtimeId: 'dsh', available: false, executablePath: command, source: 'user-configured',
  version: null, protocol: null, failure: { code: 'runtime_not_found' }
})
let container: HTMLDivElement
let root: Root | undefined
beforeEach(() => {
  provider.probe.mockReset().mockImplementation(async (_id: string, command: string) => unavailable(command))
  provider.getRuntimeCapabilities.mockReset().mockResolvedValue(defaultCapabilities('dsh'))
  provider.normalizeExecutablePath.mockClear()
  container = document.createElement('div')
  document.body.append(container)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container.remove()
  vi.unstubAllGlobals()
})
function button(label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find((item) => item.textContent === label)
  expect(result).toBeDefined()
  return result!
}

describe('neutral runtime settings card', () => {
  it('shows independent DSH selection and unsupported capabilities, not raw spawn failures', () => {
    const html = renderToStaticMarkup(createElement(RuntimeSettingsCard, {
      runtimeId: 'dsh', command: '/opt/dsh', selected: false, onSelect: vi.fn(), onCommand: vi.fn(),
      t, tCommon, capabilities: defaultCapabilities('dsh'),
      discovery: { ...unavailable('/opt/dsh'), failure: { code: 'runtime_not_found', technicalDetail: 'spawn /opt/dsh ENOENT' } }
    }))
    expect(html).toContain('DeepSeek Harness (DSH)')
    expect(html).toContain('Select runtime')
    expect(html).toContain('Image input: Unsupported')
    expect(html).toContain('Fork: Unsupported')
    expect(html).toContain('Steer: Unsupported')
    expect(html).not.toContain('ENOENT')
    expect(html).toContain('Choose local executable')
    expect(html).toContain(enCommon.runtimeDiscoveryNotFound)
  })

  it.each([
    ['en', en, enCommon], ['zh', zh, zhCommon]
  ] as const)('resolves settings and common diagnostics in their actual %s namespaces', async (language, settings, common) => {
    const i18n = createInstance()
    await i18n.init({ lng: language, fallbackLng: false, fallbackNS: false, resources: {
      [language]: { settings, common }
    } })
    for (const source of ['user-configured', 'process-path', 'login-shell-path', 'common-install-location', 'application-bundle', 'packaged-application'] as const) {
      for (const integrity of ['pinned', 'derived'] as const) {
        const html = renderToStaticMarkup(createElement(RuntimeSettingsCard, {
          runtimeId: 'dsh', command: '/opt/dsh', selected: false, onSelect: vi.fn(), onCommand: vi.fn(),
          t: (key) => i18n.t(key, { ns: 'settings' }),
          tCommon: (key) => i18n.t(key, { ns: 'common' }),
          discovery: { ...unavailable('/opt/dsh'), source, version: '0.2.1', deploymentIntegrity: integrity }
        }))
        const text = new DOMParser().parseFromString(html, 'text/html').body.textContent
        const sourceKey = `runtimeDiscoverySource_${source.replaceAll('-', '_')}`
        expect(text).toContain(common.runtimeDiscoveryDetectedFrom)
        expect(text).toContain(common[sourceKey as keyof typeof common])
        expect(text).toContain(common.runtimeDiscoveryVersionLabel)
        expect(text).toContain(common[integrity === 'pinned' ? 'runtimeDeploymentIntegrityPinned' : 'runtimeDeploymentIntegrityDerived'])
        expect(text).toContain(common.runtimeDiscoveryNotFound)
        expect(text).toContain(settings.runtimeChooseExecutable)
        expect(text).not.toMatch(/runtime(?:Discovery|DeploymentIntegrity|Support)[A-Z_]/u)
      }
    }
  })

  it('uses the single command for edits, re-detection and picked executables without losing other settings', async () => {
    let saved = normalizeAppSettings({ agents: { dsh: {
      command: '/old/dsh', selectedModel: 'v4-pro', reasoningEffort: 'high', commandExecution: true
    } } } as AppSettingsV1)
    function Harness() {
      const [settings, setSettings] = useState(saved)
      return createElement(RuntimeSettingsCard, {
        runtimeId: 'dsh', command: settings.agents.dsh!.command, selected: true,
        onSelect: vi.fn(), t, tCommon,
        onCommand: (command) => { saved = applyDshRuntimePatch(settings, { command }); setSettings(saved) }
      })
    }
    root = createRoot(container)
    await act(async () => root!.render(createElement(Harness)))
    expect(provider.probe).toHaveBeenLastCalledWith('dsh', '/old/dsh')
    await act(async () => {
      const input = container.querySelector('input')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '/typed/dsh')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(saved.agents.dsh?.command).toBe('/typed/dsh')
    await act(async () => button(en.runtimeDetect).click())
    expect(provider.probe).toHaveBeenLastCalledWith('dsh', '/typed/dsh')

    const pickFile = vi.fn().mockResolvedValueOnce({ canceled: true, path: null })
      .mockResolvedValueOnce({ canceled: false, path: '/picked/DSH.app' })
    Object.defineProperty(window, 'sciforge', { configurable: true, value: { pickFile } })
    provider.normalizeExecutablePath.mockReturnValueOnce('/picked/DSH.app/bin/dsh')
    await act(async () => button(en.runtimeChooseExecutable).click())
    expect(saved.agents.dsh?.command).toBe('/typed/dsh')
    expect(provider.normalizeExecutablePath).not.toHaveBeenCalled()
    await act(async () => button(en.runtimeChooseExecutable).click())
    expect(provider.normalizeExecutablePath).toHaveBeenCalledWith('dsh', '/picked/DSH.app')
    expect(provider.probe).toHaveBeenLastCalledWith('dsh', '/picked/DSH.app/bin/dsh')
    expect(saved.agents.dsh).toEqual({
      sandboxMode: 'workspace-write',
      command: '/picked/DSH.app/bin/dsh', selectedModel: 'v4-pro', reasoningEffort: 'high', commandExecution: true
    })
    expect(container.querySelectorAll('input')).toHaveLength(1)
  })

  it('does not let an earlier command probe replace the current diagnostic result', async () => {
    let finishOld!: (result: AgentRuntimeDiscoveryResult) => void
    provider.probe.mockImplementation((_id: string, command: string) => command === '/old/dsh'
      ? new Promise<AgentRuntimeDiscoveryResult>((resolve) => { finishOld = resolve })
      : Promise.resolve({ ...unavailable(command), version: 'current-version' }))
    const props = { runtimeId: 'dsh' as const, selected: false, onSelect: vi.fn(), onCommand: vi.fn(), t, tCommon }
    root = createRoot(container)
    await act(async () => root!.render(createElement(RuntimeSettingsCard, { ...props, command: '/old/dsh' })))
    await act(async () => root!.render(createElement(RuntimeSettingsCard, { ...props, command: '/new/dsh' })))
    expect(container.textContent).toContain('current-version')
    await act(async () => finishOld({ ...unavailable('/old/dsh'), version: 'stale-version' }))
    expect(container.textContent).toContain('current-version')
    expect(container.textContent).not.toContain('stale-version')
    expect(button(en.runtimeDetect).disabled).toBe(false)
  })

  it('drops a late probe after invalidation and rejects a mismatched runtime result', async () => {
    let release!: (value: { runtimeId: string }) => void
    const sequence = { current: 0 }
    const probe = vi.fn(() => new Promise<{ runtimeId: string }>((resolve) => { release = resolve }))
    const result = runLatestRuntimeDiscovery('dsh', '/opt/dsh', sequence, probe)
    sequence.current++
    release({ runtimeId: 'dsh' })
    expect(await result).toEqual({ status: 'stale' })
    expect(probe).toHaveBeenCalledWith('dsh', '/opt/dsh')
    expect(await runLatestRuntimeDiscovery('dsh', 'dsh', sequence, async () => ({ runtimeId: 'codex' })))
      .toEqual({ status: 'stale' })
  })
})
