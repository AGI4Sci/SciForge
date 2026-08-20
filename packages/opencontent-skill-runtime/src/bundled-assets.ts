import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { OPENCONTENT_SKILL_SOURCE_ZIP_SHA256 } from './contract.js'

export const OPENCONTENT_SKILL_BUNDLED_ASSET_VERSION = 'opencontent-base-1.0.1' as const

/**
 * Fixed, package-owned paths. A transport may select one of these entrypoints;
 * callers can never supply an executable path.
 */
export const OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR = Object.freeze({
  version: OPENCONTENT_SKILL_BUNDLED_ASSET_VERSION,
  sourceZipSha256: OPENCONTENT_SKILL_SOURCE_ZIP_SHA256,
  moduleFormat: 'commonjs' as const,
  packagedResourcesRelativePath: `opencontent/${OPENCONTENT_SKILL_BUNDLED_ASSET_VERSION}`,
  cliEntrypointRelativePath: 'cli/bin/oc.js',
  docflowEntrypointRelativePath: 'cli/docflow/docflow-node.cjs',
  docflowProbeHelperRelativePath: 'scripts/docflow-probe-compact.cjs',
  cliSingleAttemptPatchRelativePath:
    'runtime-patches/cli-auth-retry-single-attempt.v1.json'
})

export type OpenContentSkillBundledAssetPaths = Readonly<{
  root: string
  cliEntrypoint: string
  docflowEntrypoint: string
  docflowProbeHelper: string
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

  const cliEntrypoint = resolve(root, 'cli', 'bin', 'oc.js')
  const docflowEntrypoint = resolve(root, 'cli', 'docflow', 'docflow-node.cjs')
  const docflowProbeHelper = resolve(root, 'scripts', 'docflow-probe-compact.cjs')
  const cliSingleAttemptPatch = resolve(
    root,
    'runtime-patches',
    'cli-auth-retry-single-attempt.v1.json'
  )

  return Object.freeze({
    root,
    cliEntrypoint,
    docflowEntrypoint,
    docflowProbeHelper,
    cliSingleAttemptPatch
  })
}

/** Fail closed before a production runner attempts to start a bundled entrypoint. */
export function assertOpenContentSkillBundledAssetsPresent(
  location: OpenContentSkillBundledAssetLocation
): OpenContentSkillBundledAssetPaths {
  const paths = resolveOpenContentSkillBundledAssetPaths(location)
  try {
    if (!statSync(paths.root).isDirectory()) {
      throw new TypeError('invalid root')
    }
    const canonicalRoot = realpathSync(paths.root)
    for (const runtimeFile of [
      paths.cliEntrypoint,
      paths.docflowEntrypoint,
      paths.docflowProbeHelper,
      paths.cliSingleAttemptPatch
    ]) {
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
