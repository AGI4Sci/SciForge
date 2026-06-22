import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { buildScientificSkillsIndex } from './scientific-skills-index'

export const KDENSE_SCIENTIFIC_SKILLS_SOURCE = 'K-Dense-AI/scientific-agent-skills'
export const KDENSE_SCIENTIFIC_SKILLS_REPO = `https://github.com/${KDENSE_SCIENTIFIC_SKILLS_SOURCE}.git`
export const SCIENTIFIC_SKILLS_INSTALLER_VERSION = 1
export const SCIENTIFIC_SKILLS_PROVENANCE_FILE = '.sciforge-provenance.json'

export type ScientificSkillsInstallBackend = 'git' | 'npx'

export type ScientificSkillsInstallRequest = {
  workspaceRoot: string
  backend?: ScientificSkillsInstallBackend
  ref?: string
}

export type ScientificSkillsInstallStatus =
  | 'installed'
  | 'already_installed'
  | 'invalid_workspace'
  | 'invalid_existing_target'
  | 'clone_failed'
  | 'verification_failed'
  | 'npx_failed'
  | 'not_discovered_after_npx'
  | 'unexpected_error'

export type ScientificSkillsInstallResult =
  | {
      ok: true
      status: Extract<ScientificSkillsInstallStatus, 'installed' | 'already_installed'>
      backend: ScientificSkillsInstallBackend
      targetPath: string
      commit?: string
      provenancePath?: string
      stdoutTail?: string
      stderrTail?: string
    }
  | {
      ok: false
      status: Exclude<ScientificSkillsInstallStatus, 'installed' | 'already_installed'>
      backend?: ScientificSkillsInstallBackend
      targetPath?: string
      message: string
      stdoutTail?: string
      stderrTail?: string
    }

type SpawnCapture = {
  code: number | null
  stdout: string
  stderr: string
}

type SpawnCommand = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number }
) => Promise<SpawnCapture>

export type ScientificSkillsInstallOptions = {
  spawnCommand?: SpawnCommand
  now?: () => Date
  tempSuffix?: () => string
}

type Provenance = {
  source: string
  backend: ScientificSkillsInstallBackend
  ref: string
  commit?: string
  installedAt: string
  targetPath: string
  installerVersion: number
}

const INSTALL_TIMEOUT_MS = 180_000
const COMMAND_TAIL_BYTES = 8_000

export function resolveScientificSkillsWorkspaceInstallTarget(workspaceRoot: string): string {
  const inputRoot = workspaceRoot.trim()
  if (!inputRoot) {
    throw new Error('Workspace root is required.')
  }
  const root = resolve(inputRoot)
  if (!root || root === '.') {
    throw new Error('Workspace root is required.')
  }
  const target = resolve(root, '.agents', 'skills', 'scientific-agent-skills')
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error('Resolved install target escapes the workspace root.')
  }
  return target
}

export async function isValidScientificSkillsInstallRoot(root: string): Promise<boolean> {
  const skillsRoot = join(root, 'skills')
  if (!existsSync(skillsRoot)) return false
  try {
    const entries = await readdir(skillsRoot, { withFileTypes: true })
    return entries.some((entry) => {
      if (!entry.isDirectory()) return false
      return existsSync(join(skillsRoot, entry.name, 'SKILL.md'))
    })
  } catch {
    return false
  }
}

