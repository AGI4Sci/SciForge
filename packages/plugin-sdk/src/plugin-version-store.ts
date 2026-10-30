import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm, writeFile, access } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { parsePluginManifest, type PluginManifest } from './manifest.js'
import { isCanonicalPluginPackageName } from './plugin-package-identity.mjs'

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

export type StagedPluginVersion = Readonly<{
  packageName: string
  version: string
  directory: string
  manifest: PluginManifest
  integrity: string
}>

export type ActivePluginPointer = Readonly<{
  packageName: string
  version: string
  integrity: string
  directory: string
}>

function keyFor(packageName: string): string {
  if (!isCanonicalPluginPackageName(packageName)) {
    throw new Error(`Invalid plugin package name: ${packageName}`)
  }
  return encodeURIComponent(packageName)
}

export async function pluginDirectoryIntegrity(directory: string): Promise<string> {
  const files: string[] = []
  async function collect(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        throw new Error(`Refusing to stage plugin containing a symbolic link: ${join(current, entry.name)}`)
      }
      const path = join(current, entry.name)
      if (entry.isDirectory()) await collect(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  await collect(directory)
  files.sort()
  const hash = createHash('sha256')
  for (const path of files) {
    hash.update(relative(directory, path).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(await readFile(path))
    hash.update('\0')
  }
  return `sha256-${hash.digest('hex')}`
}

/** Thrown when a plugin version already staged is re-staged with different content. */
export class ImmutablePluginVersionError extends Error {
  readonly code = 'immutable_version'
  constructor(packageName: string, version: string) {
    super(`Immutable plugin version conflict: ${packageName}@${version} is already staged with different content.`)
    this.name = 'ImmutablePluginVersionError'
  }
}

/** Filesystem facts for local, already-built plugin versions. It never builds or executes code. */
export class PluginVersionStore {
  readonly #root: string

  constructor(root: string) {
    this.#root = resolve(root)
  }

  async stage(sourceDirectory: string): Promise<StagedPluginVersion> {
    const source = resolve(sourceDirectory)
    const manifest = parsePluginManifest(JSON.parse(await readFile(join(source, 'package.json'), 'utf8')))
    const packageKey = keyFor(manifest.name)
    const destination = join(this.#root, 'packages', packageKey, manifest.version)
    // Reject symlinks / compute the incoming content digest BEFORE touching the store.
    const incomingIntegrity = await pluginDirectoryIntegrity(source)
    if (await exists(destination)) {
      // Idempotent reuse ONLY for identical content; otherwise reject (immutable version).
      const existingIntegrity = await pluginDirectoryIntegrity(destination)
      if (existingIntegrity !== incomingIntegrity) {
        throw new ImmutablePluginVersionError(manifest.name, manifest.version)
      }
      return Object.freeze({
        packageName: manifest.name,
        version: manifest.version,
        directory: destination,
        manifest,
        integrity: incomingIntegrity
      })
    }
    const staging = join(this.#root, 'staging', `${packageKey}-${manifest.version}`)
    await mkdir(join(this.#root, 'staging'), { recursive: true })
    await mkdir(join(this.#root, 'packages', packageKey), { recursive: true })
    await rm(staging, { recursive: true, force: true })
    try {
      await cp(source, staging, { recursive: true, errorOnExist: true })
      const integrity = await pluginDirectoryIntegrity(staging)
      await rename(staging, destination)
      return Object.freeze({
        packageName: manifest.name,
        version: manifest.version,
        directory: destination,
        manifest,
        integrity
      })
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async verify(staged: StagedPluginVersion): Promise<boolean> {
    const manifest = parsePluginManifest(JSON.parse(await readFile(join(staged.directory, 'package.json'), 'utf8')))
    return manifest.name === staged.packageName &&
      manifest.version === staged.version &&
      await pluginDirectoryIntegrity(staged.directory) === staged.integrity
  }

  async activate(staged: StagedPluginVersion): Promise<ActivePluginPointer> {
    if (!await this.verify(staged)) throw new Error(`Plugin integrity verification failed: ${staged.packageName}@${staged.version}`)
    const packageKey = keyFor(staged.packageName)
    const activeDirectory = join(this.#root, 'active')
    await mkdir(activeDirectory, { recursive: true })
    const pointer: ActivePluginPointer = {
      packageName: staged.packageName,
      version: staged.version,
      integrity: staged.integrity,
      directory: staged.directory
    }
    const temporary = join(activeDirectory, `.${packageKey}.tmp`)
    await writeFile(temporary, `${JSON.stringify(pointer, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, join(activeDirectory, `${packageKey}.json`))
    return Object.freeze(pointer)
  }

  /** Write a previous active pointer back (rollback). Validates ownership + integrity first. */
  async restore(packageName: string, pointer: ActivePluginPointer): Promise<ActivePluginPointer> {
    if (pointer.packageName !== packageName) throw new Error('Rollback pointer package mismatch.')
    const expected = join(this.#root, 'packages', keyFor(packageName), pointer.version)
    if (resolve(pointer.directory) !== resolve(expected) || basename(pointer.directory) !== pointer.version) {
      throw new Error(`Rollback pointer directory does not belong to ${packageName}@${pointer.version}.`)
    }
    const integrity = await pluginDirectoryIntegrity(pointer.directory)
    if (integrity !== pointer.integrity) {
      throw new Error(`Rollback pointer integrity mismatch for ${packageName}@${pointer.version}.`)
    }
    const activeDirectory = join(this.#root, 'active')
    await mkdir(activeDirectory, { recursive: true })
    const temporary = join(activeDirectory, `.${keyFor(packageName)}.tmp`)
    await writeFile(temporary, `${JSON.stringify(pointer, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, join(activeDirectory, `${keyFor(packageName)}.json`))
    return Object.freeze(pointer)
  }

  async clearActive(packageName: string): Promise<void> {
    await rm(join(this.#root, 'active', `${keyFor(packageName)}.json`), { force: true })
  }

  async active(packageName: string): Promise<ActivePluginPointer | undefined> {
    try {
      const pointer = JSON.parse(await readFile(join(this.#root, 'active', `${keyFor(packageName)}.json`), 'utf8')) as ActivePluginPointer
      // package ownership
      if (pointer.packageName !== packageName) throw new Error('Active pointer package mismatch.')
      if (!pointer.version || !pointer.directory || !pointer.integrity) throw new Error('Active pointer is missing fields.')
      // directory ownership: exactly `<root>/packages/<key>/<version>`
      const expected = join(this.#root, 'packages', keyFor(packageName), pointer.version)
      if (resolve(pointer.directory) !== resolve(expected) || basename(pointer.directory) !== pointer.version) {
        throw new Error(`Active pointer directory does not belong to ${packageName}@${pointer.version}.`)
      }
      // integrity revalidation on read
      const integrity = await pluginDirectoryIntegrity(pointer.directory)
      if (integrity !== pointer.integrity) {
        throw new Error(`Active pointer integrity mismatch for ${packageName}@${pointer.version}.`)
      }
      return Object.freeze(pointer)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async versions(packageName: string): Promise<readonly string[]> {
    try {
      return Object.freeze((await readdir(join(this.#root, 'packages', keyFor(packageName)), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.freeze([])
      throw error
    }
  }

  /** Absolute staged directory for an already-staged version, if present. */
  async stagedPath(packageName: string, version: string): Promise<string | undefined> {
    const directory = join(this.#root, 'packages', keyFor(packageName), version)
    return (await exists(directory)) ? directory : undefined
  }

  async removeVersion(packageName: string, version: string): Promise<void> {
    const active = await this.active(packageName)
    if (active?.version === version) throw new Error('Cannot remove the active plugin version.')
    await rm(join(this.#root, 'packages', keyFor(packageName), version), { recursive: true, force: true })
  }
}
