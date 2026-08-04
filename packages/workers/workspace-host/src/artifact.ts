import { createHash } from 'node:crypto'
import {
  access,
  chmod,
  constants,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat
} from 'node:fs/promises'
import { dirname, posix, resolve } from 'node:path'

import {
  WORKSPACE_HOST_PROTOCOL_VERSION,
  workspaceHostArtifactManifestSchema,
  type WorkspaceHostArtifact,
  type WorkspaceHostArtifactManifest,
  type WorkspaceHostContributionCohort
} from '@sciforge/domain-sdk/workspace-host'

import { WORKSPACE_HOST_SERVER_VERSION } from './service.js'

export const WORKSPACE_HOST_ARTIFACT_SCHEMA_VERSION = 1 as const
export const WORKSPACE_HOST_ARTIFACT_PLATFORM = 'linux' as const
export const WORKSPACE_HOST_ARTIFACT_ARCH = 'x64' as const
export const WORKSPACE_HOST_ARTIFACT_ENTRYPOINT = 'workspace-host' as const
export const WORKSPACE_HOST_ARTIFACT_SERVER_MODULE = 'server.mjs' as const
export const WORKSPACE_HOST_ARTIFACT_NODE_EXECUTABLE = 'runtime/node' as const
export const WORKSPACE_HOST_ARTIFACT_NODE_LICENSE = 'runtime/LICENSE' as const
export const WORKSPACE_HOST_ARTIFACT_MANIFEST_NAME = 'manifest.json' as const
export const WORKSPACE_HOST_ARTIFACT_RUNTIME = 'bundled-node@22.18.0' as const
export const WORKSPACE_HOST_NODE_PACKAGE_VERSION = '22.18.0' as const
export const WORKSPACE_HOST_NODE_VERSION_OUTPUT = 'v22.18.0' as const
export const WORKSPACE_HOST_CODEX_PACKAGE_NAME = '@openai/codex' as const
export const WORKSPACE_HOST_CODEX_PACKAGE_VERSION = '0.146.0-linux-x64' as const
export const WORKSPACE_HOST_CODEX_VERSION = '0.146.0' as const
export const WORKSPACE_HOST_CODEX_TARBALL_URL =
  'https://registry.npmjs.org/@openai/codex/-/codex-0.146.0-linux-x64.tgz' as const
export const WORKSPACE_HOST_CODEX_TARBALL_INTEGRITY =
  'sha512-fswvyGprAPCMiOEue/7MKMk7pCjh9kZIJfJX5i9atmfnmGYbYCcUhZsEH9LEP0+0t5xyPqDbfNXY7NSxIVuXxA==' as const
export const WORKSPACE_HOST_CODEX_LICENSE_URL =
  'https://raw.githubusercontent.com/openai/codex/rust-v0.146.0/LICENSE' as const
export const WORKSPACE_HOST_CODEX_LICENSE_INTEGRITY =
  'sha512-EEbwJ5AHPoxrCd8tPMwzi4s9kMK+bv3R1MWTV8cizlKmwC6WicD/CAwvS9mDEGehCnR5Xs15SrsOf9RWs0LI1g==' as const
export const WORKSPACE_HOST_CODEX_COHORT_DIRECTORY = 'codex' as const
export const WORKSPACE_HOST_CODEX_EXECUTABLE = 'codex/bin/codex' as const
export const WORKSPACE_HOST_CODEX_LICENSE = 'codex/LICENSE' as const
export const WORKSPACE_HOST_CODEX_VERSION_OUTPUT = 'codex-cli 0.146.0' as const

const WORKSPACE_HOST_CODEX_VENDOR_COHORT =
  'vendor/x86_64-unknown-linux-musl' as const
const WORKSPACE_HOST_CODEX_PACKAGE_METADATA = [
  'package.json',
  'README.md'
] as const

export { workspaceHostArtifactManifestSchema }
export type { WorkspaceHostArtifact, WorkspaceHostArtifactManifest }

export type WorkspaceHostArtifactInputFile = Readonly<{
  path: string
  executable: boolean
}>

export type WorkspaceHostArtifactReadinessProbe = Readonly<{
  id: string
  executablePath: string
  arguments: readonly string[]
  expectedStdout: string
}>

export async function stageWorkspaceHostNodeRuntime(
  packageDirectory: string,
  artifactDirectory: string
): Promise<readonly WorkspaceHostArtifactInputFile[]> {
  const packageRoot = resolve(packageDirectory)
  const packageManifest = JSON.parse(
    await readFile(resolve(packageRoot, 'package.json'), 'utf8')
  ) as Record<string, unknown>
  if (
    packageManifest.name !== 'node-linux-x64'
    || packageManifest.version !== `v${WORKSPACE_HOST_NODE_PACKAGE_VERSION}`
  ) {
    throw new Error(
      `Workspace Host requires node-linux-x64 ${WORKSPACE_HOST_NODE_PACKAGE_VERSION}.`
    )
  }
  const nodeSource = resolve(packageRoot, 'bin/node')
  await assertLinuxX64Elf(nodeSource)
  const files = await Promise.all([
    copyArtifactFile(
      nodeSource,
      artifactDirectory,
      WORKSPACE_HOST_ARTIFACT_NODE_EXECUTABLE
    ),
    copyArtifactFile(
      resolve(packageRoot, 'LICENSE'),
      artifactDirectory,
      WORKSPACE_HOST_ARTIFACT_NODE_LICENSE
    )
  ])
  if (!files[0]?.executable) {
    throw new Error('Bundled Workspace Host Node runtime is not executable.')
  }
  return Object.freeze(files)
}

