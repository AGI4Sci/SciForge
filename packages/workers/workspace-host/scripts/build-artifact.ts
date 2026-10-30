import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

import { build } from 'esbuild'

import {
  WORKSPACE_HOST_ARTIFACT_ENTRYPOINT,
  WORKSPACE_HOST_ARTIFACT_MANIFEST_NAME,
  WORKSPACE_HOST_ARTIFACT_NODE_EXECUTABLE,
  WORKSPACE_HOST_ARTIFACT_SERVER_MODULE,
  WORKSPACE_HOST_CODEX_EXECUTABLE,
  WORKSPACE_HOST_CODEX_LICENSE_INTEGRITY,
  WORKSPACE_HOST_CODEX_LICENSE_URL,
  WORKSPACE_HOST_CODEX_PACKAGE_VERSION,
  WORKSPACE_HOST_CODEX_VERSION_OUTPUT,
  WORKSPACE_HOST_NODE_PACKAGE_VERSION,
  WORKSPACE_HOST_NODE_VERSION_OUTPUT,
  buildWorkspaceHostArtifactManifest,
  resolveWorkspaceHostArtifactDirectory,
  stageWorkspaceHostCodexCohort,
  stageWorkspaceHostNodeRuntime,
  type WorkspaceHostArtifactInputFile
} from '../src/artifact.js'
import { createWorkspaceHostDomainComposition } from '../src/composition.js'

const execFileAsync = promisify(execFile)
const NODE_PACKAGE = Object.freeze({
  cacheKey: `node-linux-x64-${WORKSPACE_HOST_NODE_PACKAGE_VERSION}`,
  url: `https://registry.npmjs.org/node-linux-x64/-/node-linux-x64-${WORKSPACE_HOST_NODE_PACKAGE_VERSION}.tgz`,
  integrity: 'sha512-ZPIlJmsQkDY/Q+VeDIuNTphYIPHYwV4T2lF7lfkmW0gFFkohycbGQYm25yhJ/Gz42eFD2wF5zwAzs9yPRAwbhg=='
})
const CODEX_PACKAGE = Object.freeze({
  cacheKey: `openai-codex-${WORKSPACE_HOST_CODEX_PACKAGE_VERSION}`,
  url: `https://registry.npmjs.org/@openai/codex/-/codex-${WORKSPACE_HOST_CODEX_PACKAGE_VERSION}.tgz`,
  integrity: 'sha512-fswvyGprAPCMiOEue/7MKMk7pCjh9kZIJfJX5i9atmfnmGYbYCcUhZsEH9LEP0+0t5xyPqDbfNXY7NSxIVuXxA=='
})
const CODEX_LICENSE = Object.freeze({
  cacheKey: `openai-codex-license-${WORKSPACE_HOST_CODEX_PACKAGE_VERSION}`,
  fileName: 'LICENSE',
  url: WORKSPACE_HOST_CODEX_LICENSE_URL,
  integrity: WORKSPACE_HOST_CODEX_LICENSE_INTEGRITY
})

const baseDirectory = outputBase(process.argv)
const outputDirectory = resolveWorkspaceHostArtifactDirectory(baseDirectory)
const cacheDirectory = resolve(
  import.meta.dirname,
  '../../../../.cache/workspace-host-artifact'
)
await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true, mode: 0o700 })

const serverModulePath = resolve(
  outputDirectory,
  WORKSPACE_HOST_ARTIFACT_SERVER_MODULE
)
await build({
  entryPoints: [resolve(import.meta.dirname, '../src/cli.ts')],
  outfile: serverModulePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'bundle',
  sourcemap: false,
  minify: false,
  legalComments: 'none'
})
await chmod(serverModulePath, 0o600)

const wrapperPath = resolve(outputDirectory, WORKSPACE_HOST_ARTIFACT_ENTRYPOINT)
await writeFile(wrapperPath, workspaceHostWrapper(), {
  encoding: 'utf8',
  mode: 0o700
})
await chmod(wrapperPath, 0o700)

const [nodePackageDirectory, codexPackageDirectory, codexLicensePath] = await Promise.all([
  prepareFixedPackage(cacheDirectory, NODE_PACKAGE),
  prepareFixedPackage(cacheDirectory, CODEX_PACKAGE),
  prepareFixedFile(cacheDirectory, CODEX_LICENSE)
])
const [nodeFiles, codexFiles] = await Promise.all([
  stageWorkspaceHostNodeRuntime(nodePackageDirectory, outputDirectory),
  stageWorkspaceHostCodexCohort(
    codexPackageDirectory,
    codexLicensePath,
    outputDirectory
  )
])
const files: WorkspaceHostArtifactInputFile[] = [
  { path: WORKSPACE_HOST_ARTIFACT_ENTRYPOINT, executable: true },
  { path: WORKSPACE_HOST_ARTIFACT_SERVER_MODULE, executable: false },
  ...nodeFiles,
  ...codexFiles
]

