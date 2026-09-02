#!/usr/bin/env node

import { execFile as execFileCallback, spawn } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFile = promisify(execFileCallback)
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Keep the public boundary self-contained. The marker fragments are assembled
// at runtime so this guard does not itself re-introduce private feature names.
const RESTRICTED_MARKERS = Object.freeze([
  ['collab', 'oration'].join(''),
  ['content', '-', 'space'].join(''),
  ['open', 'content'].join(''),
  ['project', '-', 'coordinator'].join(''),
  ['zul', 'ip'].join(''),
  ['key', 'cloak'].join(''),
  ['identity', '.', 'cloud'].join(''),
  ['cloud', ' identity'].join(''),
  ['oid', 'c'].join(''),
  ['remote', '-', 'approval'].join('')
])
const SOURCE_EXTENSIONS = /\.(?:cjs|js|mjs|ts|tsx|json|ya?ml|env)$/u

export function parseArchitecturePrinciplesOptions(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return Object.freeze({ mode: 'full' })
  }
  if (argv.length === 1 && argv[0] === '--changed-path-only') {
    return Object.freeze({ mode: 'changed-path-only' })
  }
  throw new Error(`Unknown architecture gate option: ${argv[0]}`)
}

export function auditChangedProductionSources(entries) {
  const findings = []
  for (const entry of entries) {
    const sourcePath = String(entry?.path ?? '').replaceAll('\\', '/')
    const source = typeof entry?.source === 'string' ? entry.source : ''
    if (!isProductionSourcePath(sourcePath)) continue
    if (sourcePath.startsWith('packages/domains/') && hasHostPrivateImport(source)) {
      findings.push(`${sourcePath}: domain package imports a Host-private source path`)
    }
    if (isHostProductionPath(sourcePath) && !isGeneratedCompositionPath(sourcePath) &&
      hasDirectDomainReference(source)) {
      findings.push(`${sourcePath}: Host contains a domain-specific import or identifier`)
    }
  }
  return Object.freeze(findings.sort())
}

export function assertDomainPackageIdentity(packageJson, manifest, sourcePath) {
  if (!packageJson || !manifest || packageJson.name !== manifest.packageName) {
    throw new Error(`${sourcePath}: package and domain manifest names differ.`)
  }
  if (packageJson.version !== manifest.module?.version) {
    throw new Error(`${sourcePath}: backend/UI package and module versions differ.`)
  }
  if (!Array.isArray(manifest.entrypoints) || manifest.entrypoints.length === 0) {
    throw new Error(`${sourcePath}: domain package has no explicit process entrypoint.`)
  }
  const processes = new Set()
  for (const entrypoint of manifest.entrypoints) {
    if (!entrypoint || !['main', 'renderer', 'workspace-server'].includes(entrypoint.process) ||
      typeof entrypoint.export !== 'string' || !entrypoint.export.startsWith('./')) {
      throw new Error(`${sourcePath}: domain package entrypoint is invalid.`)
    }
    if (processes.has(entrypoint.process)) {
      throw new Error(`${sourcePath}: domain package has duplicate ${entrypoint.process} entrypoints.`)
    }
    processes.add(entrypoint.process)
  }
}

/**
 * Scan the checked-out public tree for private feature paths and payloads.
 * Documentation and historical proposal material are intentionally outside the
 * release boundary; executable source, manifests, tests, and CI are checked.
 */
export async function auditRepositoryArchitecture(repositoryRoot = REPOSITORY_ROOT) {
  const root = resolve(repositoryRoot)
  const paths = await trackedAndUntrackedPaths(root)
  const entries = []
  const findings = []
  for (const sourcePath of paths) {
    if (!isBoundaryPath(sourcePath)) continue
    if (containsRestrictedMarker(sourcePath)) {
      findings.push(`${sourcePath}: restricted feature path`)
      continue
    }
    const absolutePath = resolve(root, sourcePath)
    if (!await pathExists(absolutePath)) continue
    let source
    try {
      source = await readFile(absolutePath, 'utf8')
    } catch {
      continue
    }
    entries.push({ path: sourcePath, source })
    if (containsRestrictedMarker(source)) {
      findings.push(`${sourcePath}: restricted feature marker`)
    }
  }

  findings.push(...auditChangedProductionSources(entries))
  findings.push(...await auditDomainPackageManifests(root))
  if (findings.length > 0) {
    throw new Error(`Public architecture audit failed:\n${[...new Set(findings)].sort().join('\n')}`)
  }
  return Object.freeze({
    checkedPathCount: paths.length,
    checkedSourceCount: entries.length,
    domainPackageCount: await countDomainPackages(root),
    findings: Object.freeze([])
  })
}