export function resolveWorkspaceHostArtifactDirectory(baseDirectory: string): string {
  return resolve(
    baseDirectory,
    'workspace-host',
    WORKSPACE_HOST_SERVER_VERSION,
    `${WORKSPACE_HOST_ARTIFACT_PLATFORM}-${WORKSPACE_HOST_ARTIFACT_ARCH}`
  )
}

export function resolveWorkspaceHostBundledCodexExecutable(
  artifactDirectory: string
): string {
  return resolve(artifactDirectory, WORKSPACE_HOST_CODEX_EXECUTABLE)
}

export async function requireWorkspaceHostBundledCodexExecutable(
  artifactDirectory: string
): Promise<string> {
  const executable = resolveWorkspaceHostBundledCodexExecutable(artifactDirectory)
  await access(executable, constants.X_OK).catch((cause) => {
    throw new Error(
      `Bundled Codex executable is unavailable or not executable: ` +
      `${WORKSPACE_HOST_CODEX_EXECUTABLE}.`,
      { cause }
    )
  })
  return executable
}

export async function readWorkspaceHostArtifactManifest(
  directory: string
): Promise<WorkspaceHostArtifactManifest> {
  const content = await readFile(
    resolve(directory, WORKSPACE_HOST_ARTIFACT_MANIFEST_NAME),
    'utf8'
  )
  return workspaceHostArtifactManifestSchema.parse(JSON.parse(content))
}

export async function buildWorkspaceHostArtifactManifest(
  directory: string,
  options: Readonly<{
    files?: readonly WorkspaceHostArtifactInputFile[]
    contributions?: readonly WorkspaceHostContributionCohort[]
    readinessProbes?: readonly WorkspaceHostArtifactReadinessProbe[]
  }> = {}
): Promise<WorkspaceHostArtifactManifest> {
  const inputFiles = options.files ?? [{
    path: WORKSPACE_HOST_ARTIFACT_ENTRYPOINT,
    executable: true
  }]
  const files = await Promise.all(inputFiles.map(async (file) => {
    assertArtifactRelativePath(file.path)
    const absolutePath = resolve(directory, file.path)
    const [content, fileStat] = await Promise.all([
      readFile(absolutePath),
      stat(absolutePath)
    ])
    if (!fileStat.isFile()) {
      throw new Error(`Workspace Host artifact entry is not a file: ${file.path}`)
    }
    if (file.executable) {
      await access(absolutePath, constants.X_OK).catch((cause) => {
        throw new Error(
          `Workspace Host artifact executable is not runnable: ${file.path}`,
          { cause }
        )
      })
    }
    return {
      path: file.path,
      sha256: createHash('sha256').update(content).digest('hex'),
      sizeBytes: fileStat.size,
      executable: file.executable
    }
  }))
  return workspaceHostArtifactManifestSchema.parse({
    schemaVersion: WORKSPACE_HOST_ARTIFACT_SCHEMA_VERSION,
    protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
    serverVersion: WORKSPACE_HOST_SERVER_VERSION,
    platform: WORKSPACE_HOST_ARTIFACT_PLATFORM,
    arch: WORKSPACE_HOST_ARTIFACT_ARCH,
    runtime: WORKSPACE_HOST_ARTIFACT_RUNTIME,
    entrypoint: WORKSPACE_HOST_ARTIFACT_ENTRYPOINT,
    files,
    readinessProbes: options.readinessProbes ?? [],
    contributions: options.contributions ?? []
  })
}

/**
 * Copies the complete fixed official Codex Linux x64 cohort into the
 * Workspace Host artifact. The target layout is package-owned and stable:
 * the upstream target cohort is flattened to `codex/`, so the server always
 * starts the absolute `codex/bin/codex` path.
 */
