import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { z } from 'zod'
import { readExtensionArtifact } from './artifact-reader'
import { canonicalJson, type CanonicalJsonValue } from './canonical-json'
import { ExtensionStoreError, extensionErrorMessage, type ExtensionStoreErrorCode } from './errors'
import type { ExtensionArtifactLimits, ExtensionArtifactSource } from './types'

/**
 * Canonical reader/validator for the DSH runtime plugin artifact
 * (`.sciforge-dsh-plugin`).
 *
 * This is deliberately NOT the sandboxed-runtime `.sciforge-plugin` path: that
 * one carries an Ed25519 detached signature, requires a
 * `kind: "sandboxed-runtime"` domain manifest and is installed by
 * `SignedExtensionStore`. A DSH plugin is a directory whose manifest is its own
 * `package.json` and whose entry is a DSH/Cordis module loaded by
 * ProcessExtensionHost. The two contracts stay separate; only the ZIP safety
 * checks (central directory, canonical paths, size/count limits) are shared
 * through `readExtensionArtifact`.
 *
 * `META-INF/sciforge-dsh-plugin.json` is canonical JSON describing the payload:
 * identity, entry, declared host dependencies, requested tool grants and the
 * SHA-256 of every payload file. Everything the installer trusts about the
 * artifact comes from this digest-verified manifest plus host policy — never
 * from a market catalog entry.
 */

export const DSH_PLUGIN_ARTIFACT_MANIFEST_PATH = 'META-INF/sciforge-dsh-plugin.json'
/**
 * Publisher signature over the canonical manifest bytes. Like the manifest it is
 * excluded from the manifest's own file list (a signature cannot cover itself),
 * but it IS copied into the installed directory so the install can be re-checked.
 */
export const DSH_PLUGIN_ARTIFACT_SIGNATURE_PATH = 'META-INF/sciforge-signature.json'
export const DSH_PLUGIN_ARTIFACT_EXTENSION = '.sciforge-dsh-plugin'

export const DSH_PLUGIN_TOOL_EFFECTS = Object.freeze([
  'read',
  'compute',
  'workspace-write',
  'external-write',
  'destructive'
] as const)

const canonicalIdentity = /^[a-z][a-z0-9]*([._-][a-z0-9]+)+$/
const packageNamePattern = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const exactVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/
const sha256Pattern = /^[0-9a-f]{64}$/
const FORBIDDEN_LIFECYCLE_SCRIPTS = Object.freeze([
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
  'postpublish'
])

export const dshPluginToolGrantSchema = z.object({
  id: z.string().trim().min(3).max(128).regex(canonicalIdentity),
  effect: z.enum(DSH_PLUGIN_TOOL_EFFECTS),
  readResource: z.literal('workspace').optional()
}).strict()

/** DSH tool names are grant lookup keys (`status`, `map_data`); the runner only pattern-checks the grant id. */
const dshToolName = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/

export const dshPluginArtifactManifestSchema = z.object({
  schemaVersion: z.literal(1),
  packageName: z.string().trim().min(1).max(214).regex(packageNamePattern),
  version: z.string().trim().max(64).regex(exactVersionPattern),
  entry: z.string().trim().min(1).max(1_024),
  dsh: z.record(z.string(), z.unknown()),
  engines: z.object({ dsh: z.string().trim().min(1).max(128).optional() }).strict().optional(),
  hostDependencies: z.array(z.string().trim().min(1).max(214)).max(64),
  tools: z.record(z.string().trim().min(1).max(128).regex(dshToolName), dshPluginToolGrantSchema),
  files: z.record(z.string().trim().min(1).max(1_024), z.string().regex(sha256Pattern))
}).strict()

export type DshPluginToolGrant = z.infer<typeof dshPluginToolGrantSchema>
export type DshPluginArtifactManifest = z.infer<typeof dshPluginArtifactManifestSchema>

export type DshPluginArtifact = Readonly<{
  manifest: DshPluginArtifactManifest
  /** Payload files (excluding the manifest), keyed by canonical artifact path. */
  files: ReadonlyMap<string, Buffer>
  /** SHA-256 of the artifact file itself, when the source was bytes on disk. */
  artifactSha256: string
  /** Exact bytes the publisher signature must cover. */
  manifestBytes: Buffer
  /** Publisher signature file, when the artifact carries one. */
  signatureBytes: Buffer | undefined
}>

const packageJsonSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  main: z.string().optional(),
  exports: z.unknown().optional(),
  scripts: z.record(z.string(), z.unknown()).optional(),
  dsh: z.unknown().optional()
}).passthrough()

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function fail(message: string, code: ExtensionStoreErrorCode = 'unsafe_artifact'): never {
  throw new ExtensionStoreError(code, message)
}