async function auditDomainPackageManifests(root) {
  const findings = []
  const domainsRoot = resolve(root, 'packages/domains')
  let directories
  try {
    directories = await readdir(domainsRoot, { withFileTypes: true })
  } catch {
    return findings
  }
  for (const directory of directories) {
    if (!directory.isDirectory()) continue
    const packagePath = `packages/domains/${directory.name}`
    try {
      const packageJson = JSON.parse(await readFile(
        resolve(root, packagePath, 'package.json'), 'utf8'
      ))
      const manifest = JSON.parse(await readFile(
        resolve(root, packagePath, 'sciforge.domain.json'), 'utf8'
      ))
      assertDomainPackageIdentity(packageJson, manifest, packagePath)
    } catch (error) {
      findings.push(error instanceof Error ? error.message : String(error))
    }
  }
  return findings
}

async function countDomainPackages(root) {
  try {
    return (await readdir(resolve(root, 'packages/domains'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).length
  } catch {
    return 0
  }
}

async function trackedAndUntrackedPaths(root) {
  const { stdout } = await execFile(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' }
  )
  return [...new Set(stdout.split('\n').map((value) => value.trim()).filter(Boolean))]
}

function isBoundaryPath(sourcePath) {
  const normalized = sourcePath.replaceAll('\\', '/')
  if (normalized === 'package-lock.json') return false
  if (normalized.startsWith('docs/') || normalized.startsWith('openspec/') ||
    normalized.startsWith('tmp/') || normalized.startsWith('node_modules/') ||
    normalized.startsWith('.git/')) return false
  return SOURCE_EXTENSIONS.test(normalized) || normalized.startsWith('.github/') ||
    normalized.startsWith('deployments/')
}

function containsRestrictedMarker(value) {
  const normalized = String(value).toLocaleLowerCase()
  return RESTRICTED_MARKERS.some((marker) => normalized.includes(marker))
}

function isProductionSourcePath(sourcePath) {
  return /^(?:packages|src)\//u.test(sourcePath) &&
    /\.(?:cjs|js|mjs|ts|tsx)$/u.test(sourcePath) &&
    !/\.(?:integration\.)?test\.[^.]+$/u.test(sourcePath) &&
    !sourcePath.includes('/test-helpers.') &&
    !sourcePath.includes('/test-fixtures/') &&
    !sourcePath.includes('/__fixtures__/')
}

function isHostProductionPath(sourcePath) {
  return /^(?:src\/main|src\/renderer|src\/shared)\//u.test(sourcePath)
}

function isGeneratedCompositionPath(sourcePath) {
  return new Set([
    'src/shared/installed-domain-packages.ts',
    'src/main/modules/installed-domain-main.ts',
    'src/main/modules/installed-main-source-packages.ts',
    'src/main/modules/installed-domain-runtime-mcp.ts',
    'src/renderer/src/domain-modules/installed-domain-renderer.ts'
  ]).has(sourcePath)
}

function hasHostPrivateImport(source) {
  return /(?:from\s*|import\s*\()\s*['"][^'"]*(?:@shared|@renderer|@main|\/src\/(?:main|renderer|shared))(?:\/|['"])/u
    .test(source)
}

function hasDirectDomainReference(source) {
  return /@sciforge\/domain-(?!sdk(?:\/|['"]))[a-z0-9-]+/u.test(source)
}

async function runFormalGate() {
  const report = await auditRepositoryArchitecture(REPOSITORY_ROOT)
  await runCommand('node', ['scripts/domain-packages.mjs', '--check'])
  await runCommand('npm', ['run', 'capability:check'])
  process.stdout.write(`${JSON.stringify({ status: 'passed', ...report }, null, 2)}\n`)
}

async function runCommand(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: REPOSITORY_ROOT,
      env: process.env,
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolvePromise()
      else reject(new Error(
        `${command} ${args.join(' ')} exited with code ${code ?? 'null'} and signal ${signal ?? 'none'}.`
      ))
    })
  })
}

async function pathExists(sourcePath) {
  try {
    await access(sourcePath)
    return true
  } catch {
    return false
  }
}

async function main(argv) {
  const options = parseArchitecturePrinciplesOptions(argv)
  if (options.mode === 'full') {
    await runFormalGate()
    return
  }
  const report = await auditRepositoryArchitecture(REPOSITORY_ROOT)
  process.stdout.write(`${JSON.stringify({ status: 'passed', ...report }, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`[architecture-principles] ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
