import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { PluginAdapterContract } from '@sciforge/plugin-sdk'
import type { DomainExtensionSummary } from '../../shared/domain-extensions'
import type { ExtensionArtifactLimits } from './types'
import {
  readDshPluginArtifact,
  readDshPluginArtifactBytes,
  sha256Hex,
  type DshPluginArtifactManifest
} from './dsh-plugin-artifact'
import { canonicalJson, type CanonicalJsonValue } from './canonical-json'
import {
  verifyDshPluginSignature,
  type DshPublisherKeyring
} from './dsh-plugin-signature'
import {
  policyEntryFor,
  removePolicyEntry,
  upsertPolicyEntry,
  writeDshPluginPolicy,
  type DshPluginPolicy,
  type DshPluginPolicyEntry
} from './dsh-plugin-policy'

/**
 * Installs a `.sciforge-dsh-plugin` artifact into the release plugin root.
 *
 * Everything granted to the plugin comes from host policy: the artifact's
 * digest-verified manifest only *requests* tool grants, and the caller must pass
 * the user-approved tool list explicitly. A failure at any step leaves no
 * half-installed directory and no policy entry, and an existing working install
 * is never destroyed by a failed one.
 */

export type DshPluginInstallPort = Readonly<{
  installFromDirectory: (directory: string, contract: PluginAdapterContract) => Promise<DomainExtensionSummary>
  uninstall: (packageName: string) => Promise<void>
  /** Re-runs discovery after the installer changed the plugin root. */
  refreshDiscoveredPlugins: () => Promise<void>
}>

export type DshPluginInstallDeps = Readonly<{
  /** Release plugin root; one directory per installed package. */
  installedRoot: string
  /** Transient extraction area, removed on both success and failure. */
  stagingRoot: string
  policyPath: string
  dshRuntimeVersion: string
  hostApiRange: string
  /** Host packages the plugin is allowed to require at runtime. */
  hostProvidedDependencies: ReadonlySet<string>
  /**
   * Trusted publishers for DSH artifacts. Host configuration, never artifact
   * input. An empty keyring means nothing is installable — that is the intended
   * fail-closed default, not an error state.
   */
  publisherKeyring: DshPublisherKeyring
  /**
   * Explicit development opt-in: only the local acceptance path sets this, and it
   * still refuses an artifact whose signature is present but invalid.
   */
  allowUnsigned?: boolean
  /** Official package namespace the host accepts; defaults to `@sciforge/plugin-*`. */
  officialPackagePattern?: RegExp
  service: DshPluginInstallPort
  limits?: Partial<ExtensionArtifactLimits>
}>

export type DshPluginInstallRequest = Readonly<{
  artifactPath?: string
  artifactBytes?: Uint8Array
  /** Digest published by the catalog; a mismatch is rejected before parsing. */
  expectedSha256?: string
  /** Tool names the user approved. Must cover every requested tool exactly. */
  approvedToolNames: readonly string[]
  source: string
}>

export type DshPluginInstallResult = Readonly<{
  packageName: string
  version: string
  installedDirectory: string
  artifactSha256: string
  tools: readonly string[]
  summary: DomainExtensionSummary
}>

/**
 * Official-namespace policy: only packages the host considers official may be
 * installed. This is host policy, not a property of the artifact, so the pattern
 * is supplied by the caller and defaults to the `@sciforge/plugin-*` convention.
 */
const DEFAULT_OFFICIAL_PLUGIN_PACKAGE = /^@sciforge\/plugin-[a-z0-9][a-z0-9-]*$/

export function assertDshPluginPublisherAllowed(
  manifest: DshPluginArtifactManifest,
  officialPackagePattern: RegExp = DEFAULT_OFFICIAL_PLUGIN_PACKAGE
): void {
  if (!officialPackagePattern.test(manifest.packageName)) {
    throw new Error(
      `Plugin ${manifest.packageName} is not in the official SciForge plugin namespace (${officialPackagePattern.source}).`
    )
  }
}

export function assertHostDependenciesSatisfied(
  manifest: DshPluginArtifactManifest,
  hostProvided: ReadonlySet<string>
): void {
  const missing = manifest.hostDependencies.filter((dependency) => !hostProvided.has(dependency))
  if (missing.length > 0) {
    throw new Error(
      `Plugin ${manifest.packageName}@${manifest.version} requires host packages this build does not provide: ${missing.join(', ')}`
    )
  }
}

export function assertToolGrantsApproved(
  manifest: DshPluginArtifactManifest,
  approvedToolNames: readonly string[]
): readonly string[] {
  const requested = Object.keys(manifest.tools).sort()
  const approved = [...new Set(approvedToolNames)].sort()
  const unapproved = requested.filter((name) => !approved.includes(name))
  if (unapproved.length > 0) {
    throw new Error(
      `Plugin ${manifest.packageName}@${manifest.version} requests unapproved tool grants: ${unapproved.join(', ')}`
    )
  }
  const unknown = approved.filter((name) => !requested.includes(name))
  if (unknown.length > 0) {
    throw new Error(`Approved tool grants are not declared by the artifact: ${unknown.join(', ')}`)
  }
  return requested
}

