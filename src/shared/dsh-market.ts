/**
 * Renderer-safe view of the plugin market. The renderer never sees an artifact
 * path, a publisher keyring or a policy file: it sees what a user may act on —
 * what is listed, what it would be granted, what is installed, and why something
 * cannot be installed yet.
 */

export type DshMarketToolEffect =
  | 'read'
  | 'compute'
  | 'workspace-write'
  | 'external-write'
  | 'destructive'

export type DshMarketTool = Readonly<{
  name: string
  id: string
  effect: DshMarketToolEffect
}>

export type DshMarketCapability = Readonly<{
  name: string
  id: string
  effect: DshMarketToolEffect
  /** True when the Host currently exposes this capability (installed and enabled). */
  registered: boolean
}>

export type DshMarketPlugin = Readonly<{
  name: string
  title: string
  version: string
  categories: readonly string[]
  tools: readonly DshMarketTool[]
  /** How to actually use it: the capabilities, and whether they are live right now. */
  capabilities: readonly DshMarketCapability[]
  hostDependencies: readonly string[]
  publisher: string | null
  sizeBytes: number
  sha256: string
  /** Why it cannot be called for real yet, when that is known. */
  runtimeNote: string | null
  installed: boolean
  enabled: boolean
  installedVersion: string | null
}>

export type DshMarketBlockedPlugin = Readonly<{
  name: string
  plugin: string
  version: string
  reason: string
  detail: string | null
  runtimeGap: string | null
}>

export type DshMarketView = Readonly<{
  source: Readonly<{ kind: 'file' | 'url'; location: string }> | null
  generatedAt: string | null
  dshRuntimeVersion: string | null
  plugins: readonly DshMarketPlugin[]
  notInstallable: readonly DshMarketBlockedPlugin[]
  /** Set when the catalog could not be read; the market then shows nothing usable. */
  error: string | null
}>

export type DshMarketInstallPhase =
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'activating'
  | 'done'
  | 'failed'

export type DshMarketProgress = Readonly<{
  packageName: string
  phase: DshMarketInstallPhase
  bytesReceived: number | null
  bytesTotal: number | null
  message: string | null
}>

export type DshMarketInstallResult = Readonly<{
  packageName: string
  version: string
  sha256: string
  tools: readonly string[]
}>

export type DshMarketInstallInput = Readonly<{
  packageName: string
  /** Exactly the tools the user approved; the host refuses anything else. */
  approvedToolNames: readonly string[]
}>

export type DshMarketPackageInput = Readonly<{ packageName: string }>

export type DshMarketSetEnabledInput = Readonly<{ packageName: string; enabled: boolean }>

export type DshMarketApi = Readonly<{
  list: () => Promise<DshMarketView>
  install: (input: DshMarketInstallInput) => Promise<DshMarketInstallResult>
  uninstall: (input: DshMarketPackageInput) => Promise<void>
  setEnabled: (input: DshMarketSetEnabledInput) => Promise<DshMarketPlugin>
  /** Latest phase of the running install, or null when nothing is running. */
  progress: (input?: DshMarketPackageInput) => Promise<DshMarketProgress | null>
}>