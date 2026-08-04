import {
  createHash,
  createPublicKey,
  KeyObject,
  verify as verifySignature,
} from 'node:crypto'
import {
  domainPackageNameSchema,
  domainPackagePublisherIdSchema,
  domainPackageStableVersionSchema,
  domainPackageVersionSchema
} from '@sciforge/domain-sdk'
import { z } from 'zod'
import { validateArtifactPath, readExtensionArtifact } from './artifact-reader'
import { canonicalJson, type CanonicalJsonValue } from './canonical-json'
import {
  assertCompatibleHostApi,
  domainPublisherId,
  parseInstallableDomainDefinition
} from './domain-manifest-adapter'
import { ExtensionStoreError, extensionErrorMessage } from './errors'
import {
  EXTENSION_DOMAIN_MANIFEST_PATH,
  EXTENSION_INTEGRITY_PATH,
  EXTENSION_SIGNATURE_PATH,
  type ExtensionArtifactLimits,
  type ExtensionArtifactSource,
  type ExtensionIntegrityManifest,
  type ExtensionSignatureDescriptor,
  type TrustedOfficialPublisherKey,
  type TrustedOfficialPublisherKeyring,
  type VerifiedExtensionArtifact
} from './types'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const FORBIDDEN_INSTALL_SCRIPTS = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'prepublishOnly',
  'prepare',
  'postpublish'
])

const integrityManifestSchema = z.object({
  schemaVersion: z.literal(1),
  packageName: domainPackageNameSchema,
  version: domainPackageVersionSchema,
  publisherId: domainPackagePublisherIdSchema,
  files: z.record(z.string(), z.string().regex(SHA256_PATTERN))
}).strict()

const signatureDescriptorSchema = z.object({
  schemaVersion: z.literal(1),
  algorithm: z.literal('ed25519'),
  keyId: z.string().trim().min(1).max(128).regex(SAFE_IDENTIFIER_PATTERN),
  signature: z.string().min(1).max(256).regex(BASE64_PATTERN)
}).strict()

export type ExtensionArtifactVerifierOptions = Readonly<{
  hostApiVersion: string
  trustedKeys: TrustedOfficialPublisherKeyring
  limits?: Partial<ExtensionArtifactLimits>
}>

export class ExtensionArtifactVerifier {
  readonly #hostApiVersion: string
  readonly #trustedKeys: ReadonlyMap<string, TrustedOfficialPublisherKey>
  readonly #limits: Partial<ExtensionArtifactLimits>

  constructor(options: ExtensionArtifactVerifierOptions) {
    this.#hostApiVersion = domainPackageStableVersionSchema.parse(options.hostApiVersion)
    this.#trustedKeys = normalizeKeyring(options.trustedKeys)
    this.#limits = { ...options.limits }
  }

