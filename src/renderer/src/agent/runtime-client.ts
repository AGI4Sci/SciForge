import type { AppSettingsPatch, AppSettingsV1 } from '@shared/app-settings'
import { emitRendererSettingsChanged } from '../lib/keyboard-shortcut-settings'

class RendererRuntimeClient {
  private cachedSettings: AppSettingsV1 | null = null
  private settingsPromise: Promise<AppSettingsV1> | null = null
  private unsubscribeSettingsChanged: (() => void) | null = null

  async getSettings(options?: { forceRefresh?: boolean }): Promise<AppSettingsV1> {
    this.startSettingsChangeListener()
    if (options?.forceRefresh) {
      this.invalidateSettings()
      this.startSettingsChangeListener()
    }
    if (this.cachedSettings) return this.cachedSettings
    if (this.settingsPromise) return this.settingsPromise
    const task = window.sciforge.getSettings().then((settings) => {
      this.cachedSettings = settings
      return settings
    })
    this.settingsPromise = task.finally(() => {
      if (this.settingsPromise === task) this.settingsPromise = null
    })
    return task
  }

  async setSettings(partial: AppSettingsPatch): Promise<AppSettingsV1> {
    this.startSettingsChangeListener()
    const settings = await window.sciforge.setSettings(partial)
    this.cachedSettings = settings
    this.settingsPromise = null
    return settings
  }

  invalidateSettings(): void {
    this.cachedSettings = null
    this.settingsPromise = null
    this.unsubscribeSettingsChanged?.()
    this.unsubscribeSettingsChanged = null
  }

  startSettingsChangeListener(): void {
    if (this.unsubscribeSettingsChanged) return
    const bridge = window.sciforge as Window['sciforge'] & {
      onSettingsChanged?: (handler: (settings: AppSettingsV1) => void) => () => void
    }
    if (typeof bridge?.onSettingsChanged !== 'function') return
    this.unsubscribeSettingsChanged = bridge.onSettingsChanged((settings) => {
      this.cachedSettings = settings
      this.settingsPromise = null
      emitRendererSettingsChanged(settings)
    })
  }
}

export const rendererRuntimeClient = new RendererRuntimeClient()