export async function installScientificSkills(
  request: ScientificSkillsInstallRequest,
  options: ScientificSkillsInstallOptions = {}
): Promise<ScientificSkillsInstallResult> {
  const backend = request.backend ?? 'git'
  const ref = normalizeRef(request.ref)
  let targetPath: string
  try {
    targetPath = resolveScientificSkillsWorkspaceInstallTarget(request.workspaceRoot)
  } catch (error) {
    return {
      ok: false,
      status: 'invalid_workspace',
      backend,
      message: error instanceof Error ? error.message : String(error)
    }
  }

  try {
    if (existsSync(targetPath)) {
      if (await isValidScientificSkillsInstallRoot(targetPath)) {
        return {
          ok: true,
          status: 'already_installed',
          backend,
          targetPath,
          commit: await readInstalledCommit(targetPath),
          provenancePath: existingProvenancePath(targetPath)
        }
      }
      return {
        ok: false,
        status: 'invalid_existing_target',
        backend,
        targetPath,
        message: `Target path exists but does not look like ${KDENSE_SCIENTIFIC_SKILLS_SOURCE}: ${targetPath}. Repair requires moving or removing that directory first.`
      }
    }

    if (backend === 'npx') {
      return installWithNpx(request.workspaceRoot, targetPath, ref, options)
    }
    return installWithGit(request.workspaceRoot, targetPath, ref, options)
  } catch (error) {
    return {
      ok: false,
      status: 'unexpected_error',
      backend,
      targetPath,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function installWithGit(
  workspaceRoot: string,
  targetPath: string,
  ref: string,
  options: ScientificSkillsInstallOptions
): Promise<ScientificSkillsInstallResult> {
  const spawnCommand = options.spawnCommand ?? spawnCommandDefault
  const parent = dirname(targetPath)
  const stagingPath = join(parent, `.sciforge-install-scientific-agent-skills-${safeTempSuffix(options)}`)
  await mkdir(parent, { recursive: true })
  await rm(stagingPath, { recursive: true, force: true })

  const clone = await spawnCommand('git', [
    'clone',
    '--depth',
    '1',
    '--branch',
    ref,
    KDENSE_SCIENTIFIC_SKILLS_REPO,
    stagingPath
  ], { cwd: workspaceRoot, timeoutMs: INSTALL_TIMEOUT_MS })

  if (clone.code !== 0) {
    await rm(stagingPath, { recursive: true, force: true })
    return {
      ok: false,
      status: 'clone_failed',
      backend: 'git',
      targetPath,
      message: `Failed to clone ${KDENSE_SCIENTIFIC_SKILLS_SOURCE}.`,
      stdoutTail: tailText(clone.stdout),
      stderrTail: tailText(clone.stderr)
    }
  }

  if (!await isValidScientificSkillsInstallRoot(stagingPath)) {
    await rm(stagingPath, { recursive: true, force: true })
    return {
      ok: false,
      status: 'verification_failed',
      backend: 'git',
      targetPath,
      message: `Cloned repository is missing skills/*/SKILL.md under ${stagingPath}.`,
      stdoutTail: tailText(clone.stdout),
      stderrTail: tailText(clone.stderr)
    }
  }

  const commit = await readGitCommit(stagingPath, spawnCommand)
  const provenancePath = join(stagingPath, SCIENTIFIC_SKILLS_PROVENANCE_FILE)
  await writeProvenance(provenancePath, {
    source: KDENSE_SCIENTIFIC_SKILLS_SOURCE,
    backend: 'git',
    ref,
    ...(commit ? { commit } : {}),
    installedAt: (options.now ?? (() => new Date()))().toISOString(),
    targetPath,
    installerVersion: SCIENTIFIC_SKILLS_INSTALLER_VERSION
  })
  await rename(stagingPath, targetPath)

  return {
    ok: true,
    status: 'installed',
    backend: 'git',
    targetPath,
    ...(commit ? { commit } : {}),
    provenancePath: join(targetPath, SCIENTIFIC_SKILLS_PROVENANCE_FILE),
    stdoutTail: tailText(clone.stdout),
    stderrTail: tailText(clone.stderr)
  }
}

async function installWithNpx(
  workspaceRoot: string,
  targetPath: string,
  ref: string,
  options: ScientificSkillsInstallOptions
): Promise<ScientificSkillsInstallResult> {
  const spawnCommand = options.spawnCommand ?? spawnCommandDefault
  const run = await spawnCommand('npx', [
    '--yes',
    'skills',
    'add',
    KDENSE_SCIENTIFIC_SKILLS_SOURCE
  ], { cwd: workspaceRoot, timeoutMs: INSTALL_TIMEOUT_MS })

  if (run.code !== 0) {
    return {
      ok: false,
      status: 'npx_failed',
      backend: 'npx',
      targetPath,
      message: `npx skills add failed for ${KDENSE_SCIENTIFIC_SKILLS_SOURCE}.`,
      stdoutTail: tailText(run.stdout),
      stderrTail: tailText(run.stderr)
    }
  }

  const index = await buildScientificSkillsIndex({ workspaceRoot })
  if (!index.installed) {
    return {
      ok: false,
      status: 'not_discovered_after_npx',
      backend: 'npx',
      targetPath,
      message: `npx completed, but SciForge did not discover ${KDENSE_SCIENTIFIC_SKILLS_SOURCE} in configured local paths.`,
      stdoutTail: tailText(run.stdout),
      stderrTail: tailText(run.stderr)
    }
  }

  const discoveredTarget = discoveredInstallTarget(
    index.roots.filter((root) => root.skillCount > 0).map((root) => root.path)
  ) ?? targetPath
  const commit = existsSync(join(discoveredTarget, '.git'))
    ? await readGitCommit(discoveredTarget, spawnCommand)
    : undefined
  const provenancePath = await maybeWriteNpxProvenance(discoveredTarget, {
    source: KDENSE_SCIENTIFIC_SKILLS_SOURCE,
    backend: 'npx',
    ref,
    ...(commit ? { commit } : {}),
    installedAt: (options.now ?? (() => new Date()))().toISOString(),
    targetPath: discoveredTarget,
    installerVersion: SCIENTIFIC_SKILLS_INSTALLER_VERSION
  })

  return {
    ok: true,
    status: 'installed',
    backend: 'npx',
    targetPath: discoveredTarget,
    ...(commit ? { commit } : {}),
    ...(provenancePath ? { provenancePath } : {}),
    stdoutTail: tailText(run.stdout),
    stderrTail: tailText(run.stderr)
  }
}

async function readGitCommit(root: string, spawnCommand: SpawnCommand): Promise<string | undefined> {
  const result = await spawnCommand('git', ['-C', root, 'rev-parse', 'HEAD'], {
    cwd: root,
    timeoutMs: 20_000
  })
  if (result.code !== 0) return undefined
  const commit = result.stdout.trim().split(/\s+/)[0]
  return /^[0-9a-f]{7,40}$/i.test(commit) ? commit : undefined
}

async function readInstalledCommit(targetPath: string): Promise<string | undefined> {
  const provenancePath = join(targetPath, SCIENTIFIC_SKILLS_PROVENANCE_FILE)
  try {
    const parsed = JSON.parse(await readFile(provenancePath, 'utf8')) as { commit?: unknown }
    return typeof parsed.commit === 'string' ? parsed.commit : undefined
  } catch {
    return undefined
  }
}

function existingProvenancePath(targetPath: string): string | undefined {
  const provenancePath = join(targetPath, SCIENTIFIC_SKILLS_PROVENANCE_FILE)
  return existsSync(provenancePath) ? provenancePath : undefined
}

async function maybeWriteNpxProvenance(targetPath: string, provenance: Provenance): Promise<string | undefined> {
  if (!await isValidScientificSkillsInstallRoot(targetPath)) return undefined
  const provenancePath = join(targetPath, SCIENTIFIC_SKILLS_PROVENANCE_FILE)
  await writeProvenance(provenancePath, provenance)
  return provenancePath
}

async function writeProvenance(path: string, provenance: Provenance): Promise<void> {
  await writeFile(path, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8')
}

function discoveredInstallTarget(rootPaths: string[]): string | undefined {
  for (const rootPath of rootPaths) {
    if (!rootPath || !existsSync(rootPath)) continue
    if (basename(rootPath) === 'skills') return dirname(rootPath)
    return rootPath
  }
  return undefined
}

function normalizeRef(ref: string | undefined): string {
  const value = (ref ?? 'main').trim()
  return value || 'main'
}

function safeTempSuffix(options: ScientificSkillsInstallOptions): string {
  const suffix = options.tempSuffix?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return suffix.replace(/[^a-zA-Z0-9._-]/g, '-')
}

function tailText(text: string): string | undefined {
  if (!text) return undefined
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= COMMAND_TAIL_BYTES) return text
  return buffer.subarray(buffer.length - COMMAND_TAIL_BYTES).toString('utf8')
}

function spawnCommandDefault(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number }
): Promise<SpawnCapture> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let finished = false
    const timer = setTimeout(() => {
      if (finished) return
      child.kill('SIGTERM')
    }, options.timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolveResult({ code: 1, stdout, stderr: `${stderr}${error.message}` })
    })
    child.on('close', (code) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolveResult({ code, stdout, stderr })
    })
  })
}
