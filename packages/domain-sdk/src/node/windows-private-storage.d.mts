export type WindowsStorageEntry = Readonly<{
  path: string
  dev: bigint | number
  ino: bigint | number
  directory: boolean
}>
export function restrictWindowsStorageSync(entries: readonly WindowsStorageEntry[]): void
export function restrictWindowsStorage(entries: readonly WindowsStorageEntry[]): Promise<void>
