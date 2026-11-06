import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PluginAdapterContract } from '@sciforge/plugin-sdk'
import { normalizeDshMarketApproval, type DshMarketApprovalSnapshot } from '../../shared/dsh-market'
import type { DomainExtensionSummary } from '../../shared/domain-extensions'
import type { ExtensionArtifactLimits } from './types'
import {
  readDshPluginArtifact,
  readDshPluginArtifactBytes,
  sha256Hex,
  dshPluginPortOperationsSchema,
  type DshPluginArtifactManifest
} from './dsh-plugin-artifact'
import { canonicalJson, type CanonicalJsonValue } from './canonical-json'
import {
  verifyDshPluginSignature,
  type DshPublisherKeyring
} from './dsh-plugin-signature'
import {
  policyEntryFor,
  readDshPluginPolicy,
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
 * the user-approved tool list explicitly. Recoverable failures restore the old
 * installation and policy. If runtime/filesystem recovery also fails, the error
 * reports incomplete recovery and retains prior directory/version data for
 * recovery; this is not a crash-atomic installation journal.
 */

export type DshPluginInstallPort = Readonly<{
  installFromDirectory: (directory: string, contract: PluginAdapterContract, restoreInstallation: () => Promise<void>) => Promise<DomainExtensionSummary>
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
  /** Optional Host operation allowlist; unknown requested operations fail before writing. */
  supportedPortOperations?: ReadonlySet<string>
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
  /** Required by the market path; compare with actual verified identity before writes. */
  expectedApproval: DshMarketApprovalSnapshot
  /** Tool names the user approved. Must cover every requested tool exactly. */
  approvedToolNames: readonly string[]
  /** Host-approved operations, separate from the artifact declaration. */
  approvedPorts?: readonly string[]
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
  approvedGrants: DshMarketApprovalSnapshot['tools']
): readonly string[] {
  const normalize = (tools: DshMarketApprovalSnapshot['tools']) => normalizeDshMarketApproval({
    packageName: manifest.packageName, version: manifest.version, sha256: '0'.repeat(64), publisher: null,
    entry: manifest.entry, tools, ports: [], hostDependencies: []
  }).tools
  if (canonicalJson(normalize(approvedGrants) as unknown as CanonicalJsonValue) !== canonicalJson(normalize(Object.entries(manifest.tools).map(([name, grant]) => ({ name, ...grant }))) as unknown as CanonicalJsonValue)) {
    throw new Error('Approved complete tool grants differ from artifact declarations.')
  }
  return Object.keys(manifest.tools).sort()
}

function assertSelectedToolNames(manifest: DshPluginArtifactManifest, approvedToolNames: readonly string[]): readonly string[] {
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

export function assertPortOperationsApproved(
  manifest: DshPluginArtifactManifest,
  approvedPortOperations: readonly string[] = [],
  supportedPortOperations?: ReadonlySet<string>
): readonly string[] {
  const requested = [...(manifest.ports ?? [])].sort()
  const approved = dshPluginPortOperationsSchema.parse(approvedPortOperations).sort()
  const unapproved = requested.filter((operation) => !approved.includes(operation))
  if (unapproved.length > 0) {
    throw new Error(`Plugin ${manifest.packageName}@${manifest.version} requests unapproved Host port operations: ${unapproved.join(', ')}`)
  }
  const undeclared = approved.filter((operation) => !requested.includes(operation))
  if (undeclared.length > 0) throw new Error(`Approved Host port operations are not declared by the artifact: ${undeclared.join(', ')}`)
  const unsupported = supportedPortOperations === undefined ? [] : requested.filter((operation) => !supportedPortOperations.has(operation))
  if (unsupported.length > 0) throw new Error(`This Host does not support requested port operations: ${unsupported.join(', ')}`)
  return Object.freeze(requested)
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

// Policy and installation rollback share this process-local writer queue. Read
// policy only after acquiring it, so rolling back one package cannot lose a
// concurrent approval for another package. This is not a crash journal.
const policyWriters = new Map<string, Promise<unknown>>()
function withPolicyWriter<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const key = resolve(path)
  const result = (policyWriters.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation)
  policyWriters.set(key, result)
  return result.finally(() => { if (policyWriters.get(key) === result) policyWriters.delete(key) })
}

export function installDshPluginArtifact(
  deps: DshPluginInstallDeps,
  request: DshPluginInstallRequest
): Promise<DshPluginInstallResult> {
  return withPolicyWriter(deps.policyPath, async () => installApprovedArtifact(deps, request, await readDshPluginPolicy(deps.policyPath)))
}

async function installApprovedArtifact(
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
  {
    const expected = normalizeDshMarketApproval(request.expectedApproval)
    const actual = normalizeDshMarketApproval({
      packageName: manifest.packageName, version: manifest.version, sha256: artifactSha256,
      publisher: trust?.publisherId ?? null, entry: manifest.entry,
      tools: Object.entries(manifest.tools).map(([name, grant]) => ({ name, ...grant })),
      ports: manifest.ports ?? [], hostDependencies: manifest.hostDependencies
    })
    if (canonicalJson(expected as unknown as CanonicalJsonValue) !== canonicalJson(actual as unknown as CanonicalJsonValue)) {
      throw new Error('Verified artifact identity or complete grants differ from approval; refresh and confirm again.')
    }
  }
  assertDshPluginPublisherAllowed(manifest, deps.officialPackagePattern)
  assertHostDependenciesSatisfied(manifest, deps.hostProvidedDependencies)
  const approvedTools = assertToolGrantsApproved(manifest, request.expectedApproval.tools)
  assertSelectedToolNames(manifest, request.approvedToolNames)
  const approvedPorts = assertPortOperationsApproved(manifest, request.approvedPorts, deps.supportedPortOperations)

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
      await rm(replacement, { recursive: true, force: true }).catch(() => undefined)
      if (previousDirectory) {
        try { await rename(previousDirectory, target); previousDirectory = undefined }
        catch (restoreError) { throw new AggregateError([error, restoreError], 'Plugin directory replacement and recovery failed; previous installation is retained.') }
      }
      throw error
    }

    const entry: DshPluginPolicyEntry = {
      packageName: manifest.packageName,
      version: manifest.version,
      dshRuntimeVersion: deps.dshRuntimeVersion,
      hostApiRange: deps.hostApiRange,
      integrity: sha256Hex(Buffer.from(artifactSha256)),
      artifactSha256,
      ...(manifest.hostServices !== undefined ? { hostServices: manifest.hostServices } : {}),
      ...(manifest.ports !== undefined ? { declaredPorts: [...manifest.ports], ports: [...approvedPorts] } : {}),
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
        ...(manifest.hostServices !== undefined ? { hostServices: manifest.hostServices } : {}),
        ...(manifest.ports !== undefined ? { ports: approvedPorts } : {}),
        tools: manifest.tools
      })
    })

    let restored = false
    let filesRestored = false
    const restoreInstallation = async (): Promise<void> => {
      if (restored) return
      // Do not delete the backup in finally: if any recovery step fails, it is
      // the remaining recoverable installation, not disposable staging data.
      if (!filesRestored) {
        await rm(target, { recursive: true, force: true })
        if (previousDirectory) {
          await rename(previousDirectory, target)
          previousDirectory = undefined
        }
        filesRestored = true
      }
      await writeDshPluginPolicy(deps.policyPath, policy)
      restored = true
    }
    let summary: DomainExtensionSummary
    let serviceStarted = false
    try {
      // Runtime activation may resolve policy-owned host services immediately.
      await writeDshPluginPolicy(deps.policyPath, upsertPolicyEntry(policy, entry))
      serviceStarted = true
      summary = await deps.service.installFromDirectory(target, contract, restoreInstallation)
    } catch (error) {
      if (!serviceStarted) {
        try { await restoreInstallation() }
        catch (restoreError) { throw new AggregateError([error, restoreError], 'Plugin installation and file/policy recovery failed.') }
      }
      throw error
    }
    if (previousDirectory) {
      await rm(previousDirectory, { recursive: true, force: true }).catch(() => undefined)
      previousDirectory = undefined
    }

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
  }
}

export function uninstallDshPlugin(
  deps: DshPluginInstallDeps,
  packageName: string
): Promise<void> {
  return withPolicyWriter(deps.policyPath, async () => {
    const policy = await readDshPluginPolicy(deps.policyPath)
    if (!policy.approved.some((entry) => entry.packageName === packageName)) {
      throw new Error(`Plugin ${packageName} has no recorded approval, so it was not installed by the market.`)
    }
    await deps.service.uninstall(packageName)
    await rm(installedPluginPathFor(deps.installedRoot, packageName), { recursive: true, force: true })
    await writeDshPluginPolicy(deps.policyPath, removePolicyEntry(policy, packageName))
    await deps.service.refreshDiscoveredPlugins()
  })
}

/** Moves an existing install aside so a replacement can be swapped in atomically. */
async function renameAside(target: string): Promise<string | undefined> {
  try {
    await readFile(join(target, 'package.json'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const aside = join(dirname(target), `.${basename(target)}.previous-${randomUUID()}`)
  await rename(target, aside)
  return aside
}
