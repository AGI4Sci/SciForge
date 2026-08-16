#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const ALWAYS_PUBLISHED = new Set([
  'package.json',
  'sciforge.domain.json',
  'README',
  'README.md',
  'LICENSE',
  'LICENSE.md',
  'LICENCE',
  'LICENCE.md'
])

export function auditPublishablePackageVersions(root, baseRef) {
  if (typeof baseRef !== 'string' || baseRef.trim() === '') {
    throw new Error('A non-empty base Git ref is required.')
  }
  git(root, ['rev-parse', '--verify', `${baseRef}^{commit}`])
  const changedPaths = new Set(lines(git(root, [
    'diff', '--name-only', '--diff-filter=ACMRTUXB', baseRef, '--', 'packages'
  ])))
  for (const untracked of lines(git(root, [
    'ls-files', '--others', '--exclude-standard', '--', 'packages'
  ]))) changedPaths.add(untracked)

  const findings = []
  const checkedPackages = []
  for (const packageJsonPath of findPackageJsonFiles(path.join(root, 'packages'))) {
    const packageRoot = path.dirname(packageJsonPath)
    const packageRelative = posix(path.relative(root, packageRoot))
    const packageJsonRelative = `${packageRelative}/package.json`
    const currentPackage = readJson(packageJsonPath)
    if (currentPackage.private === true) continue

    const manifestPath = path.join(packageRoot, 'sciforge.domain.json')
    if (existsSync(manifestPath)) {
      const manifest = readJson(manifestPath)
      if (manifest.packageName !== currentPackage.name) {
        findings.push(`${packageRelative}: manifest packageName must equal package.json name.`)
      }
      if (manifest.module?.version !== currentPackage.version) {
        findings.push(
          `${packageRelative}: manifest module.version ${String(manifest.module?.version)} must equal package.json version ${String(currentPackage.version)}.`
        )
      }
    }

    const changedPublishedPaths = [...changedPaths]
      .filter((changedPath) => changedPath === packageRelative || changedPath.startsWith(`${packageRelative}/`))
      .filter((changedPath) => isPublishedPath(
        changedPath.slice(packageRelative.length + 1),
        currentPackage.files
      ))
      .sort()
    if (changedPublishedPaths.length === 0) continue

    const basePackage = readGitJson(root, baseRef, packageJsonRelative)
    const currentVersion = parseStableVersion(currentPackage.version, `${packageRelative}/package.json`)
    if (basePackage !== null) {
      const baseVersion = parseStableVersion(basePackage.version, `${baseRef}:${packageJsonRelative}`)
      if (compareVersions(currentVersion, baseVersion) <= 0) {
        findings.push(
          `${packageRelative}: published content changed but version ${currentPackage.version} does not advance ${basePackage.version}.`
        )
      }
    }
    checkedPackages.push({
      name: currentPackage.name,
      path: packageRelative,
      previousVersion: basePackage?.version ?? null,
      version: currentPackage.version,
      changedPublishedPaths
    })
  }

  return Object.freeze({
    baseRef,
    checkedPackages: Object.freeze(checkedPackages),
    findings: Object.freeze(findings)
  })
}

function findPackageJsonFiles(root) {
  if (!existsSync(root)) return []
  const result = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'artifacts') continue
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(target)
      else if (entry.isFile() && entry.name === 'package.json') result.push(target)
    }
  }
  return result.sort()
}

function isPublishedPath(relativePath, files) {
  if (ALWAYS_PUBLISHED.has(relativePath)) return true
  if (!Array.isArray(files) || files.length === 0) return true
  return files.some((entry) => {
    if (typeof entry !== 'string') return false
    const normalized = entry.replace(/^\.\//, '').replace(/\/$/, '')
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`)
  })
}

function parseStableVersion(value, label) {
  if (typeof value !== 'string' || !STABLE_SEMVER.test(value)) {
    throw new Error(`${label} version must be stable semantic version x.y.z.`)
  }
  return value.split('.').map(Number)
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return Math.sign(left[index] - right[index])
  }
  return 0
}

function readGitJson(root, ref, relativePath) {
  const result = spawnSync('git', ['show', `${ref}:${relativePath}`], {
    cwd: root,
    encoding: 'utf8'
  })
  if (result.status !== 0) return null
  return JSON.parse(result.stdout)
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed.`)
  }
  return result.stdout
}

function lines(value) {
  return value.split(/\r?\n/).filter(Boolean)
}

function posix(value) {
  return value.split(path.sep).join('/')
}

function parseArgs(argv) {
  const args = { baseRef: null, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base') args.baseRef = argv[++index] ?? null
    else if (argv[index] === '--json') args.json = true
    else throw new Error(`Unknown argument: ${argv[index]}`)
  }
  if (args.baseRef === null) throw new Error('Usage: publishable-package-version-audit.mjs --base <git-ref> [--json]')
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const result = auditPublishablePackageVersions(root, args.baseRef)
  if (args.json) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(`publishable package version audit: ${result.checkedPackages.length} changed package(s)`)
    for (const pkg of result.checkedPackages) {
      console.log(`  ${pkg.name}: ${pkg.previousVersion ?? 'new'} -> ${pkg.version}`)
    }
    console.log(result.findings.length === 0 ? 'findings: none' : `findings:\n${result.findings.map((finding) => `  - ${finding}`).join('\n')}`)
  }
  if (result.findings.length > 0) process.exitCode = 2
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