export function installedDirectoryName(packageName: string): string {
  return packageName.replace(/^@/, '').replace(/\//g, '-')
}

export function installedPluginPathFor(installedRoot: string, packageName: string): string {
  return resolve(installedRoot, installedDirectoryName(packageName))
}

async function writePayload(root: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
  for (const [path, contents] of files) {
    const target = join(root, ...path.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, contents)
  }
}

export async function installDshPluginArtifact(
  deps: DshPluginInstallDeps,
  request: DshPluginInstallRequest,
  policy: DshPluginPolicy
): Promise<DshPluginInstallResult> {
  const bytes = request.artifactBytes ?? (request.artifactPath ? await readFile(request.artifactPath) : undefined)
  if (!bytes) throw new Error('An install request needs artifact bytes or an artifact path.')

  const artifactSha256 = sha256Hex(bytes)
  if (request.expectedSha256 !== undefined && request.expectedSha256 !== artifactSha256) {
    throw new Error(
      `Artifact digest ${artifactSha256} does not match the published digest ${request.expectedSha256}.`
    )
  }

  const artifact = await readDshPluginArtifactBytes(bytes, deps.limits)
  const { manifest } = artifact
  // Publisher trust comes from host configuration and is checked before anything
  // is written. An artifact that carries no signature can only proceed when the
  // local acceptance path explicitly opted in; a present-but-invalid signature is
  // always a hard failure.
  const trust = artifact.signatureBytes === undefined && deps.allowUnsigned === true
    ? undefined
    : verifyDshPluginSignature({
        manifestBytes: artifact.manifestBytes,
        signatureBytes: artifact.signatureBytes,
        keyring: deps.publisherKeyring
      })
  assertDshPluginPublisherAllowed(manifest, deps.officialPackagePattern)
  assertHostDependenciesSatisfied(manifest, deps.hostProvidedDependencies)
  const approvedTools = assertToolGrantsApproved(manifest, request.approvedToolNames)

  const alreadyApproved = policyEntryFor(policy, manifest.packageName, manifest.version)
  if (alreadyApproved && alreadyApproved.artifactSha256 !== artifactSha256) {
    throw new Error(
      `Plugin ${manifest.packageName}@${manifest.version} is already approved with different content; ` +
      'bump the version to publish a change.'
    )
  }

  await mkdir(deps.stagingRoot, { recursive: true })
  await mkdir(deps.installedRoot, { recursive: true })
  const staging = await mkdtemp(join(deps.stagingRoot, 'install-'))
  const target = installedPluginPathFor(deps.installedRoot, manifest.packageName)
  let previousDirectory: string | undefined

  try {
    await writePayload(staging, artifact.files)
    // Re-read from disk: the bytes on disk are what the host will load, so the
    // digest check must cover the file system, not just the archive.
    const revalidated = await readDshPluginArtifact(staging, deps.limits)
    if (canonicalJson(revalidated.manifest as unknown as CanonicalJsonValue) !==
      canonicalJson(manifest as unknown as CanonicalJsonValue)) {
      throw new Error('The extracted plugin changed between verification and extraction.')
    }

    // Stage the replacement next to the target, swap, then re-enable. A failed
    // enable restores the previous directory instead of leaving nothing behind.
    const replacement = await mkdtemp(join(deps.installedRoot, '.install-'))
    await rm(replacement, { recursive: true, force: true })
    await rename(staging, replacement)
    try {
      previousDirectory = await renameAside(target)
      await rename(replacement, target)
    } catch (error) {
      if (previousDirectory) await rename(previousDirectory, target).catch(() => undefined)
      throw error
    }

    const entry: DshPluginPolicyEntry = {
      packageName: manifest.packageName,
      version: manifest.version,
      dshRuntimeVersion: deps.dshRuntimeVersion,
      hostApiRange: deps.hostApiRange,
      integrity: sha256Hex(Buffer.from(artifactSha256)),
      artifactSha256,
      tools: manifest.tools,
      hostDependencies: [...manifest.hostDependencies],
      publisherId: trust?.publisherId ?? null,
      approvedAt: new Date().toISOString(),
      source: request.source
    }
    const contract: PluginAdapterContract = Object.freeze({
      hostApiRange: deps.hostApiRange,
      permissions: Object.freeze([]) as readonly string[],
      approved: true,
      dshAuthorization: Object.freeze({
        packageName: manifest.packageName,
        packageVersion: manifest.version,
        dshRuntimeVersion: deps.dshRuntimeVersion,
        tools: manifest.tools
      })
    })

    let summary: DomainExtensionSummary
    try {
      summary = await deps.service.installFromDirectory(target, contract)
    } catch (error) {
      await rm(target, { recursive: true, force: true }).catch(() => undefined)
      if (previousDirectory) await rename(previousDirectory, target).catch(() => undefined)
      previousDirectory = undefined
      throw error
    }
    if (previousDirectory) {
      await rm(previousDirectory, { recursive: true, force: true }).catch(() => undefined)
      previousDirectory = undefined
    }
    await writeDshPluginPolicy(deps.policyPath, upsertPolicyEntry(policy, entry))

    return Object.freeze({
      packageName: manifest.packageName,
      version: manifest.version,
      installedDirectory: target,
      artifactSha256,
      tools: approvedTools,
      summary
    })
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    if (previousDirectory) await rm(previousDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function uninstallDshPlugin(
  deps: DshPluginInstallDeps,
  packageName: string,
  policy: DshPluginPolicy
): Promise<void> {
  await deps.service.uninstall(packageName)
  await rm(installedPluginPathFor(deps.installedRoot, packageName), { recursive: true, force: true })
  await writeDshPluginPolicy(deps.policyPath, removePolicyEntry(policy, packageName))
  // The directory is gone now, so discovery must run again for the listing to
  // stop showing the plugin.
  await deps.service.refreshDiscoveredPlugins()
}

/** Moves an existing install aside so a replacement can be swapped in atomically. */
async function renameAside(target: string): Promise<string | undefined> {
  try {
    await readFile(join(target, 'package.json'))
  } catch {
    return undefined
  }
  const aside = `${target}.previous-${Date.now()}`
  await rename(target, aside)
  return aside
}