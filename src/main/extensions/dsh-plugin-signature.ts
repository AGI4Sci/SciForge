/**
 * Publisher trust for `.sciforge-dsh-plugin` artifacts.
 *
 * Two shapes, one direction of trust: a DSH plugin artifact may *carry* a
 * publisher signature, but it can never *carry* the key that makes that
 * signature trusted. The keyring is host configuration, read from the host's own
 * profile (or an explicit override), exactly like the sandboxed-runtime keyring.
 *
 * This is deliberately a separate keyring from the sandboxed-runtime one: the two
 * plugin shapes have different contracts and must not share a trust root, or a
 * key trusted for one shape would silently authorize the other.
 */
import { readFile } from 'node:fs/promises'
import { createPublicKey, verify as verifyEd25519, type KeyObject } from 'node:crypto'
import { resolve } from 'node:path'
import { z } from 'zod'
import { canonicalJson, type CanonicalJsonValue } from './canonical-json'
import { ExtensionStoreError, extensionErrorMessage } from './errors'

/** Explicit override, matching the `SCIFORGE_OFFICIAL_EXTENSION_KEYS_FILE` idiom. */
export const DSH_PUBLISHER_KEYRING_ENV = 'SCIFORGE_DSH_PUBLISHER_KEYS_FILE'
/** Profile-relative default, used when no override is configured. */
export const DSH_PUBLISHER_KEYRING_FILE = 'extensions/dsh-publisher-keys.json'

const identifier = /^[a-z0-9][a-z0-9._-]*$/

const dshPublisherKeyringSchema = z.object({
  version: z.literal(1),
  keys: z.array(z.object({
    keyId: z.string().trim().min(1).max(128).regex(identifier),
    publisherId: z.string().trim().min(1).max(128).regex(identifier),
    /** Ed25519 public key: SPKI PEM or base64 DER. */
    publicKey: z.string().trim().min(1).max(4_096)
  })).min(1).max(64)
}).strict()

const dshPluginSignatureSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('ed25519'),
  keyId: z.string().trim().min(1).max(128).regex(identifier),
  publisherId: z.string().trim().min(1).max(128).regex(identifier),
  /** Base64 Ed25519 signature over the artifact's canonical manifest bytes. */
  signature: z.string().trim().min(1).max(1_024)
}).strict()

export type DshPublisherKey = Readonly<{ keyId: string; publisherId: string; publicKey: KeyObject }>
export type DshPublisherKeyring = Readonly<{ keys: ReadonlyMap<string, DshPublisherKey> }>
export type DshPluginSignature = z.infer<typeof dshPluginSignatureSchema>
export type DshPublisherTrust = Readonly<{ keyId: string; publisherId: string }>

export function resolveDshPublisherKeyringPath(
  userDataPath: string,
  env: Readonly<Record<string, string | undefined>>
): string {
  const override = env[DSH_PUBLISHER_KEYRING_ENV]?.trim()
  return override ? resolve(override) : resolve(userDataPath, DSH_PUBLISHER_KEYRING_FILE)
}

/**
 * Loads the host's DSH publisher keyring. A missing file is not an error: it
 * means the host trusts no publisher, and artifact verification then fails
 * closed with `unknown_signing_key`.
 */
export async function loadDshPublisherKeyring(sourcePath: string): Promise<DshPublisherKeyring> {
  let raw: string
  try {
    raw = await readFile(sourcePath, 'utf8')
  } catch {
    return { keys: new Map() }
  }
  let parsed: z.infer<typeof dshPublisherKeyringSchema>
  try {
    parsed = dshPublisherKeyringSchema.parse(JSON.parse(raw))
  } catch (error) {
    throw new ExtensionStoreError(
      'unknown_signing_key',
      `The DSH publisher keyring at ${sourcePath} is invalid: ${extensionErrorMessage(error)}`
    )
  }
  const keys = new Map<string, DshPublisherKey>()
  for (const key of parsed.keys) {
    if (keys.has(key.keyId)) {
      throw new ExtensionStoreError(
        'unknown_signing_key',
        `The DSH publisher keyring at ${sourcePath} contains duplicate key ${key.keyId}.`
      )
    }
    keys.set(key.keyId, {
      keyId: key.keyId,
      publisherId: key.publisherId,
      publicKey: parseEd25519PublicKey(key.publicKey, key.keyId, sourcePath)
    })
  }
  return { keys }
}