export function manifestEntryPath(packageJson: z.infer<typeof packageJsonSchema>): string | undefined {
  const exportsField = packageJson.exports
  let candidate: unknown
  if (typeof exportsField === 'string') {
    candidate = exportsField
  } else if (exportsField && typeof exportsField === 'object') {
    const root = (exportsField as Record<string, unknown>)['.']
    if (typeof root === 'string') candidate = root
    else if (root && typeof root === 'object') {
      const conditions = root as Record<string, unknown>
      candidate = conditions.import ?? conditions.default ?? conditions.require
    }
  }
  if (typeof candidate !== 'string' && typeof packageJson.main === 'string') {
    candidate = packageJson.main
  }
  if (typeof candidate !== 'string' || !candidate) return undefined
  return candidate.replace(/^\.\//, '')
}

/**
 * Reads and fully validates a `.sciforge-dsh-plugin` artifact: ZIP safety,
 * manifest encoding, payload identity, per-file digests and the absence of
 * install-time lifecycle scripts. Throws `ExtensionStoreError` on any failure.
 */
export async function readDshPluginArtifact(
  source: ExtensionArtifactSource,
  limits?: Partial<ExtensionArtifactLimits>
): Promise<DshPluginArtifact> {
  const artifactSha256 = await sourceSha256(source)
  const rawFiles = await readExtensionArtifact(source, limits)
  // Keep the manifest in the payload: the installed directory must be a
  // faithful copy of the artifact, manifest included, so it can be re-validated
  // from disk after extraction.
  const files = new Map(rawFiles)

  const manifestBytes = files.get(DSH_PLUGIN_ARTIFACT_MANIFEST_PATH)
  if (!manifestBytes) {
    fail(`DSH plugin artifact is missing ${DSH_PLUGIN_ARTIFACT_MANIFEST_PATH}.`)
  }
  const payloadFiles = new Map(files)
  payloadFiles.delete(DSH_PLUGIN_ARTIFACT_MANIFEST_PATH)
  // The signature cannot cover itself, so it is excluded from the manifest's file
  // list exactly like the manifest. It still ships inside the directory.
  const signatureBytes = payloadFiles.get(DSH_PLUGIN_ARTIFACT_SIGNATURE_PATH)
  payloadFiles.delete(DSH_PLUGIN_ARTIFACT_SIGNATURE_PATH)

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(manifestBytes.toString('utf8'))
  } catch (error) {
    fail(`DSH plugin manifest is not valid JSON: ${extensionErrorMessage(error)}`)
  }
  if (canonicalJson(parsedJson as CanonicalJsonValue) !== manifestBytes.toString('utf8')) {
    fail('DSH plugin manifest must use canonical JSON encoding.')
  }

  const parsedManifest = dshPluginArtifactManifestSchema.safeParse(parsedJson)
  if (!parsedManifest.success) {
    fail(`DSH plugin manifest is invalid: ${parsedManifest.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
  }
  const manifest = parsedManifest.data

  const declaredPaths = Object.keys(manifest.files).sort()
  const actualPaths = [...payloadFiles.keys()].sort()
  if (declaredPaths.length !== actualPaths.length ||
    declaredPaths.some((path, index) => path !== actualPaths[index])) {
    fail('DSH plugin manifest file list does not match the payload exactly.')
  }
  for (const path of declaredPaths) {
    const contents = payloadFiles.get(path)
    if (!contents) fail(`DSH plugin payload file is missing: ${path}`)
    if (sha256Hex(contents) !== manifest.files[path]) {
      fail(`DSH plugin payload digest mismatch: ${path}`)
    }
  }

  const packageJsonBytes = payloadFiles.get('package.json')
  if (!packageJsonBytes) fail('DSH plugin payload must contain package.json.')
  const parsedPackage = packageJsonSchema.safeParse(JSON.parse(packageJsonBytes.toString('utf8')))
  if (!parsedPackage.success) {
    fail(`DSH plugin package.json is invalid: ${parsedPackage.error.issues.map((issue) => issue.message).join('; ')}`)
  }
  const packageJson = parsedPackage.data
  if (packageJson.name !== manifest.packageName) {
    fail(`DSH plugin package.json name ${packageJson.name} does not match manifest packageName ${manifest.packageName}.`)
  }
  if (packageJson.version !== manifest.version) {
    fail(`DSH plugin package.json version ${packageJson.version} does not match manifest version ${manifest.version}.`)
  }
  const entry = manifestEntryPath(packageJson)
  if (entry !== manifest.entry) {
    fail(`DSH plugin manifest entry ${manifest.entry} does not match package.json entry ${String(entry)}.`)
  }
  if (!payloadFiles.has(manifest.entry)) {
    fail(`DSH plugin entry file is not part of the payload: ${manifest.entry}`)
  }
  for (const hook of FORBIDDEN_LIFECYCLE_SCRIPTS) {
    if (packageJson.scripts?.[hook] !== undefined) {
      fail(`DSH plugin package.json declares a forbidden lifecycle script: ${hook}`)
    }
  }
  const dsh = manifest.dsh as { bundle?: unknown; client?: unknown; profile?: unknown }
  if (!dsh.bundle && !dsh.client && !dsh.profile) {
    fail('DSH plugin manifest must declare bundle, client or profile.')
  }

  return Object.freeze({
    manifest,
    files,
    artifactSha256,
    manifestBytes,
    signatureBytes
  })
}

/** Digest of the artifact itself: archive bytes, or '' for a directory source. */
async function sourceSha256(source: ExtensionArtifactSource): Promise<string> {
  if (typeof source !== 'string') {
    return source.kind === 'zip-bytes' ? sha256Hex(source.bytes) : ''
  }
  try {
    const stats = await lstat(source)
    if (!stats.isFile()) return ''
    return sha256Hex(await readFile(source))
  } catch {
    return ''
  }
}

/** Convenience wrapper for the market install path: bytes already in hand. */
export async function readDshPluginArtifactBytes(
  bytes: Uint8Array,
  limits?: Partial<ExtensionArtifactLimits>
): Promise<DshPluginArtifact> {
  return readDshPluginArtifact({ kind: 'zip-bytes', bytes }, limits)
}