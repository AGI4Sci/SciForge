import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeSettingsCard, runLatestRuntimeDiscovery } from './runtime-settings-card'
import { defaultCapabilities } from '../agent/agent-runtime-provider'
import en from '../locales/en/settings.json'
import zh from '../locales/zh/settings.json'

describe('neutral runtime settings card', () => {
  it('shows independent DSH selection and unsupported capabilities, not raw spawn failures', () => {
    const html = renderToStaticMarkup(createElement(RuntimeSettingsCard, {
      runtimeId: 'dsh', command: '/opt/dsh', selected: false, onSelect: vi.fn(), onCommand: vi.fn(),
      t: (key: string) => (en as Record<string, string>)[key] ?? key,
      capabilities: defaultCapabilities('dsh'),
      discovery: { runtimeId: 'dsh', available: false, executablePath: null, version: null, source: null, protocol: null,
        failure: { code: 'runtime_not_found', technicalDetail: 'spawn /opt/dsh ENOENT' } }
    }))
    expect(html).toContain('DeepSeek Harness (DSH)')
    expect(html).toContain('Select runtime')
    expect(html).toContain('Image input: Unsupported')
    expect(html).toContain('Fork: Unsupported')
    expect(html).toContain('Steer: Unsupported')
    expect(html).not.toContain('ENOENT')
    expect(html).toContain('Choose local executable')
  })
  it('has actionable localized recovery text without asserting real-model acceptance', () => {
    for (const locale of [en, zh]) {
      expect(locale.runtimeDiscoveryUnavailable).toBeTruthy()
      expect(locale.runtimeDiscoveryUnavailable).not.toMatch(/ENOENT/)
      expect(locale.dshRuntimeDesc).toBeTruthy()
    }
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
