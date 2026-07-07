import { describe, expect, it } from 'vitest'
import { DEFAULT_DEV_PREVIEW_URL } from '@shared/dev-preview-url'
import {
  canUseElectronWebviewEnvironment,
  resolveDevPreviewNavigateEventUrl,
  resolveInitialDevBrowserUrl
} from './DevBrowserPanel'

describe('DevBrowserPanel webview environment detection', () => {
  it('requires the Electron user agent in addition to the shell bridge', () => {
    expect(
      canUseElectronWebviewEnvironment({
        openExternalAvailable: true,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'
      })
    ).toBe(false)
  })

  it('allows Electron renderer environments with the shell bridge', () => {
    expect(
      canUseElectronWebviewEnvironment({
        openExternalAvailable: true,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/132 Safari/537.36 Electron/34.2.0'
      })
    ).toBe(true)
  })

  it('rejects Electron-like pages when the shell bridge is absent', () => {
    expect(
      canUseElectronWebviewEnvironment({
        openExternalAvailable: false,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/132 Safari/537.36 Electron/34.2.0'
      })
    ).toBe(false)
  })
})

describe('DevBrowserPanel initial URL resolution', () => {
  it('uses the default local Vite preview when no URL source exists', () => {
    expect(
      resolveInitialDevBrowserUrl({
        normalizedPreferredUrl: null,
        storedUrl: null,
        latestDetectedUrl: null
      })
    ).toBe(DEFAULT_DEV_PREVIEW_URL)
  })

  it('prefers explicit preview URL sources in order', () => {
    expect(
      resolveInitialDevBrowserUrl({
        normalizedPreferredUrl: 'http://localhost:3000/',
        storedUrl: 'http://localhost:4000/',
        latestDetectedUrl: 'http://localhost:5000/'
      })
    ).toBe('http://localhost:3000/')

    expect(
      resolveInitialDevBrowserUrl({
        normalizedPreferredUrl: null,
        storedUrl: 'http://localhost:4000/',
        latestDetectedUrl: 'http://localhost:5000/'
      })
    ).toBe('http://localhost:4000/')

    expect(
      resolveInitialDevBrowserUrl({
        normalizedPreferredUrl: null,
        storedUrl: null,
        latestDetectedUrl: 'http://localhost:5000/'
      })
    ).toBe('http://localhost:5000/')
  })
})

describe('DevBrowserPanel popup navigation events', () => {
  it('accepts matching local preview navigation events', () => {
    expect(
      resolveDevPreviewNavigateEventUrl({
        url: 'http://127.0.0.1:4173/docs?tab=1',
        webContentsId: 42
      }, 42)
    ).toBe('http://127.0.0.1:4173/docs?tab=1')
  })

  it('rejects events for other webviews or non-preview URLs', () => {
    expect(
      resolveDevPreviewNavigateEventUrl({
        url: 'http://127.0.0.1:4173/docs',
        webContentsId: 42
      }, 7)
    ).toBeNull()
    expect(
      resolveDevPreviewNavigateEventUrl({
        url: 'https://example.com/docs',
        webContentsId: 42
      }, 42)
    ).toBeNull()
    expect(
      resolveDevPreviewNavigateEventUrl({
        url: 'http://127.0.0.1:4173/docs',
        webContentsId: '42'
      }, 42)
    ).toBeNull()
  })
})
