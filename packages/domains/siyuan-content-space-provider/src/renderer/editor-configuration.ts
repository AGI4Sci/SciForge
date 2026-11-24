export type SiYuanEditorConfiguration = Readonly<{ url: string }>
type ConfigurationSnapshot = SiYuanEditorConfiguration & Readonly<{ revision: number }>

export function validateSiYuanConfiguration(configuration: SiYuanEditorConfiguration): void {
  if (!configuration.url.trim()) return
  normalizeSiYuanServiceUrl(configuration.url)
}

/** One package-owned address store shared by settings and mounted editors. */
export function createSiYuanEditorConfigurationStore() {
  let snapshot: ConfigurationSnapshot | undefined
  const listeners = new Set<() => void>()
  const getSnapshot = (): ConfigurationSnapshot => {
    if (!snapshot) {
      snapshot = { url: '', revision: 0 }
    }
    return snapshot
  }
  const notify = (): void => { for (const listener of listeners) listener() }
  return {
    getSnapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    save(configuration: SiYuanEditorConfiguration): void {
      validateSiYuanConfiguration(configuration)
      const url = configuration.url.trim()
      snapshot = { url, revision: getSnapshot().revision + 1 }
      notify()
    },
    reload(): void {
      snapshot = { ...getSnapshot(), revision: getSnapshot().revision + 1 }
      notify()
    }
  }
}

export type SiYuanEditorConfigurationStore = ReturnType<typeof createSiYuanEditorConfigurationStore>
import { normalizeSiYuanServiceUrl } from '../service-url.js'
