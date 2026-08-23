import { lstatSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import packageManifest from '../../package.json' with { type: 'json' }

const OPENCONTENT_SKILL_BUNDLED_ASSET_VERSION = 'opencontent-base-1.0.1' as const

export type OpenContentSkillRuntimeFileRole =
  | 'cli-entrypoint'
  | 'docflow-entrypoint'
  | 'docflow-probe-helper'
  | 'package-manifest'
  | 'cli-single-attempt-patch'

export type OpenContentSkillRuntimeFileIntegrity = Readonly<{
  role: OpenContentSkillRuntimeFileRole
  relativePath: string
  sha256: string
  size: number
}>

const packageOwnedRuntimeTrust = readPackageOwnedRuntimeTrust()
const trustedRuntimeFiles = packageOwnedRuntimeTrust.asset.trustedRuntimeFiles
const runtimeFileByRole = new Map(trustedRuntimeFiles.map((file) => [file.role, file]))
const runtimeFile = (role: OpenContentSkillRuntimeFileRole): OpenContentSkillRuntimeFileIntegrity => {
  const file = runtimeFileByRole.get(role)
  if (!file) throw new TypeError('OpenContent package-owned runtime trust is incomplete.')
  return file
}

/**
 * Fixed, package-owned paths. A transport may select one of these entrypoints;
 * callers can never supply an executable path.
 */
export const OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR = Object.freeze({
  version: OPENCONTENT_SKILL_BUNDLED_ASSET_VERSION,
  cliVersion: '1.0.0' as const,
  installation: packageOwnedRuntimeTrust.installation,
  trustedRuntimeFiles,
  moduleFormat: 'commonjs' as const,
  packagedResourcesRelativePath: packageOwnedRuntimeTrust.asset.packagedResourcesPath,
  cliEntrypointRelativePath: runtimeFile('cli-entrypoint').relativePath,
  docflowEntrypointRelativePath: runtimeFile('docflow-entrypoint').relativePath,
  docflowProbeHelperRelativePath: runtimeFile('docflow-probe-helper').relativePath,
  packageJsonRelativePath: runtimeFile('package-manifest').relativePath,
  cliSingleAttemptPatchRelativePath: runtimeFile('cli-single-attempt-patch').relativePath
})

type OpenContentSkillBundledAssetPaths = Readonly<{
  root: string
  cliEntrypoint: string
  docflowEntrypoint: string
  docflowProbeHelper: string
  packageJson: string
  cliSingleAttemptPatch: string
}>

export type OpenContentSkillBundledAssetLocation =
  | Readonly<{ mode: 'source'; assetRoot: string }>
  | Readonly<{ mode: 'packaged'; resourcesPath: string }>

/**
 * Resolves identically from the source-exported package in tests and from the
 * Electron main bundle in packaged applications.
 * This function does not execute, import, or evaluate the bundled files.
 */
export function resolveOpenContentSkillBundledAssetPaths(
  location: OpenContentSkillBundledAssetLocation
): OpenContentSkillBundledAssetPaths {
  let root: string
  if (location.mode === 'packaged') {
    if (!isAbsolute(location.resourcesPath)) {
      throw new TypeError('Electron resourcesPath must be absolute.')
    }
    root = resolve(
      location.resourcesPath,
      OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.packagedResourcesRelativePath
    )
  } else {
    if (!isAbsolute(location.assetRoot)) {
      throw new TypeError('Source OpenContent asset root must be absolute.')
    }
    root = resolve(location.assetRoot)
  }

  const cliEntrypoint = resolve(root, OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.cliEntrypointRelativePath)
  const docflowEntrypoint = resolve(
    root,
    OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.docflowEntrypointRelativePath
  )
  const docflowProbeHelper = resolve(
    root,
    OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.docflowProbeHelperRelativePath
  )
  const packageJson = resolve(
    root,
    OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.packageJsonRelativePath
  )
  const cliSingleAttemptPatch = resolve(
    root,
    OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.cliSingleAttemptPatchRelativePath
  )

  return Object.freeze({
    root,
    cliEntrypoint,
    docflowEntrypoint,
    docflowProbeHelper,
    packageJson,
    cliSingleAttemptPatch
  })
}

/** Fail closed before a production runner attempts to start a bundled entrypoint. */
export function assertOpenContentSkillBundledAssetsPresent(
  location: OpenContentSkillBundledAssetLocation
): OpenContentSkillBundledAssetPaths {
  const paths = resolveOpenContentSkillBundledAssetPaths(location)
  try {
    const trustedRoot = location.mode === 'packaged'
      ? resolve(location.resourcesPath)
      : paths.root
    assertNoBundledAssetSymlink(trustedRoot, paths.root)
    if (!statSync(paths.root).isDirectory()) {
      throw new TypeError('invalid root')
    }
    const canonicalRoot = realpathSync(paths.root)
    for (const runtimeFile of [
      paths.cliEntrypoint,
      paths.docflowEntrypoint,
      paths.docflowProbeHelper,
      paths.packageJson,
      paths.cliSingleAttemptPatch
    ]) {
      assertNoBundledAssetSymlink(paths.root, runtimeFile)
      if (!statSync(runtimeFile).isFile()) {
        throw new TypeError('invalid runtime file')
      }
      const runtimeFileRelativePath = relative(canonicalRoot, realpathSync(runtimeFile))
      if (runtimeFileRelativePath.startsWith('..') || isAbsolute(runtimeFileRelativePath)) {
        throw new TypeError('escaped runtime file')
      }
    }
  } catch {
    throw new TypeError('Bundled OpenContent assets are unavailable or invalid.')
  }
  return paths
}

function readPackageOwnedRuntimeTrust(): Readonly<{
  installation: Readonly<{
    archiveSha256: string
    overlayId: string
    overlayRoot: string
    version: string
  }>
  asset: Readonly<{
    packagedResourcesPath: string
    trustedRuntimeFiles: readonly OpenContentSkillRuntimeFileIntegrity[]
  }>
}> {
  const trust = packageManifest.sciforgeInternalRuntimeTrust
  const installation = trust.installations[0]
  const asset = installation?.assets[0]
  const roles = new Set<OpenContentSkillRuntimeFileRole>([
    'cli-entrypoint',
    'docflow-entrypoint',
    'docflow-probe-helper',
    'package-manifest',
    'cli-single-attempt-patch'
  ])
  if (trust.contractVersion !== 1 || trust.installations.length !== 1 ||
    !installation || installation.assets.length !== 1 || !asset ||
    !/^[a-f0-9]{64}$/u.test(installation.archiveSha256) ||
    !/^[a-z0-9][a-z0-9-]*$/u.test(installation.overlayId) ||
    !installation.overlayRoot.startsWith('internal/') ||
    installation.version.trim() === '' || asset.packagedResourcesPath.trim() === '' ||
    asset.trustedRuntimeFiles.length !== roles.size) {
    throw new TypeError('OpenContent package-owned runtime trust is invalid.')
  }
  const files = asset.trustedRuntimeFiles.map((file) => {
    if (!roles.delete(file.role as OpenContentSkillRuntimeFileRole) ||
      file.relativePath.startsWith('/') || file.relativePath.includes('..') ||
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      !Number.isSafeInteger(file.size) || file.size < 1) {
      throw new TypeError('OpenContent package-owned runtime file trust is invalid.')
    }
    return Object.freeze({
      role: file.role as OpenContentSkillRuntimeFileRole,
      relativePath: file.relativePath,
      sha256: file.sha256,
      size: file.size
    })
  })
  if (roles.size !== 0) {
    throw new TypeError('OpenContent package-owned runtime trust is incomplete.')
  }
  return Object.freeze({
    installation: Object.freeze({
      archiveSha256: installation.archiveSha256,
      overlayId: installation.overlayId,
      overlayRoot: installation.overlayRoot,
      version: installation.version
    }),
    asset: Object.freeze({
      packagedResourcesPath: asset.packagedResourcesPath,
      trustedRuntimeFiles: Object.freeze(files)
    })
  })
}

function assertNoBundledAssetSymlink(root: string, candidate: string): void {
  const candidateRelativePath = relative(root, candidate)
  if (candidateRelativePath.startsWith('..') || isAbsolute(candidateRelativePath)) {
    throw new TypeError('escaped runtime file')
  }
  if (lstatSync(root).isSymbolicLink()) {
    throw new TypeError('symbolic runtime root')
  }
  let current = root
  if (candidateRelativePath === '') return
  for (const segment of candidateRelativePath.split(sep)) {
    current = resolve(current, segment)
    if (lstatSync(current).isSymbolicLink()) {
      throw new TypeError('symbolic runtime file')
    }
  }
}
