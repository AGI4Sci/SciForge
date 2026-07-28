import { createPublicKey } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { TrustedOfficialPublisherKey } from './types'

const officialExtensionKeyringSchema = z.object({
  schemaVersion: z.literal(1),
  keys: z.array(z.object({
    keyId: z.string().trim().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
    publisherId: z.string().trim().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
    algorithm: z.literal('ed25519'),
    publicKeyPem: z.string().trim().min(1).max(16_384)
  }).strict()).min(1).max(128)
}).strict()

export type OfficialExtensionKeyringLoadOptions = Readonly<{
  appPath: string
  resourcesPath: string
  isPackaged: boolean
  explicitPath?: string
}>

export type OfficialExtensionKeyringLoadResult = Readonly<{
  keys: readonly TrustedOfficialPublisherKey[]
  sourcePath: string | null
}>

/**
 * Trust anchors are host configuration, never package input. Release builds
 * load their public keyring from resources; development may point at an
 * external keyring with SCIFORGE_OFFICIAL_EXTENSION_KEYS_FILE.
 */
export async function loadOfficialExtensionKeyring(
  options: OfficialExtensionKeyringLoadOptions
): Promise<OfficialExtensionKeyringLoadResult> {
  const sourcePath = resolveOfficialExtensionKeyringPath(options)
  if (!sourcePath) return Object.freeze({ keys: Object.freeze([]), sourcePath: null })
  if (!(await officialExtensionKeyringExists(sourcePath))) {
    if (options.explicitPath?.trim()) {
      throw new Error(`The configured SciForge official extension keyring does not exist: ${sourcePath}.`)
    }
    return Object.freeze({ keys: Object.freeze([]), sourcePath: null })
  }

  let raw: string
  try {
    raw = await readFile(sourcePath, 'utf8')
  } catch (error) {
    throw new Error(`Could not read the SciForge official extension keyring at ${sourcePath}.`, {
      cause: error
    })
  }

  let parsed: z.infer<typeof officialExtensionKeyringSchema>
  try {
    parsed = officialExtensionKeyringSchema.parse(JSON.parse(raw))
  } catch (error) {
    throw new Error(`The SciForge official extension keyring at ${sourcePath} is invalid.`, {
      cause: error
    })
  }

  const keyIds = new Set<string>()
  const keys = parsed.keys.map((key) => {
    if (keyIds.has(key.keyId)) {
      throw new Error(
        `The SciForge official extension keyring at ${sourcePath} contains duplicate key ${key.keyId}.`
      )
    }
    keyIds.add(key.keyId)
    try {
      const publicKey = createPublicKey(key.publicKeyPem)
      if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
        throw new Error('Expected an Ed25519 public key.')
      }
      return Object.freeze({
        keyId: key.keyId,
        publisherId: key.publisherId,
        publicKey
      })
    } catch (error) {
      throw new Error(
        `Official extension key ${key.keyId} in ${sourcePath} is not a valid Ed25519 public key.`,
        { cause: error }
      )
    }
  })

  return Object.freeze({
    sourcePath,
    keys: Object.freeze(keys)
  })
}

export function resolveOfficialExtensionKeyringPath(
  options: OfficialExtensionKeyringLoadOptions
): string | null {
  const explicitPath = options.explicitPath?.trim()
  if (explicitPath) return resolve(explicitPath)
  const defaultPath = resolve(
    options.isPackaged ? options.resourcesPath : resolve(options.appPath, 'resources'),
    'extensions',
    'official-keys.json'
  )
  return defaultPath
}

export async function officialExtensionKeyringExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
