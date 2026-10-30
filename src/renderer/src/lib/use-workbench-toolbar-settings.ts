import { useCallback, useEffect, useRef, useState } from 'react'
import {
  defaultWorkbenchToolbarSettings,
  normalizeWorkbenchToolbarSettings,
  type WorkbenchToolbarSettingsV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
  SETTINGS_CHANGED_EVENT,
  emitRendererSettingsChanged
} from './keyboard-shortcut-settings'

type SaveState = 'idle' | 'saving' | 'error'

export function useWorkbenchToolbarSettings(): {
  preferences: WorkbenchToolbarSettingsV1
  saveState: SaveState
  saveError: string
  savePreferences: (next: WorkbenchToolbarSettingsV1) => Promise<boolean>
} {
  const [preferences, setPreferences] = useState(defaultWorkbenchToolbarSettings)
  const preferencesRef = useRef(preferences)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')

  const apply = useCallback((next: WorkbenchToolbarSettingsV1): void => {
    const normalized = normalizeWorkbenchToolbarSettings(next)
    preferencesRef.current = normalized
    setPreferences(normalized)
  }, [])

  useEffect(() => {
    let cancelled = false
    void rendererRuntimeClient.getSettings()
      .then((settings) => {
        if (!cancelled) apply(normalizeWorkbenchToolbarSettings(settings.workbenchToolbar))
      })
      .catch(() => undefined)

    const onSettingsChanged = (event: Event): void => {
      const settings = (event as CustomEvent<{
        workbenchToolbar?: WorkbenchToolbarSettingsV1
      }>).detail
      apply(normalizeWorkbenchToolbarSettings(settings.workbenchToolbar))
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [apply])

  const savePreferences = useCallback(async (
    next: WorkbenchToolbarSettingsV1
  ): Promise<boolean> => {
    const previous = preferencesRef.current
    const normalized = normalizeWorkbenchToolbarSettings(next)
    apply(normalized)
    setSaveState('saving')
    setSaveError('')
    try {
      const saved = await rendererRuntimeClient.setSettings({
        workbenchToolbar: normalized
      })
      apply(normalizeWorkbenchToolbarSettings(saved.workbenchToolbar))
      emitRendererSettingsChanged(saved)
      setSaveState('idle')
      return true
    } catch (error) {
      apply(previous)
      setSaveState('error')
      setSaveError(error instanceof Error ? error.message : String(error))
      return false
    }
  }, [apply])

  return {
    preferences,
    saveState,
    saveError,
    savePreferences
  }
}
