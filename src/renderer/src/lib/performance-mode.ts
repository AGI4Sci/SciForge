import { useEffect } from 'react'
import { create } from 'zustand'
import type { AppSettingsV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from './keyboard-shortcut-settings'

export const PERFORMANCE_MODE_CLASS = 'sf-performance-mode'

type PerformanceModeState = {
  enabled: boolean
}

export const usePerformanceModeStore = create<PerformanceModeState>(() => ({
  enabled: false
}))

export function isPerformanceModeEnabled(): boolean {
  return usePerformanceModeStore.getState().enabled
}

function syncPerformanceMode(settings: AppSettingsV1): void {
  const enabled = settings.performanceMode === true
  usePerformanceModeStore.setState({ enabled })
  document.documentElement.classList.toggle(PERFORMANCE_MODE_CLASS, enabled)
}

/**
 * Single sync point for performance mode: seeds the store from persisted
 * settings and follows later settings changes. Mount once near the app root.
 */
export function usePerformanceMode(): void {
  useEffect(() => {
    if (typeof window.sciforge?.getSettings === 'function') {
      void rendererRuntimeClient.getSettings().then(syncPerformanceMode).catch(() => undefined)
    }

    const onSettingsChanged = (event: Event): void => {
      syncPerformanceMode((event as CustomEvent<AppSettingsV1>).detail)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [])
}
