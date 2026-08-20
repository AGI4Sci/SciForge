export type InternalRuntimeIntegrityFile = Readonly<{
  path: string
  sha256: string
  size: number
}>

export type InternalRuntimeIntegrityManifest = Readonly<{
  files: readonly InternalRuntimeIntegrityFile[]
  overlayId: string
  overlayRoot: string
  version: string
}>

export type VerifiedInternalOverlay = Readonly<{
  archiveRoot: string
  archiveSha256: string
  fileCount: number
  files: readonly string[]
  inventory: readonly InternalRuntimeIntegrityFile[]
  inventorySha256: string
  overlayId: string
  overlayRoot: string
  receiptPath: string
  version: string
}>

export function canonicalJson(value: unknown): string

export function createStaticFileInventory(options: Readonly<{
  label: string
  rootPath: string
  rootPrefix?: string
}>): readonly InternalRuntimeIntegrityFile[]

export function digestInventory(manifest: InternalRuntimeIntegrityManifest): string

export function verifyInstalledInternalOverlaySync(options: Readonly<{
  overlayId: string
  overlayRoot: string
  targetRoot: string
}>): VerifiedInternalOverlay

export function verifyStaticFileInventory(options: Readonly<{
  inventory: readonly InternalRuntimeIntegrityFile[]
  label: string
  rootPath: string
  rootPrefix?: string
}>): Readonly<{ fileCount: number }>
