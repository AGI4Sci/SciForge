import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeBanner, runtimeDiscoveryForActiveRuntime } from './RuntimeBanner'

describe('RuntimeBanner', () => {
  it('does not expose a Codex diagnostic while another runtime is active', () => {
    expect(runtimeDiscoveryForActiveRuntime('claude', {
      runtimeId: 'codex',
      available: false,
      executablePath: null,
      source: null,
      version: null,
      protocol: null,
      failure: { code: 'runtime_not_found' }
    })).toBeNull()
  })

  it('renders a details affordance when technical details are available', () => {
    const html = renderToStaticMarkup(createElement(RuntimeBanner, {
      message: 'Runtime request failed.',
      detail: 'Code: provider_unavailable\n\nMessage:\nprovider failed',
      logPath: '/tmp/sciforge/logs',
      runtimeReady: true,
      stageInsetClass: 'px-4',
      t: (key: string) => key,
      onOpenLogDir: vi.fn(),
      onOpenSettings: vi.fn(),
      onRetryConnection: vi.fn()
    }))

    expect(html).toContain('Runtime request failed.')
    expect(html).toContain('runtimeErrorDetails')
    expect(html).toContain('runtimeErrorLogPath')
    expect(html).toContain('/tmp/sciforge/logs')
    expect(html).toContain('windowsMenuOpenLogDir')
  })

  it('renders structured discovery recovery without exposing low-level spawn errors', () => {
    const html = renderToStaticMarkup(createElement(RuntimeBanner, {
      message: 'SciForge could not find a compatible local assistant.',
      discovery: {
        runtimeId: 'codex',
        available: false,
        executablePath: null,
        source: null,
        version: null,
        protocol: null,
        failure: { code: 'runtime_not_found', technicalDetail: 'spawn codex ENOENT' }
      },
      runtimeReady: false,
      stageInsetClass: 'px-4',
      t: (key: string) => key,
      onOpenSettings: vi.fn(),
      onRetryConnection: vi.fn(),
      onChooseRuntime: vi.fn(),
      onOpenInstallGuide: vi.fn()
    }))

    expect(html).toContain('runtimeDiscoveryNotFound')
    expect(html).toContain('retryConnection')
    expect(html).toContain('runtimeChooseLocalApp')
    expect(html).toContain('runtimeInstallGuide')
    expect(html).not.toContain('ENOENT')
  })
})
