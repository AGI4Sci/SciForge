import { createHash } from 'node:crypto'
import { lstat, open, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import yaml from 'js-yaml'
import { DshRuntimeError } from './transport.js'
import { validateDshComposedConfig, canonicalizeDshComposedConfig } from './deployment.js'
import type { DshDeployment } from './types.js'

/** Release-reviewed metadata, compiled into the Host. Never load from userData,
 * PATH, runtime output, or a sidecar manifest adjacent to an untrusted executable.
 * files is the COMPLETE self-contained artifact closure, not just a launcher. */
export interface DshDeploymentPin {
  readonly version: '0.2.0-rc.2'
  readonly sourceCommit: string
  readonly files: Readonly<Record<string, string>>
  readonly configDigest: string
  readonly entryIds: readonly string[]
  readonly pluginNames: readonly string[]
}
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const digest = /^[a-f0-9]{64}$/

export function createPinnedDshDeployment(options: {
  artifactDirectory: string
  executable: string
  pin?: DshDeploymentPin
}): { verifyExecutable(): Promise<void>; verifyDeployment(deployment: DshDeployment): Promise<void> } {
  // Detach authority from any caller-owned arrays/maps before asynchronous work.
  const pin = options.pin ? structuredClone(options.pin) : undefined
  const requirePin = (): DshDeploymentPin => {
    if (!pin) throw new DshRuntimeError('runtime_deployment_pin_missing')
    if (pin.version !== '0.2.0-rc.2' || !/^[a-f0-9]{40}$/.test(pin.sourceCommit) || !digest.test(pin.configDigest) || !Object.keys(pin.files).length) throw new DshRuntimeError('runtime_deployment_pin_invalid')
    return pin
  }
  const verifyExecutable = async (): Promise<void> => {
    const approved = requirePin()
    try {
      if (!isAbsolute(options.artifactDirectory) || !isAbsolute(options.executable)) throw new Error()
      const executableKey = relative(options.artifactDirectory, options.executable).split(sep).join('/')
      if (!Object.hasOwn(approved.files, executableKey)) throw new Error()
      const found = new Set<string>()
      const walk = async (directory: string, prefix = ''): Promise<void> => {
        const directoryStat = await lstat(directory)
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error()
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const key = prefix + entry.name
          const path = join(directory, entry.name)
          if (entry.isDirectory()) { await walk(path, key + '/'); continue }
          if (!entry.isFile() || !Object.hasOwn(approved.files, key) || !digest.test(approved.files[key])) throw new Error()
          const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
          try {
            const stat = await file.stat()
            if (!stat.isFile() || stat.nlink !== 1 || sha(await file.readFile()) !== approved.files[key]) throw new Error()
          } finally { await file.close() }
          found.add(key)
        }
      }
      await walk(options.artifactDirectory)
      if (found.size !== Object.keys(approved.files).length) throw new Error()
    } catch { throw new DshRuntimeError('runtime_deployment_artifact_unapproved') }
  }
  return {
    verifyExecutable,
    verifyDeployment: async deployment => {
      const approved = requirePin()
      try {
        if (deployment.version !== approved.version || deployment.executable !== options.executable || deployment.configDigest !== approved.configDigest || sha(canonicalizeDshComposedConfig(deployment.composedConfig)) !== approved.configDigest) throw new Error()
        validateDshComposedConfig(deployment.composedConfig)
        const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (value: string) => ({ __jsExpr: value }) })])
        const entries = yaml.load(deployment.composedConfig, { schema })
        const walk = (value: unknown, ancestors = new Set<object>()): void => {
          if (!value || typeof value !== 'object') return
          if (ancestors.has(value)) throw new Error()
          const path = new Set(ancestors); path.add(value)
          const row = value as Record<string, unknown>
          // Include disabled owners: plugin loading itself is executable code.
          if (typeof row.id === 'string' && !approved.entryIds.includes(row.id)) throw new Error()
          if (typeof row.name === 'string' && !approved.pluginNames.includes(row.name)) throw new Error()
          for (const child of Object.values(value)) walk(child, path)
        }
        walk(entries)
      } catch { throw new DshRuntimeError('runtime_deployment_config_unapproved') }
      // Recheck the closure after boot-free dump and before ACP startup.
      await verifyExecutable()
    }
  }
}