export async function stageWorkspaceHostCodexCohort(
  packageDirectory: string,
  licensePath: string,
  artifactDirectory: string
): Promise<readonly WorkspaceHostArtifactInputFile[]> {
  const packageRoot = resolve(packageDirectory)
  const packageManifest = JSON.parse(
    await readFile(resolve(packageRoot, 'package.json'), 'utf8')
  ) as Record<string, unknown>
  if (
    packageManifest.name !== WORKSPACE_HOST_CODEX_PACKAGE_NAME
    || packageManifest.version !== WORKSPACE_HOST_CODEX_PACKAGE_VERSION
    || packageManifest.license !== 'Apache-2.0'
  ) {
    throw new Error(
      `Workspace Host requires ${WORKSPACE_HOST_CODEX_PACKAGE_NAME} ` +
      `at ${WORKSPACE_HOST_CODEX_PACKAGE_VERSION} with Apache-2.0 metadata.`
    )
  }

  const targetRoot = resolve(artifactDirectory, WORKSPACE_HOST_CODEX_COHORT_DIRECTORY)
  await rm(targetRoot, { recursive: true, force: true })
  await mkdir(targetRoot, { recursive: true, mode: 0o700 })

  const staged: WorkspaceHostArtifactInputFile[] = []
  for (const metadataPath of WORKSPACE_HOST_CODEX_PACKAGE_METADATA) {
    const sourcePath = resolve(packageRoot, metadataPath)
    const artifactPath = posix.join(
      WORKSPACE_HOST_CODEX_COHORT_DIRECTORY,
      metadataPath
    )
    staged.push(await copyArtifactFile(sourcePath, artifactDirectory, artifactPath))
  }
  staged.push(await copyArtifactFile(
    licensePath,
    artifactDirectory,
    WORKSPACE_HOST_CODEX_LICENSE
  ))

  const vendorRoot = resolve(packageRoot, WORKSPACE_HOST_CODEX_VENDOR_COHORT)
  const cohortFiles = await collectRegularFiles(vendorRoot)
  if (cohortFiles.length === 0) {
    throw new Error('The official Codex Linux x64 vendor cohort is empty.')
  }
  for (const relativePath of cohortFiles) {
    staged.push(await copyArtifactFile(
      resolve(vendorRoot, relativePath),
      artifactDirectory,
      posix.join(WORKSPACE_HOST_CODEX_COHORT_DIRECTORY, relativePath)
    ))
  }

  const codex = staged.find((file) =>
    file.path === WORKSPACE_HOST_CODEX_EXECUTABLE
  )
  if (!codex?.executable) {
    throw new Error(
      `The official Codex cohort does not contain executable ${WORKSPACE_HOST_CODEX_EXECUTABLE}.`
    )
  }
  return Object.freeze(staged.sort((left, right) =>
    left.path.localeCompare(right.path)
  ))
}

export async function verifyWorkspaceHostArtifact(
  descriptor: WorkspaceHostArtifact
): Promise<void> {
  const manifest = workspaceHostArtifactManifestSchema.parse(descriptor.manifest)
  for (const file of manifest.files) {
    assertArtifactRelativePath(file.path)
    const content = await readFile(resolve(descriptor.directory, file.path))
    if (content.byteLength !== file.sizeBytes) {
      throw new Error(`Workspace Host artifact size mismatch: ${file.path}`)
    }
    const digest = createHash('sha256').update(content).digest('hex')
    if (digest !== file.sha256) {
      throw new Error(`Workspace Host artifact digest mismatch: ${file.path}`)
    }
    if (file.executable) {
      await access(resolve(descriptor.directory, file.path), constants.X_OK)
        .catch((cause) => {
          throw new Error(
            `Workspace Host artifact executable is not runnable: ${file.path}`,
            { cause }
          )
        })
    }
  }
}

async function collectRegularFiles(directory: string): Promise<string[]> {
  const collected: string[] = []
  const visit = async (relativeDirectory: string): Promise<void> => {
    const absoluteDirectory = resolve(directory, relativeDirectory)
    const entries = await readdir(absoluteDirectory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? posix.join(relativeDirectory, entry.name)
        : entry.name
      if (entry.isDirectory()) {
        await visit(relativePath)
        continue
      }
      if (!entry.isFile()) {
        throw new Error(
          `The official Codex cohort contains unsupported entry ${relativePath}.`
        )
      }
      collected.push(relativePath)
    }
  }
  await visit('')
  return collected
}

async function copyArtifactFile(
  sourcePath: string,
  artifactDirectory: string,
  artifactPath: string
): Promise<WorkspaceHostArtifactInputFile> {
  assertArtifactRelativePath(artifactPath)
  const sourceInfo = await lstat(sourcePath)
  if (!sourceInfo.isFile()) {
    throw new Error(`Workspace Host artifact source is not a file: ${artifactPath}`)
  }
  const destinationPath = resolve(artifactDirectory, artifactPath)
  await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 })
  await copyFile(sourcePath, destinationPath)
  const executable = (sourceInfo.mode & 0o111) !== 0
  await chmod(destinationPath, executable ? 0o700 : 0o600)
  return { path: artifactPath, executable }
}

async function assertLinuxX64Elf(path: string): Promise<void> {
  const content = await readFile(path)
  if (
    content.byteLength < 64
    || content[0] !== 0x7f
    || content[1] !== 0x45
    || content[2] !== 0x4c
    || content[3] !== 0x46
    || content[4] !== 2
    || content[5] !== 1
    || content.readUInt16LE(18) !== 0x3e
  ) {
    throw new Error('Bundled Workspace Host Node runtime is not a Linux x64 ELF executable.')
  }
}

function assertArtifactRelativePath(path: string): void {
  if (
    !path
    || path.includes('\0')
    || path.startsWith('/')
    || path.includes('\\')
    || path.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new Error(`Invalid Workspace Host artifact path: ${path}`)
  }
}
