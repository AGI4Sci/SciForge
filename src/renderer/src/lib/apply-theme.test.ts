import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyDocumentLocale, applyUiFontScale } from './apply-theme'

describe('applyDocumentLocale', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes a BCP-47 tag onto <html lang> for each supported locale', () => {
    const attributes = new Map<string, string>()
    vi.stubGlobal('document', {
      documentElement: {
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => {
          attributes.set(name, value)
        }
      }
    })

    applyDocumentLocale('en')
    expect(attributes.get('lang')).toBe('en')

    applyDocumentLocale('zh')
    expect(attributes.get('lang')).toBe('zh-CN')
  })

  it('does not touch the attribute when the locale already matches', () => {
    let writes = 0
    vi.stubGlobal('document', {
      documentElement: {
        getAttribute: () => 'en',
        setAttribute: () => {
          writes += 1
        }
      }
    })

    applyDocumentLocale('en')
    expect(writes).toBe(0)
  })
})

describe('applyUiFontScale', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefers native page zoom and disables CSS zoom when the preload bridge supports it', () => {
    const properties = new Map<string, string>()
    const setUiZoomFactor = vi.fn()
    vi.stubGlobal('document', {
      documentElement: {
        style: {
          setProperty: (name: string, value: string) => properties.set(name, value)
        }
      }
    })
    vi.stubGlobal('window', { sciforge: { setUiZoomFactor } })

    applyUiFontScale('small')

    expect(properties.get('--ds-ui-scale')).toBe('1')
    expect(setUiZoomFactor).toHaveBeenCalledWith(0.82)
  })

  it('keeps the CSS zoom fallback for browser-only development', () => {
    const properties = new Map<string, string>()
    vi.stubGlobal('document', {
      documentElement: {
        style: {
          setProperty: (name: string, value: string) => properties.set(name, value)
        }
      }
    })
    vi.stubGlobal('window', {})

    applyUiFontScale('medium')

    expect(properties.get('--ds-ui-scale')).toBe('0.88')
  })
})
