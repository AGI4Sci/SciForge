/**
 * Plugin-owned filesystem seam for workspace-local comments and screenshot
 * assets. The default Node binding uses the plugin's atomic, symlink-refusing
 * store; the caller-bound data root determines where plugin data is persisted.
 */
import { rm } from 'node:fs/promises'
import {
  atomicWriteSafeStore,
  readSafeStoreBytes,
  readSafeStoreText,
  safeStorePath
} from '../core/main/safe-store.js'

export type AnchoredCommentFilePort = Readonly<{
  readText(segments: readonly string[], maxBytes?: number): Promise<string>
  readBytes(segments: readonly string[], maxBytes?: number): Promise<Uint8Array>
  writeAtomic(segments: readonly string[], content: string | Uint8Array): Promise<void>
  remove(segments: readonly string[]): Promise<void>
}>

/** Workspace-local binding: every call is rooted at `rootDir`. */
export function createNodeFilePort(rootDir: string): AnchoredCommentFilePort {
  return Object.freeze({
    readText: (segments, maxBytes) => readSafeStoreText(rootDir, segments, maxBytes),
    readBytes: (segments, maxBytes) => readSafeStoreBytes(rootDir, segments, maxBytes),
    writeAtomic: (segments, content) => atomicWriteSafeStore(rootDir, segments, content),
    async remove(segments) {
      const target = await safeStorePath(rootDir, segments, { createParent: false })
      await rm(target, { force: true })
    }
  })
}