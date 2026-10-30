import { createWriteStream } from 'node:fs'
import { access, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  BgcDownloadResourceRequest,
  BgcDownloadResourceResult,
  BgcRegisteredResource,
  BgcRegisterResourceRequest,
  BgcResourceKind,
  BgcResourceRegistry,
  BgcResourceStatusRequest,
  BgcResourceStatusResult
} from './types.js'
import { ensureDir, resolveWorkspacePath } from './workspace-paths.js'

export const DEFAULT_MIBIG_JSON_URL = 'https://dl.secondarymetabolites.org/mibig/mibig_json_4.0_all_jsons.tar.xz'

const REGISTRY_VERSION = 1
const DOWNLOAD_TIMEOUT_MS = 120_000
const MAX_DOWNLOAD_BYTES = 1_000_000_000

export async function resourceStatus(input: BgcResourceStatusRequest): Promise<BgcResourceStatusResult> {
  const workspaceRoot = requiredWorkspace(input.workspaceRoot)
  const registry = await loadResourceRegistry(workspaceRoot)
  const cacheRoot = resolveWorkspacePath(workspaceRoot, input.cacheRoot ?? registry.cacheRoot ?? defaultCacheRoot(workspaceRoot))
  const antismashPath = input.antismashBin ?? registry.resources.antismash?.path
  const bigscapePath = input.bigscapeBin ?? registry.resources.bigscape?.path
  const mibigPath = input.mibigPath ?? registry.resources.mibig_json?.path
  const pfamPath = input.pfamPath ?? registry.resources.pfam_a_hmm?.path

  return {
    ok: true,
    workspaceRoot,
    registryPath: registryPath(workspaceRoot),
    cacheRoot,
    resources: {
      antismash: {
        kind: 'antismash',
        status: await executableStatus(antismashPath, ['antismash']),
        registered: registry.resources.antismash
      },
      bigscape: {
        kind: 'bigscape',
        status: await executableStatus(bigscapePath, ['bigscape']),
        registered: registry.resources.bigscape
      },
      mibig_json: {
        kind: 'mibig_json',
        status: await pathStatus(mibigPath),
        registered: registry.resources.mibig_json
      },
      pfam_a_hmm: {
        kind: 'pfam_a_hmm',
        status: await pathStatus(pfamPath),
        registered: registry.resources.pfam_a_hmm
      }
    },
    installPlans: installPlans()
  }
}

export async function registerResource(input: BgcRegisterResourceRequest): Promise<{
  ok: true
  registryPath: string
  resource: BgcRegisteredResource
}> {
  const workspaceRoot = requiredWorkspace(input.workspaceRoot)
  const registry = await loadResourceRegistry(workspaceRoot)
  const resource: BgcRegisteredResource = {
    kind: input.kind,
    ...(input.path ? { path: resolveDataPath(workspaceRoot, input.path) } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.version ? { version: input.version } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    registeredAt: new Date().toISOString()
  }
  registry.resources[input.kind] = resource
  await saveResourceRegistry(workspaceRoot, registry)
  return { ok: true, registryPath: registryPath(workspaceRoot), resource }
}

export async function downloadResource(input: BgcDownloadResourceRequest): Promise<BgcDownloadResourceResult> {
  const workspaceRoot = requiredWorkspace(input.workspaceRoot)
  const registry = await loadResourceRegistry(workspaceRoot)
  const kind = input.kind ?? 'custom'
  const url = input.url ?? defaultUrlForKind(kind)
  if (!url) throw new Error(`url is required for resource kind ${kind}.`)
  assertHttpsUrl(url)
  const cacheRoot = resolveWorkspacePath(workspaceRoot, input.cacheRoot ?? registry.cacheRoot ?? defaultCacheRoot(workspaceRoot))
  const versionDir = safeSegment(input.version ?? defaultVersionForKind(kind))
  const targetDir = input.targetDir
    ? resolveWorkspacePath(workspaceRoot, input.targetDir)
    : join(cacheRoot, safeSegment(kind), versionDir)
  await ensureDir(targetDir)
  await assertRealPathInsideWorkspace(workspaceRoot, targetDir)
  const fileName = safeFileName(input.fileName ?? basename(new URL(url).pathname) ?? `${kind}.download`)
  const archivePath = join(targetDir, fileName)
  if (!input.overwrite && await exists(archivePath)) {
    throw new Error(`Refusing to overwrite existing download: ${archivePath}`)
  }
  await downloadFile(url, archivePath, Boolean(input.overwrite))
  const shouldExtract = input.extract ?? kind === 'mibig_json'
  const extractedPath = shouldExtract ? await extractArchiveIfSupported(archivePath, targetDir) : undefined
  const resourcePath = preferredResourcePath(kind, targetDir, extractedPath, archivePath)
  const result: BgcDownloadResourceResult = {
    ok: true,
    kind,
    url,
    downloadedPath: archivePath,
    ...(extractedPath ? { extractedPath } : {}),
    resourcePath,
    registered: false
  }
  if (input.register !== false) {
    const registered = await registerResource({
      workspaceRoot,
      kind,
      path: resourcePath,
      url,
      ...(input.version ? { version: input.version } : {}),
      ...(input.notes ? { notes: input.notes } : {})
    })
    result.registered = true
    result.registryPath = registered.registryPath
  }
  return result
}

export async function loadResourceRegistry(workspaceRoot: string): Promise<BgcResourceRegistry> {
  const path = registryPath(workspaceRoot)
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<BgcResourceRegistry>
    return normalizeRegistry(workspaceRoot, parsed)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    return normalizeRegistry(workspaceRoot, {})
  }
}