const composition = createWorkspaceHostDomainComposition({
  log: () => undefined
})
try {
  const manifest = await buildWorkspaceHostArtifactManifest(
    outputDirectory,
    {
      files,
      contributions: composition.cohorts,
      readinessProbes: [{
        id: 'node',
        executablePath: WORKSPACE_HOST_ARTIFACT_NODE_EXECUTABLE,
        arguments: ['--version'],
        expectedStdout: WORKSPACE_HOST_NODE_VERSION_OUTPUT
      }, {
        id: 'codex',
        executablePath: WORKSPACE_HOST_CODEX_EXECUTABLE,
        arguments: ['--version'],
        expectedStdout: WORKSPACE_HOST_CODEX_VERSION_OUTPUT
      }]
    }
  )
  await writeFile(
    resolve(outputDirectory, WORKSPACE_HOST_ARTIFACT_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 }
  )
  process.stdout.write(`${outputDirectory}\n`)
} finally {
  composition.dispose()
}

function outputBase(argv: readonly string[]): string {
  const index = argv.indexOf('--output-base')
  const value = index < 0 ? undefined : argv[index + 1]
  return resolve(value ?? resolve(import.meta.dirname, '../artifacts'))
}

function workspaceHostWrapper(): string {
  return [
    '#!/bin/sh',
    'set -eu',
    'artifact_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'exec "$artifact_dir/runtime/node" "$artifact_dir/server.mjs" "$@"',
    ''
  ].join('\n')
}

async function prepareFixedPackage(
  cacheRoot: string,
  descriptor: Readonly<{
    cacheKey: string
    url: string
    integrity: string
  }>
): Promise<string> {
  const packageCache = resolve(cacheRoot, descriptor.cacheKey)
  const archivePath = resolve(packageCache, 'package.tgz')
  const extractedRoot = resolve(packageCache, 'extracted')
  const packageDirectory = resolve(extractedRoot, 'package')
  await mkdir(packageCache, { recursive: true, mode: 0o700 })

  const cachedArchive = await readFile(archivePath).catch(() => undefined)
  if (!cachedArchive || !matchesIntegrity(cachedArchive, descriptor.integrity)) {
    assertArtifactDownloadAllowed()
    const response = await fetch(descriptor.url, { redirect: 'follow' })
    if (!response.ok) {
      throw new Error(
        `Unable to download fixed Workspace Host artifact package: HTTP ${response.status}.`
      )
    }
    const downloaded = Buffer.from(await response.arrayBuffer())
    if (!matchesIntegrity(downloaded, descriptor.integrity)) {
      throw new Error('Fixed Workspace Host artifact package integrity check failed.')
    }
    const temporaryArchive = resolve(
      packageCache,
      `package-${process.pid}-${randomUUID()}.tgz`
    )
    await writeFile(temporaryArchive, downloaded, { mode: 0o600 })
    await rename(temporaryArchive, archivePath)
  }

  const temporaryExtractedRoot = resolve(
    packageCache,
    `extracted-${process.pid}-${randomUUID()}`
  )
  await mkdir(temporaryExtractedRoot, { recursive: true, mode: 0o700 })
  try {
    await execFileAsync('tar', [
      '-xzf',
      archivePath,
      '-C',
      temporaryExtractedRoot
    ])
    if (!(await isDirectory(resolve(temporaryExtractedRoot, 'package')))) {
      throw new Error('Fixed Workspace Host artifact package has no package directory.')
    }
    await rm(extractedRoot, { recursive: true, force: true })
    await rename(temporaryExtractedRoot, extractedRoot)
  } catch (error) {
    await rm(temporaryExtractedRoot, { recursive: true, force: true })
    throw error
  }
  return packageDirectory
}

async function prepareFixedFile(
  cacheRoot: string,
  descriptor: Readonly<{
    cacheKey: string
    fileName: string
    url: string
    integrity: string
  }>
): Promise<string> {
  const fileCache = resolve(cacheRoot, descriptor.cacheKey)
  const filePath = resolve(fileCache, descriptor.fileName)
  await mkdir(fileCache, { recursive: true, mode: 0o700 })
  const cached = await readFile(filePath).catch(() => undefined)
  if (cached && matchesIntegrity(cached, descriptor.integrity)) return filePath

  assertArtifactDownloadAllowed()
  const response = await fetch(descriptor.url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(
      `Unable to download fixed Workspace Host artifact file: HTTP ${response.status}.`
    )
  }
  const downloaded = Buffer.from(await response.arrayBuffer())
  if (!matchesIntegrity(downloaded, descriptor.integrity)) {
    throw new Error('Fixed Workspace Host artifact file integrity check failed.')
  }
  const temporaryPath = resolve(
    fileCache,
    `${descriptor.fileName}-${process.pid}-${randomUUID()}.tmp`
  )
  await writeFile(temporaryPath, downloaded, { mode: 0o600 })
  await rename(temporaryPath, filePath)
  return filePath
}

function matchesIntegrity(content: Buffer, integrity: string): boolean {
  const [algorithm, expected] = integrity.split('-', 2)
  if (algorithm !== 'sha512' || !expected) return false
  return createHash('sha512').update(content).digest('base64') === expected
}

function assertArtifactDownloadAllowed(): void {
  if (process.env.SCIFORGE_WORKSPACE_HOST_ARTIFACT_OFFLINE !== '1') return
  throw new Error(
    'Fixed Workspace Host artifact cache is incomplete while offline mode is enabled.'
  )
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then((value) => value.isDirectory(), () => false)
}
