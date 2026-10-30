import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, type BigIntStats } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { restrictWindowsStorageSync } from '@sciforge/domain-sdk/node/windows-private-storage'
// Darwin's public fcntl O_NOFOLLOW_ANY; Node exposes only O_NOFOLLOW.
const noFollow = process.platform === 'darwin' ? 0x20000000 : constants.O_NOFOLLOW
const restrictedWindowsIdentities = new Set<string>()

/** Evidence-owned files only. Validate on each I/O, use no-follow opens and
 * exclusive atomic replacements, and never chmod a grant's ancestors. Sync
 * critical sections avoid an await between validation and the filesystem op.
 */
export class EvidenceFileStorage {
  private root: string | undefined
  private identity: string | undefined
  constructor(private readonly path: string) {}
  private restrict(path: string, info: BigIntStats, directory = false) {
    const identity = `${info.dev}:${info.ino}`
    if (process.platform === 'win32' && !restrictedWindowsIdentities.has(identity)) {
      restrictWindowsStorageSync([{ path, dev: info.dev, ino: info.ino, directory }])
      restrictedWindowsIdentities.add(identity)
    }
  }
  private unchanged(path: string, fd: number, directory = false) {
    const info = this.owned(fd, directory), named = lstatSync(path, { bigint: true })
    if (named.isSymbolicLink() || named.dev !== info.dev || named.ino !== info.ino) {
      throw new Error('Evidence storage path identity changed.')
    }
    return info
  }
  private owned(fd: number, directory = false) {
    const info = fstatSync(fd, { bigint: true })
    if ((typeof process.getuid === 'function' && info.uid !== BigInt(process.getuid())) || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1n)) {
      throw new Error('Evidence storage rejects unowned, nonregular or hardlinked files.')
    }
    return info
  }
  private target(root: string) {
    const path = join(root, basename(this.path))
    try {
      const info = lstatSync(path)
      if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1 || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Evidence storage rejects symlinks, hardlinks and directory/nonregular file targets.')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return path
  }
  private directory() {
    const supplied = resolve(dirname(this.path))
    const parent = realpathSync(dirname(supplied))
    if (parent !== dirname(supplied)) throw new Error('Evidence storage ancestor cannot be a symlink.')
    if (!this.root) {
      try { mkdirSync(supplied, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    if (lstatSync(supplied).isSymbolicLink()) throw new Error('Evidence storage root cannot be a symlink.')
    const root = realpathSync(supplied)
    const fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | noFollow)
    try {
      const info = this.unchanged(root, fd, true), identity = `${info.dev}:${info.ino}`
      if (this.root && (root !== this.root || identity !== this.identity)) throw new Error('Evidence storage root identity changed.')
      this.root = root; this.identity = identity
      if (process.platform === 'win32') this.restrict(root, info, true)
      else fchmodSync(fd, 0o700)
      this.unchanged(root, fd, true)
      return { root, fd }
    } catch (error) { closeSync(fd); throw error }
  }
  readText(): string {
    const { root, fd: directory } = this.directory()
    try {
      const path = this.target(root)
      const fd = openSync(path, constants.O_RDONLY | noFollow | constants.O_NONBLOCK)
      try {
        const info = this.unchanged(path, fd)
        if (process.platform === 'win32') this.restrict(path, info)
        else fchmodSync(fd, 0o600)
        this.unchanged(root, directory, true)
        this.unchanged(path, fd)
        return readFileSync(fd, 'utf8')
      } finally { closeSync(fd) }
    } finally { closeSync(directory) }
  }
  writeText(content: string): void {
    const { root, fd: directory } = this.directory()
    const temporary = join(root, `.${basename(this.path)}.${randomUUID()}.tmp`)
    try {
      this.target(root)
      const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600)
      try {
        this.owned(fd)
        this.unchanged(root, directory, true)
        this.unchanged(temporary, fd)
        if (process.platform !== 'win32') fchmodSync(fd, 0o600)
        writeFileSync(fd, content); fsyncSync(fd)
        if (process.platform === 'win32') {
          const info = this.owned(fd)
          restrictedWindowsIdentities.add(`${info.dev}:${info.ino}`)
        }
      } finally { closeSync(fd) }
      this.target(root)
      renameSync(temporary, join(root, basename(this.path)))
      if (process.platform !== 'win32') fsyncSync(directory)
    } finally {
      try { unlinkSync(temporary) } catch { /* cleanup must not mask the original write failure */ }
      closeSync(directory)
    }
  }
}