function parseEd25519PublicKey(value: string, keyId: string, sourcePath: string): KeyObject {
  let key: KeyObject
  try {
    key = createPublicKey(/-----BEGIN/.test(value)
      ? value
      : { key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' })
  } catch (error) {
    throw new ExtensionStoreError(
      'unknown_signing_key',
      `DSH publisher key ${keyId} in ${sourcePath} is not a valid Ed25519 public key: ${extensionErrorMessage(error)}`
    )
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    throw new ExtensionStoreError(
      'unknown_signing_key',
      `DSH publisher key ${keyId} in ${sourcePath} must be an Ed25519 public key.`
    )
  }
  return key
}

/** Parses the artifact's signature file, requiring canonical JSON like the manifest. */
export function parseDshPluginSignature(signatureBytes: Buffer): DshPluginSignature {
  const text = signatureBytes.toString('utf8')
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(text)
  } catch (error) {
    throw new ExtensionStoreError('invalid_signature', `DSH plugin signature is not valid JSON: ${extensionErrorMessage(error)}`)
  }
  if (canonicalJson(parsedJson as CanonicalJsonValue) !== text) {
    throw new ExtensionStoreError('invalid_signature', 'DSH plugin signature must use canonical JSON encoding.')
  }
  const parsed = dshPluginSignatureSchema.safeParse(parsedJson)
  if (!parsed.success) {
    throw new ExtensionStoreError(
      'invalid_signature',
      `DSH plugin signature is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`
    )
  }
  return parsed.data
}

/**
 * Verifies a publisher signature over the artifact's manifest bytes.
 *
 * Trust decisions, in order: the key must exist in the host keyring, the
 * signature's own `publisherId` must equal the keyring's binding for that key
 * (so a signature cannot relabel itself), and the Ed25519 signature must verify.
 * Any other outcome throws an `ExtensionStoreError` — never a boolean false, so
 * no caller can accidentally treat a failure as "unverified but fine".
 */
export function verifyDshPluginSignature(input: Readonly<{
  manifestBytes: Buffer
  signatureBytes: Buffer | undefined
  keyring: DshPublisherKeyring
}>): DshPublisherTrust {
  if (!input.signatureBytes) {
    throw new ExtensionStoreError('invalid_signature', 'DSH plugin artifact is not signed by a publisher.')
  }
  const signature = parseDshPluginSignature(input.signatureBytes)
  const key = input.keyring.keys.get(signature.keyId)
  if (!key) {
    throw new ExtensionStoreError(
      'unknown_signing_key',
      `DSH plugin signature uses unknown publisher key ${signature.keyId}.`
    )
  }
  if (key.publisherId !== signature.publisherId) {
    throw new ExtensionStoreError(
      'publisher_mismatch',
      `DSH plugin signature claims publisher ${signature.publisherId} but key ${signature.keyId} belongs to ${key.publisherId}.`
    )
  }
  let verified: boolean
  try {
    verified = verifyEd25519(null, input.manifestBytes, key.publicKey, Buffer.from(signature.signature, 'base64'))
  } catch (error) {
    throw new ExtensionStoreError('invalid_signature', `DSH plugin signature could not be verified: ${extensionErrorMessage(error)}`)
  }
  if (!verified) {
    throw new ExtensionStoreError(
      'invalid_signature',
      `DSH plugin signature for publisher ${signature.publisherId} does not match the artifact bytes.`
    )
  }
  return Object.freeze({ keyId: key.keyId, publisherId: key.publisherId })
}