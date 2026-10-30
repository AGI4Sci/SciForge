import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSafeExternalUrl, openSafeExternalUrl } from './open-external'

describe('open external links', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('allows only browser-safe external protocols', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true)
    expect(isSafeExternalUrl('http://127.0.0.1:5173')).toBe(true)
    expect(isSafeExternalUrl('mailto:test@example.com')).toBe(true)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('file:///tmp/secret')).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
  })

  it('uses the preload shell bridge for safe URLs', async () => {
    const openExternal = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      sciforge: { openExternal },
      open: vi.fn()
    })

    await expect(openSafeExternalUrl(' https://example.com/docs ')).resolves.toBe(true)
    await expect(openSafeExternalUrl('file:///tmp/secret')).resolves.toBe(false)

    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })
})
