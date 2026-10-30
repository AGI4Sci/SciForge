import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { restrictWindowsStorage } from '@sciforge/domain-sdk/node/windows-private-storage'
import { isCanonicalPluginPackageName } from './plugin-package-identity.mjs'

async function rejectSymlink(path) {
  const stat = await lstat(path, { bigint: true }).catch((error) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (stat?.isSymbolicLink()) throw new Error('DSH storage root contains a symlink.')
  return stat
}

function validateEntry(stat) {
  if (typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid())) throw new Error('DSH storage tree is not owned by the current user.')
  if (!stat.isDirectory() && !stat.isFile()) throw new Error('DSH storage tree contains a non-regular entry.')
  if (stat.isFile() && stat.nlink !== 1n) throw new Error('DSH storage tree contains a hardlink.')
}

function sameInode(actual, expected) {
  return actual && expected && actual.dev === expected.dev && actual.ino === expected.ino
}

async function inspectTree(path, entries = new Map()) {
  const stat = await rejectSymlink(path)
  if (!stat) return entries
  validateEntry(stat)
  entries.set(path, stat)
  if (stat.isDirectory()) for (const name of await readdir(path)) await inspectTree(join(path, name), entries)
  return entries
}

async function assertUnchanged(path, handle, expected) {
  const opened = await handle.stat({ bigint: true })
  const named = await rejectSymlink(path)
  if (!sameInode(opened, expected) || !sameInode(named, opened) || await realpath(path) !== path) {
    throw new Error('DSH storage tree changed during preparation.')
  }
  validateEntry(opened)
  validateEntry(named)
  return opened
}

async function restrictWindowsTree(entries) {
  const handles = []
  try {
    for (const [path, expected] of entries) {
      const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | (expected.isDirectory() ? constants.O_DIRECTORY : 0))
      handles.push({ path, expected, handle })
      await assertUnchanged(path, handle, expected)
    }
    for (const entry of handles) await assertUnchanged(entry.path, entry.handle, entry.expected)

    await restrictWindowsStorage(handles.map(({ path, expected }) => ({
      path, dev: expected.dev, ino: expected.ino, directory: expected.isDirectory()
    })))

    for (const entry of handles) await assertUnchanged(entry.path, entry.handle, entry.expected)
  } finally {
    await Promise.all(handles.map(({ handle }) => handle.close()))
  }
}

async function restrictTree(entries) {
  if (process.platform === 'win32') {
    await restrictWindowsTree(entries)
    const finalEntries = await inspectTree(entries.keys().next().value)
    if (finalEntries.size !== entries.size || [...entries].some(([path, stat]) => !sameInode(finalEntries.get(path), stat))) {
      throw new Error('DSH storage tree changed during preparation.')
    }
    return
  }
  for (const [path, expected] of entries) {
    // O_NOFOLLOW protects the leaf; fstat binds the operation to the inspected
    // inode, while realpath/path identity checks reject ancestor redirection.
    // macOS supports these flags and fchmod, but has no /proc/self/fd traversal.
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (expected.isDirectory() ? constants.O_DIRECTORY : 0))
    try {
      const stat = await assertUnchanged(path, handle, expected)
      if (stat.isDirectory()) {
        // Directory hardlinks are not user-creatable on macOS/POSIX.
        await handle.chmod(0o700)
        await assertUnchanged(path, handle, expected)
      } else if (Number(stat.mode & 0o7777n) !== 0o600) {
        // Never chmod an existing regular inode: even fstat(nlink=1) followed
        // by fchmod races a newly added external hardlink. Publish a fresh
        // inode born private instead; rename does not chmod its replaced inode.
        const bytes = await handle.readFile()
        const afterRead = await assertUnchanged(path, handle, expected)
        if (afterRead.size !== stat.size || afterRead.mtimeMs !== stat.mtimeMs || afterRead.ctimeMs !== stat.ctimeMs) {
          throw new Error('DSH storage tree changed during preparation.')
        }
        const temporary = join(dirname(path), `.dsh-private-${randomUUID()}`)
        const replacement = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
        try {
          // The parent path can be redirected while open() resolves the
          // temporary name. Revalidate the original file before writing any
          // sensitive bytes; a post-write check is too late.
          await assertUnchanged(path, handle, expected)
          await replacement.writeFile(bytes)
          await replacement.sync()
          const privateStat = await replacement.stat({ bigint: true })
          await assertUnchanged(path, handle, expected)
          await assertUnchanged(temporary, replacement, privateStat)
          await rename(temporary, path)
          await assertUnchanged(path, replacement, privateStat)
          entries.set(path, privateStat)
        } finally {
          await replacement.close()
          await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
        }
      }
    } finally { await handle.close() }
  }
  const finalEntries = await inspectTree(entries.keys().next().value)
  if (finalEntries.size !== entries.size || [...entries].some(([path, stat]) => !sameInode(finalEntries.get(path), stat))) {
    throw new Error('DSH storage tree changed during preparation.')
  }
}

/** Host identity only. No cwd fallback, plugin-config path, or URI decoding. */
export async function resolveDshStorageRoot(grant, packageName) {
  if (grant.packageName !== packageName || !isCanonicalPluginPackageName(packageName)) {
    throw new Error('Invalid DSH storage package identity.')
  }
  if (typeof grant.profileRoot !== 'string' || !isAbsolute(grant.profileRoot) || grant.profileRoot !== resolve(grant.profileRoot)) {
    throw new Error('DSH storage profile root must be a canonical absolute path.')
  }
  const root = join(grant.profileRoot, 'extensions', 'dsh-storage', encodeURIComponent(packageName))
  return prepareDshStorageRoot(root)
}

/** Shared host-owned filesystem boundary for plugin-private and product Session storage. */
export async function prepareDshStorageRoot(root) {
  if (typeof root !== 'string' || !isAbsolute(root) || root !== resolve(root)) {
    throw new Error('DSH storage root must be a canonical absolute path.')
  }
  for (let cursor = root; ; cursor = dirname(cursor)) {
    const stat = await lstat(cursor).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (stat?.isSymbolicLink()) {
      // Only the root-owned macOS system alias may precede the owned tree.
      // Never canonicalize arbitrary profile/owned symlinks into an escape.
      if (process.platform !== 'darwin' || cursor !== '/var' || !root.startsWith('/var/') || stat.uid !== 0 || await realpath(cursor) !== '/private/var') {
        throw new Error('DSH storage root contains a symlink.')
      }
      root = join('/private/var', root.slice('/var/'.length))
      return prepareDshStorageRoot(root)
    }
    if (stat && !stat.isDirectory()) throw new Error('DSH storage root ancestor is not a directory.')
    if (cursor === dirname(cursor)) break
  }
  let entries = await inspectTree(root)
  await mkdir(root, { recursive: true, mode: 0o700 })
  if (entries.size === 0) entries = await inspectTree(root)
  // Only the granted storage tree is owned here; never chmod profile/ancestors.
  await restrictTree(entries)
  return root
}