  async verify(source: ExtensionArtifactSource): Promise<VerifiedExtensionArtifact> {
    const files = await readExtensionArtifact(source, this.#limits)
    const integrityBytes = requiredFile(files, EXTENSION_INTEGRITY_PATH, 'integrity manifest')
    const signatureBytes = requiredFile(files, EXTENSION_SIGNATURE_PATH, 'detached signature')

    const integrity = parseCanonicalIntegrityManifest(integrityBytes)
    const signature = parseSignatureDescriptor(signatureBytes)
    validateIntegrityFileSet(files, integrity)
    verifyFileDigests(files, integrity)
    assertNoInstallScripts(files)

    const signingKey = this.#trustedKeys.get(signature.keyId)
    if (!signingKey) {
      throw new ExtensionStoreError(
        'unknown_signing_key',
        `Extension signature uses unknown official signing key ${signature.keyId}.`
      )
    }
    if (signingKey.publisherId !== integrity.publisherId) {
      throw new ExtensionStoreError(
        'publisher_mismatch',
        `Signing key ${signature.keyId} is not trusted for publisher ${integrity.publisherId}.`
      )
    }
    verifyDetachedSignature(signingKey, signature, integrityBytes)

    const domainBytes = requiredFile(files, EXTENSION_DOMAIN_MANIFEST_PATH, 'domain manifest')
    const definition = parseInstallableDomainDefinition(parseJson(
      domainBytes,
      'domain manifest',
      'invalid_domain_manifest'
    ))
    assertCompatibleHostApi(definition, this.#hostApiVersion)
    if (
      definition.packageName !== integrity.packageName ||
      definition.module.version !== integrity.version
    ) {
      throw new ExtensionStoreError(
        'invalid_integrity_manifest',
        'Integrity identity does not match sciforge.domain.json.'
      )
    }
    const manifestPublisherId = domainPublisherId(definition)
    if (manifestPublisherId !== integrity.publisherId) {
      throw new ExtensionStoreError(
        'publisher_mismatch',
        `Domain manifest publisher ${manifestPublisherId} does not match signed publisher ${integrity.publisherId}.`
      )
    }

    return Object.freeze({
      definition,
      integrity,
      integritySha256: sha256(integrityBytes),
      signer: Object.freeze({
        publisherId: integrity.publisherId,
        keyId: signature.keyId,
        trust: 'official' as const,
        algorithm: 'ed25519' as const
      }),
      files
    })
  }
}

function normalizeKeyring(
  input: TrustedOfficialPublisherKeyring
): ReadonlyMap<string, TrustedOfficialPublisherKey> {
  const normalized = new Map<string, TrustedOfficialPublisherKey>()
  let entries: readonly TrustedOfficialPublisherKey[]
  if (Array.isArray(input)) {
    entries = input
  } else if (input instanceof Map) {
    entries = [...input.entries()].map(([keyId, value]) => ({ keyId, ...value }))
  } else {
    entries = Object.entries(input).map(([keyId, value]) => ({ keyId, ...value }))
  }

  for (const entry of entries) {
    if (
      !SAFE_IDENTIFIER_PATTERN.test(entry.keyId) ||
      !SAFE_IDENTIFIER_PATTERN.test(entry.publisherId)
    ) {
      throw new ExtensionStoreError(
        'unknown_signing_key',
        'Trusted official key IDs and publisher IDs must be normalized identifiers.'
      )
    }
    if (normalized.has(entry.keyId)) {
      throw new ExtensionStoreError(
        'unknown_signing_key',
        `Duplicate trusted official signing key ${entry.keyId}.`
      )
    }
    const publicKey = asEd25519PublicKey(entry.publicKey, entry.keyId)
    normalized.set(entry.keyId, Object.freeze({ ...entry, publicKey }))
  }
  return normalized
}

function asEd25519PublicKey(
  input: KeyObject | string | Buffer,
  keyId: string
): KeyObject {
  let key: KeyObject
  try {
    key = input instanceof KeyObject ? input : createPublicKey(input)
  } catch (error) {
    throw new ExtensionStoreError(
      'unknown_signing_key',
      `Trusted signing key ${keyId} is not a valid public key.`,
      { cause: error }
    )
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    throw new ExtensionStoreError(
      'unknown_signing_key',
      `Trusted signing key ${keyId} must be an Ed25519 public key.`
    )
  }
  return key
}

function parseCanonicalIntegrityManifest(bytes: Buffer): ExtensionIntegrityManifest {
  const parsed = parseJson(bytes, 'integrity manifest', 'invalid_integrity_manifest')
  let integrity: ExtensionIntegrityManifest
  try {
    integrity = integrityManifestSchema.parse(parsed) as ExtensionIntegrityManifest
  } catch (error) {
    throw new ExtensionStoreError(
      'invalid_integrity_manifest',
      `Invalid extension integrity manifest: ${extensionErrorMessage(error)}`,
      { cause: error }
    )
  }

  const normalizedFiles: Record<string, string> = {}
  const portablePaths = new Map<string, string>()
  const inputKeys = Object.keys(integrity.files)
  const sortedKeys = [...inputKeys].sort()
  if (inputKeys.some((key, index) => key !== sortedKeys[index])) {
    throw new ExtensionStoreError(
      'invalid_integrity_manifest',
      'Extension integrity file paths must be sorted lexicographically.'
    )
  }
  for (const [path, digest] of Object.entries(integrity.files)) {
    const normalizedPath = validateArtifactPath(path)
    if (normalizedPath === EXTENSION_INTEGRITY_PATH || normalizedPath === EXTENSION_SIGNATURE_PATH) {
      throw new ExtensionStoreError(
        'invalid_integrity_manifest',
        `Extension metadata cannot include a digest for ${normalizedPath}.`
      )
    }
    const portableKey = normalizedPath.normalize('NFC').toLocaleLowerCase('en-US')
    const previous = portablePaths.get(portableKey)
    if (previous) {
      throw new ExtensionStoreError(
        'invalid_integrity_manifest',
        `Integrity paths conflict on case-insensitive filesystems: ${previous} and ${normalizedPath}.`
      )
    }
    portablePaths.set(portableKey, normalizedPath)
    normalizedFiles[normalizedPath] = digest
  }
  const normalized = Object.freeze({
    ...integrity,
    files: Object.freeze(normalizedFiles)
  })
  const canonicalBytes = Buffer.from(canonicalJson(normalized as CanonicalJsonValue), 'utf8')
  if (!bytes.equals(canonicalBytes)) {
    throw new ExtensionStoreError(
      'invalid_integrity_manifest',
      'Extension integrity manifest is not canonical JSON.'
    )
  }
  return normalized
}

function parseSignatureDescriptor(bytes: Buffer): ExtensionSignatureDescriptor {
  try {
    return Object.freeze(
      signatureDescriptorSchema.parse(parseJson(
        bytes,
        'signature descriptor',
        'invalid_signature'
      ))
    ) as ExtensionSignatureDescriptor
  } catch (error) {
    if (error instanceof ExtensionStoreError) throw error
    throw new ExtensionStoreError(
      'invalid_signature',
      `Invalid extension signature descriptor: ${extensionErrorMessage(error)}`,
      { cause: error }
    )
  }
}

function parseJson(
  bytes: Buffer,
  label: string,
  code: 'invalid_integrity_manifest' | 'invalid_signature' | 'invalid_domain_manifest' | 'install_scripts_forbidden'
): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) {
    throw new ExtensionStoreError(
      code,
      `Extension ${label} is not valid UTF-8 JSON.`,
      { cause: error }
    )
  }
}

