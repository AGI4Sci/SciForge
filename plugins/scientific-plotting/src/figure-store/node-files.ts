import { constants } from 'node:fs'
import { open, lstat, mkdir, link, readdir, realpath, rename, unlink, rmdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { FigureFileSystem } from './index.js'

/** Runs ONLY inside the native adapter's DSH-confined subprocess. Never instantiate in Host. */
export class ConfinedFigureFiles implements FigureFileSystem {
  private async target(root: string, path: string, parents = false): Promise<string> {
    if (isAbsolute(path) || path.split('/').some(s => !s || s === '.' || s === '..') || path.includes('\\')) throw new Error('Unsafe relative path')
    const canonicalRoot = await realpath(root)
    const target = resolve(canonicalRoot, path)
    const rel = relative(canonicalRoot, target)
    if (rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Path escapes workspace')
    let current = canonicalRoot
    const parts = rel.split(sep)
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]!)
      let info
      try { info = await lstat(current) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        if (parents && i < parts.length - 1) { await mkdir(current).catch(async e => { if (e.code !== 'EEXIST') throw e }); info = await lstat(current) }
        else continue
      }
      if (info?.isSymbolicLink()) throw new Error(`Symlink is forbidden: ${path}`)
      if (i < parts.length - 1 && info && !info.isDirectory()) throw new Error('Non-directory path component')
    }
    return target
  }
  async read(root: string, path: string): Promise<Uint8Array | null> {
    const target = await this.target(root, path)
    let handle
    try { handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    try { const info = await handle.stat(); if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('File is not regular or exceeds 64 MiB'); return await handle.readFile() } finally { await handle.close() }
  }
  async listDirectories(root: string, path: string): Promise<string[]> {
    const target = await this.target(root, path)
    try {
      const entries = await readdir(target, { withFileTypes: true })
      if (entries.some(e => e.isSymbolicLink())) throw new Error('Symlink in document directory')
      return entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name)
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }
  async writeImmutable(root: string, path: string, bytes: Uint8Array): Promise<void> {
    const target = await this.target(root, path, true)
    // Publish only complete bytes; hard-link creation fails if an immutable target exists.
    const temporary = `${target}.${randomUUID()}.tmp`
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      await this.target(root, path)
      await link(temporary, target)
      const directory = await open(dirname(target), constants.O_RDONLY | constants.O_NOFOLLOW)
      try { await directory.sync() } finally { await directory.close() }
    } finally { await unlink(temporary) }
  }
  async writeAtomic(root: string, path: string, bytes: Uint8Array): Promise<void> {
    const target = await this.target(root, path, true)
    const temporary = `${target}.${randomUUID()}.tmp`
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    try {
      await this.target(root, path)
      await rename(temporary, target)
      const directory = await open(dirname(target), constants.O_RDONLY)
      try { await directory.sync() } finally { await directory.close() }
    } catch (error) { await unlink(temporary).catch(() => undefined); throw error }
  }
  async withLock<T>(root: string, key: string, run: () => Promise<T>): Promise<T> {
    // Exclusive directory creation arbitrates separate workers/plugin generations. A crashed
    // worker leaves a lock and fails closed; never infer that an old lock is safe to steal.
    const path = `.scientific-figures/.${key === '@index' ? 'index' : key}.lock`
    const deadline = performance.now() + 2000
    const busy = () => new Error(`Document is busy (${key}); retry after the active operation completes. A surviving lock requires manual inspection.`)
    let target: string
    for (;;) {
      // Recheck every component on each attempt, including a lock replaced by a symlink.
      target = await this.target(root, path, true)
      try { await mkdir(target, { mode: 0o700 }); break } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const remaining = deadline - performance.now()
        if (remaining <= 0) throw busy()
        await delay(Math.min(25, remaining))
        if (performance.now() >= deadline) throw busy()
      }
    }
    try { return await run() } finally { await rmdir(target) }
  }
}
