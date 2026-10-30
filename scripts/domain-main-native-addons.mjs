import { copyFile, lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const METADATA_KEY = 'sciforgeMainNativeAddons'
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32'])

export async function stageDomainMainNativeAddons(input) {
  const repositoryRoot = requireAbsolutePath(input?.repositoryRoot, 'repositoryRoot')
  const mainOutputDirectory = requireAbsolutePath(
    input?.mainOutputDirectory,
    'mainOutputDirectory'
  )
  const platform = requirePlatform(input?.platform)
  const domainsRoot = join(repositoryRoot, 'packages', 'domains')
  const packageEntries = (await readdir(domainsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
  await mkdir(mainOutputDirectory, { recursive: true })
  const outputRoot = await realpath(mainOutputDirectory)
  const staged = []
  const claimedOutputs = new Map()

  for (const packageEntry of packageEntries) {
    const packageRoot = join(domainsRoot, packageEntry.name)
    const packageJsonPath = join(packageRoot, 'package.json')
    const packageJson = parseJsonObject(
      await readFile(packageJsonPath, 'utf8'),
      packageJsonPath
    )
    const metadata = packageJson[METADATA_KEY]
    if (metadata === undefined) continue
    const packageName = requireNonEmptyString(packageJson.name, `${packageJsonPath} name`)
    const declaration = parseDeclaration(metadata, packageName)
    const packageRootReal = await realpath(packageRoot)

    for (const artifact of declaration.artifacts) {
      if (!artifact.platforms.includes(platform)) continue
      const priorOwner = claimedOutputs.get(artifact.bundleRelativePath)
      if (priorOwner) {
        throw new Error(
          `Domain native addon output ${artifact.bundleRelativePath} is declared by both ` +
          `${priorOwner} and ${packageName}.`
        )
      }
      claimedOutputs.set(artifact.bundleRelativePath, packageName)

      const sourcePath = join(packageRootReal, ...artifact.sourceRelativePath.split('/'))
      const sourceInfo = await lstat(sourcePath)
      if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
        throw new Error(`Domain native addon source must be a regular file: ${sourcePath}`)
      }
      const sourceReal = await realpath(sourcePath)
      requireContainedPath(packageRootReal, sourceReal, 'Domain native addon source')

      const targetPath = join(outputRoot, ...artifact.bundleRelativePath.split('/'))
      requireContainedPath(outputRoot, targetPath, 'Domain native addon output')
      await mkdir(dirname(targetPath), { recursive: true })
      const targetParentReal = await realpath(dirname(targetPath))
      requireContainedPath(outputRoot, targetParentReal, 'Domain native addon output directory')
      const existingTarget = await lstat(targetPath).catch((error) => {
        if (error?.code === 'ENOENT') return null
        throw error
      })
      if (existingTarget?.isSymbolicLink() || (existingTarget && !existingTarget.isFile())) {
        throw new Error(`Domain native addon output must be a regular file: ${targetPath}`)
      }
      await copyFile(sourceReal, targetPath)
      staged.push(Object.freeze({
        packageName,
        bundleRelativePath: artifact.bundleRelativePath
      }))
    }
  }

  return Object.freeze(staged)
}

function parseDeclaration(value, packageName) {
  if (!isRecord(value) || value.contractVersion !== 1 ||
      !Array.isArray(value.artifacts) || value.artifacts.length < 1 ||
      value.artifacts.length > 16 ||
      Object.keys(value).some((key) => key !== 'contractVersion' && key !== 'artifacts')) {
    throw new Error(`${packageName} ${METADATA_KEY} is invalid.`)
  }
  return Object.freeze({
    artifacts: Object.freeze(value.artifacts.map((artifact, index) =>
      parseArtifact(artifact, `${packageName} ${METADATA_KEY}.artifacts[${index}]`)))
  })
}

function parseArtifact(value, label) {
  if (!isRecord(value) || !Array.isArray(value.platforms) ||
      value.platforms.length < 1 || value.platforms.length > SUPPORTED_PLATFORMS.size ||
      Object.keys(value).some((key) =>
        key !== 'platforms' && key !== 'sourceRelativePath' && key !== 'bundleRelativePath')) {
    throw new Error(`${label} is invalid.`)
  }
  const platforms = value.platforms.map((candidate) => requirePlatform(candidate))
  if (new Set(platforms).size !== platforms.length) {
    throw new Error(`${label}.platforms must be unique.`)
  }
  return Object.freeze({
    platforms: Object.freeze(platforms),
    sourceRelativePath: requireSafeRelativePath(
      value.sourceRelativePath,
      `${label}.sourceRelativePath`
    ),
    bundleRelativePath: requireSafeRelativePath(
      value.bundleRelativePath,
      `${label}.bundleRelativePath`
    )
  })
}

function requireSafeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512 ||
      value.includes('\\') || value.startsWith('/') || value.endsWith('/') ||
      value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${label} must be a canonical package-relative POSIX path.`)
  }
  return value
}

function requireAbsolutePath(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path.`)
  }
  return resolve(value)
}

function requirePlatform(value) {
  if (typeof value !== 'string' || !SUPPORTED_PLATFORMS.has(value)) {
    throw new Error(`Unsupported domain native addon platform: ${String(value)}`)
  }
  return value
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 256) {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value
}

function requireContainedPath(root, candidate, label) {
  const pathFromRoot = relative(root, candidate)
  if (pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..')) return
  throw new Error(`${label} escapes its declared root.`)
}

function parseJsonObject(source, label) {
  let value
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error(`${label} must contain valid JSON.`)
  }
  if (!isRecord(value)) throw new Error(`${label} must contain a JSON object.`)
  return value
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