export async function saveResourceRegistry(workspaceRoot: string, registry: BgcResourceRegistry): Promise<void> {
  const path = registryPath(workspaceRoot)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
}

export function registeredResourcePath(registry: BgcResourceRegistry, kind: BgcResourceKind): string | undefined {
  return registry.resources[kind]?.path
}

export function registryPath(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), 'outputs', 'bgc-discovery', 'resources', 'resource-registry.json')
}

export function defaultCacheRoot(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), 'outputs', 'bgc-discovery', 'resources', 'cache')
}

export function resolveDataPath(workspaceRoot: string, inputPath: string): string {
  return isAbsolute(inputPath) ? resolve(inputPath) : resolveWorkspacePath(workspaceRoot, inputPath)
}

async function downloadFile(url: string, targetPath: string, overwrite: boolean): Promise<void> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`)
  }
  assertHttpsUrl(response.url)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Download exceeds ${MAX_DOWNLOAD_BYTES} bytes: ${url}`)
  }
  await mkdir(dirname(targetPath), { recursive: true })
  let received = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      if (received > MAX_DOWNLOAD_BYTES) {
        callback(new Error(`Download exceeds ${MAX_DOWNLOAD_BYTES} bytes: ${url}`))
        return
      }
      callback(null, chunk)
    }
  })
  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      limiter,
      createWriteStream(targetPath, { flags: overwrite ? 'w' : 'wx' })
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') await rm(targetPath, { force: true })
    throw error
  }
}

