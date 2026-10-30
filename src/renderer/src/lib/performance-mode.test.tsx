// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppSettingsV1 } from '@shared/app-settings'
import { SETTINGS_CHANGED_EVENT } from './keyboard-shortcut-settings'
import {
  PERFORMANCE_MODE_CLASS,
  isPerformanceModeEnabled,
  usePerformanceMode,
  usePerformanceModeStore
} from './performance-mode'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function PerformanceModeProbe(): null {
  usePerformanceMode()
  return null
}

function emitSettings(performanceMode: boolean): void {
  window.dispatchEvent(
    new CustomEvent(SETTINGS_CHANGED_EVENT, {
      detail: { performanceMode } as AppSettingsV1
    })
  )
}

describe('usePerformanceMode', () => {
  let root: Root | undefined

  beforeEach(async () => {
    usePerformanceModeStore.setState({ enabled: false })
    document.documentElement.classList.remove(PERFORMANCE_MODE_CLASS)
    await act(async () => {
      root = createRoot(document.body.appendChild(document.createElement('div')))
      root.render(createElement(PerformanceModeProbe))
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
      root = undefined
    }
    document.body.innerHTML = ''
    document.documentElement.classList.remove(PERFORMANCE_MODE_CLASS)
  })

  it('stays off by default', () => {
    expect(isPerformanceModeEnabled()).toBe(false)
    expect(document.documentElement.classList.contains(PERFORMANCE_MODE_CLASS)).toBe(false)
  })

  it('mirrors settings changes onto the root element class', async () => {
    await act(async () => {
      emitSettings(true)
    })
    expect(isPerformanceModeEnabled()).toBe(true)
    expect(document.documentElement.classList.contains(PERFORMANCE_MODE_CLASS)).toBe(true)

    await act(async () => {
      emitSettings(false)
    })
    expect(isPerformanceModeEnabled()).toBe(false)
    expect(document.documentElement.classList.contains(PERFORMANCE_MODE_CLASS)).toBe(false)
  })
})