function validateIntegrityFileSet(
  files: ReadonlyMap<string, Buffer>,
  integrity: ExtensionIntegrityManifest
): void {
  const actualPaths = [...files.keys()]
    .filter((path) => path !== EXTENSION_INTEGRITY_PATH && path !== EXTENSION_SIGNATURE_PATH)
    .sort()
  const declaredPaths = Object.keys(integrity.files)
  if (
    actualPaths.length !== declaredPaths.length ||
    actualPaths.some((path, index) => path !== declaredPaths[index])
  ) {
    const undeclared = actualPaths.filter((path) => !Object.hasOwn(integrity.files, path))
    const missing = declaredPaths.filter((path) => !files.has(path))
    throw new ExtensionStoreError(
      'invalid_integrity_manifest',
      `Extension integrity file set is incomplete.` +
        `${undeclared.length > 0 ? ` Undeclared: ${undeclared.join(', ')}.` : ''}` +
        `${missing.length > 0 ? ` Missing: ${missing.join(', ')}.` : ''}`
    )
  }
}

function verifyFileDigests(
  files: ReadonlyMap<string, Buffer>,
  integrity: ExtensionIntegrityManifest
): void {
  for (const [path, expectedDigest] of Object.entries(integrity.files)) {
    const actualDigest = sha256(requiredFile(files, path, 'signed payload file'))
    if (actualDigest !== expectedDigest) {
      throw new ExtensionStoreError(
        'invalid_integrity_manifest',
        `Extension payload digest does not match for ${path}.`
      )
    }
  }
}

function verifyDetachedSignature(
  key: TrustedOfficialPublisherKey,
  descriptor: ExtensionSignatureDescriptor,
  integrityBytes: Buffer
): void {
  const signatureBytes = Buffer.from(descriptor.signature, 'base64')
  if (
    signatureBytes.byteLength !== 64 ||
    signatureBytes.toString('base64') !== descriptor.signature
  ) {
    throw new ExtensionStoreError(
      'invalid_signature',
      'Extension signature is not canonical Ed25519 base64.'
    )
  }
  let valid = false
  try {
    valid = verifySignature(null, integrityBytes, key.publicKey, signatureBytes)
  } catch (error) {
    throw new ExtensionStoreError(
      'invalid_signature',
      `Extension signature verification failed: ${extensionErrorMessage(error)}`,
      { cause: error }
    )
  }
  if (!valid) {
    throw new ExtensionStoreError(
      'invalid_signature',
      'Extension detached signature does not match its integrity manifest.'
    )
  }
}

function assertNoInstallScripts(files: ReadonlyMap<string, Buffer>): void {
  for (const [path, bytes] of files) {
    if (path.split('/').at(-1) !== 'package.json') continue
    const value = parseJson(
      bytes,
      `package manifest ${path}`,
      'install_scripts_forbidden'
    )
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ExtensionStoreError(
        'install_scripts_forbidden',
        `Extension package manifest ${path} must be a JSON object.`
      )
    }
    const scripts = (value as { scripts?: unknown }).scripts
    if (scripts === undefined) continue
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
      throw new ExtensionStoreError(
        'install_scripts_forbidden',
        `Extension package manifest ${path} has an invalid scripts field.`
      )
    }
    const forbidden = Object.keys(scripts).filter((name) => FORBIDDEN_INSTALL_SCRIPTS.has(name))
    if (forbidden.length > 0) {
      throw new ExtensionStoreError(
        'install_scripts_forbidden',
        `Extension artifacts cannot declare install lifecycle scripts (${forbidden.join(', ')}) in ${path}.`
      )
    }
  }
}

function requiredFile(
  files: ReadonlyMap<string, Buffer>,
  path: string,
  label: string
): Buffer {
  const bytes = files.get(path)
  if (!bytes) {
    const code = path === EXTENSION_SIGNATURE_PATH
      ? 'invalid_signature'
      : path === EXTENSION_DOMAIN_MANIFEST_PATH
        ? 'invalid_domain_manifest'
        : 'invalid_integrity_manifest'
    throw new ExtensionStoreError(code, `Extension artifact is missing its ${label}: ${path}`)
  }
  return bytes
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