async function extractArchiveIfSupported(archivePath: string, targetDir: string): Promise<string | undefined> {
  if (!/\.(tar|tar\.gz|tgz|tar\.xz|txz|zip)$/iu.test(archivePath)) return undefined
  await validateArchiveEntries(archivePath, targetDir)
  await runCommand(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', archivePath, '-C', targetDir], targetDir)
  return targetDir
}

async function validateArchiveEntries(archivePath: string, cwd: string): Promise<void> {
  const tar = process.platform === 'win32' ? 'tar.exe' : 'tar'
  const names = await runCommandCapture(tar, ['-tf', archivePath], cwd)
  for (const rawName of names.split(/\r?\n/)) {
    const name = rawName.trim().replace(/\\/g, '/')
    if (!name) continue
    const segments = name.split('/').filter(Boolean)
    if (name.startsWith('/') || /^[A-Za-z]:\//.test(name) || segments.includes('..')) {
      throw new Error(`Archive entry escapes the extraction directory: ${rawName}`)
    }
  }
  const verbose = await runCommandCapture(tar, ['-tvf', archivePath], cwd)
  for (const line of verbose.split(/\r?\n/)) {
    if (/^[lh]/.test(line)) throw new Error('Archives containing symbolic or hard links are not supported.')
  }
}

function preferredResourcePath(
  kind: BgcResourceKind,
  targetDir: string,
  extractedPath: string | undefined,
  downloadedPath: string
): string {
  if (kind === 'mibig_json' && extractedPath) return join(targetDir, 'complete_v4_data')
  return extractedPath ?? downloadedPath
}

function normalizeRegistry(workspaceRoot: string, value: Partial<BgcResourceRegistry>): BgcResourceRegistry {
  return {
    version: REGISTRY_VERSION,
    workspaceRoot: resolve(workspaceRoot),
    cacheRoot: value.cacheRoot,
    resources: {
      ...(value.resources ?? {})
    }
  }
}

async function executableStatus(configuredPath: string | undefined, commands: string[]): Promise<BgcResourceStatusResult['resources']['antismash']['status']> {
  if (configuredPath) {
    const path = configuredPath
    return await isExecutable(path)
      ? { state: 'available', path }
      : { state: 'missing', path, note: 'Configured executable is not accessible.' }
  }
  for (const command of commands) {
    if (await commandExists(command)) return { state: 'available', path: command }
  }
  return { state: 'not_configured', note: 'No registered path and command was not found on PATH.' }
}

async function pathStatus(path: string | undefined): Promise<BgcResourceStatusResult['resources']['mibig_json']['status']> {
  if (!path) return { state: 'not_configured', note: 'No local path is registered.' }
  return await exists(path)
    ? { state: 'available', path }
    : { state: 'missing', path }
}

function installPlans(): BgcResourceStatusResult['installPlans'] {
  return {
    antismash: [
      'Prefer existing antiSMASH output for reproducibility.',
      'If no output is available, register an existing antiSMASH executable with bgc_register_resource(kind="antismash", path=...).',
      'For new installs, use a user-approved conda/mamba or Docker install outside the SciForge package, then register the executable.'
    ],
    bigscape: [
      'Prefer existing BiG-SCAPE result folders when provided.',
      'If no clustering result exists, register an existing BiG-SCAPE executable with bgc_register_resource(kind="bigscape", path=...).',
      'Download Pfam-A HMM into the BGC cache only when BiG-SCAPE execution is needed.'
    ],
    mibig_json: [
      `Use bgc_download_resource(kind="mibig_json") to download ${DEFAULT_MIBIG_JSON_URL}.`,
      'The MIBiG JSON archive is small and is safe to cache locally.'
    ]
  }
}

function defaultUrlForKind(kind: BgcResourceKind): string | undefined {
  if (kind === 'mibig_json') return DEFAULT_MIBIG_JSON_URL
  return undefined
}

function defaultVersionForKind(kind: BgcResourceKind): string {
  if (kind === 'mibig_json') return '4.0'
  return 'current'
}

function assertHttpsUrl(raw: string): void {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('Only https:// downloads are supported by bgc_download_resource.')
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    try {
      await access(path, constants.R_OK)
      return process.platform === 'win32'
    } catch {
      return false
    }
  }
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolveExists) => {
    const child = spawn(process.platform === 'win32' ? 'where.exe' : 'which', [command], { stdio: 'ignore' })
    child.on('exit', (code) => resolveExists(code === 0))
    child.on('error', () => resolveExists(false))
  })
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 16_384) stderr = stderr.slice(-16_384)
    })
    child.on('exit', (code) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${command} exited with ${code}: ${stderr}`))
    })
    child.on('error', reject)
  })
}

function runCommandCapture(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      if (stdout.length > 4_000_000) child.kill()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 16_384) stderr = stderr.slice(-16_384)
    })
    child.on('exit', (code) => {
      if (code === 0) resolveRun(stdout)
      else reject(new Error(`${command} exited with ${code}: ${stderr}`))
    })
    child.on('error', reject)
  })
}

async function assertRealPathInsideWorkspace(workspaceRoot: string, targetDir: string): Promise<void> {
  const realRoot = await realpath(workspaceRoot)
  const realTarget = await realpath(targetDir)
  resolveWorkspacePath(realRoot, realTarget)
}

function requiredWorkspace(value: string | undefined): string {
  const workspaceRoot = value?.trim()
  if (!workspaceRoot) throw new Error('workspaceRoot is required.')
  return resolve(workspaceRoot)
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'resource'
}

function safeFileName(value: string): string {
  return basename(value).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 180) || 'download'
}
