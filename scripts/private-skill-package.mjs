#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { constants as fileConstants } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import JSZip from 'jszip'

const RECEIPT_FILE = '.sciforge-private-skill-receipt.json'
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_SKILL_BYTES = 1024 * 1024
const MAX_FILES = 512
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u
const RUNTIME_CREDENTIAL_FILE_NAMES = new Set([
  '.netrc',
  '.npmrc',
  '.pypirc',
  'credentials',
  'credentials.json',
  'id_ed25519',
  'id_rsa',
  'secret.json',
  'secrets.json',
  'token.json',
  'tokens.json'
])

export async function verifyPrivateSkillPackage(options) {
  const loaded = await loadPrivateSkillPackage(options)
  return loaded.summary
}

export async function installPrivateSkillPackage(options) {
  const workspaceRoot = await canonicalRealDirectory(
    resolve(requireString(options?.workspaceRoot, 'workspaceRoot')),
    'Skill workspace'
  )
  const loaded = await loadPrivateSkillPackage(options)
  const skillsRoot = await ensureProjectSkillsRoot(workspaceRoot)
  const target = resolveContainedPath(skillsRoot, loaded.skillName)
  const existing = await installedPackageStatus(target, loaded)
  if (existing) {
    return Object.freeze({
      ...loaded.summary,
      installPath: target,
      receiptPath: join(target, RECEIPT_FILE),
      status: 'already-installed'
    })
  }

  const staging = resolveContainedPath(
    skillsRoot,
    `.sciforge-skill-staging-${randomUUID()}`
  )
  await mkdir(staging, { mode: 0o700 })
  try {
    for (const file of loaded.files) {
      const destination = resolveContainedPath(staging, file.path)
      await ensureContainedDirectory(staging, dirname(destination))
      await writeFile(destination, file.bytes, { flag: 'wx', mode: file.mode })
    }
    const receipt = Object.freeze({
      archiveSha256: loaded.archiveSha256,
      contractVersion: 1,
      files: loaded.files.map(({ bytes: _bytes, mode: _mode, ...file }) => file),
      kind: 'sciforge-private-skill-receipt',
      skillName: loaded.skillName,
      version: loaded.version
    })
    await writeFile(
      join(staging, RECEIPT_FILE),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 }
    )
    await rename(staging, target)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') {
      throw new Error(
        `Skill ${loaded.skillName} already exists with different or unreceipted bytes.`
      )
    }
    throw error
  }
  await verifyInstalledPackage(target, loaded)
  return Object.freeze({
    ...loaded.summary,
    installPath: target,
    receiptPath: join(target, RECEIPT_FILE),
    status: 'installed'
  })
}

async function loadPrivateSkillPackage(options) {
  const archivePath = resolve(requireString(options?.archivePath, 'archivePath'))
  const entry = await lstat(archivePath)
  if (entry.isSymbolicLink() || !entry.isFile() || entry.size < 1 ||
    entry.size > MAX_ARCHIVE_BYTES) {
    throw new Error('Private skill package must be a bounded regular ZIP file.')
  }
  const archiveBytes = await readFile(archivePath)
  const archiveSha256 = sha256(archiveBytes)
  const expectedSha256 = options?.expectedSha256
  if (expectedSha256 !== undefined &&
    (!SHA256_PATTERN.test(expectedSha256) || expectedSha256 !== archiveSha256)) {
    throw new Error('Private skill package SHA-256 does not match the expected digest.')
  }
  const archive = await JSZip.loadAsync(archiveBytes, {
    checkCRC32: true,
    createFolders: false
  })
  const sourceEntries = Object.values(archive.files)
  if (sourceEntries.length < 1 || sourceEntries.length > MAX_FILES * 2) {
    throw new Error('Private skill package entry count is outside the supported bounds.')
  }
  const sourceNames = sourceEntries.map((item) => item.name)
  const prefix = archivePrefix(sourceNames)
  const files = []
  const seen = new Set()
  let totalBytes = 0
  for (const item of sourceEntries) {
    const sourceName = normalizedArchivePath(item.name)
    if (item.name !== (item.unsafeOriginalName ?? item.name) || isSymlink(item)) {
      throw new Error(`Unsafe private skill package entry: ${item.name}`)
    }
    const normalized = prefix ? sourceName.slice(prefix.length) : sourceName
    if (!normalized) continue
    if (item.dir) continue
    const path = safeRelativePath(normalized)
    if (seen.has(path) || path === RECEIPT_FILE) {
      throw new Error(`Duplicate or reserved private skill package entry: ${path}`)
    }
    if (isRuntimeCredentialFile(path)) {
      throw new Error(
        `Private skill package must not contain runtime credentials: ${path}`
      )
    }
    const declaredSize = item?._data?.uncompressedSize
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 ||
      declaredSize > MAX_FILE_BYTES || totalBytes + declaredSize > MAX_UNCOMPRESSED_BYTES) {
      throw new Error(`Private skill package entry exceeds its declared bounds: ${path}`)
    }
    const bytes = await item.async('nodebuffer')
    totalBytes += bytes.byteLength
    if (bytes.byteLength !== declaredSize || bytes.byteLength > MAX_FILE_BYTES ||
      totalBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new Error(`Private skill package entry exceeds its actual bounds: ${path}`)
    }
    const executable = typeof item.unixPermissions === 'number' &&
      (item.unixPermissions & 0o111) !== 0
    files.push(Object.freeze({
      bytes,
      path,
      sha256: sha256(bytes),
      size: bytes.byteLength,
      mode: executable ? 0o700 : 0o600
    }))
    seen.add(path)
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  if (files.length < 1 || files.length > MAX_FILES) {
    throw new Error('Private skill package file count is outside the supported bounds.')
  }
  const skillEntry = files.find((file) => file.path === 'SKILL.md')
  if (!skillEntry || skillEntry.size > MAX_SKILL_BYTES) {
    throw new Error('Private skill package must contain one bounded root SKILL.md.')
  }
  const { name: skillName, version } = parseSkillIdentity(skillEntry.bytes)
  return Object.freeze({
    archiveSha256,
    files: Object.freeze(files),
    skillName,
    version,
    summary: Object.freeze({
      archiveFileName: basename(archivePath),
      archiveSha256,
      contractVersion: 1,
      fileCount: files.length,
      skillName,
      status: 'verified',
      totalBytes,
      version
    })
  })
}

function archivePrefix(names) {
  const normalized = names.map(normalizedArchivePath)
  if (normalized.includes('SKILL.md')) return ''
  const skillEntries = normalized.filter((name) => name.endsWith('/SKILL.md'))
  if (skillEntries.length !== 1) {
    throw new Error('Private skill package must have one unambiguous SKILL.md root.')
  }
  const prefix = skillEntries[0].slice(0, -'SKILL.md'.length)
  if (!normalized.every((name) => name.startsWith(prefix))) {
    throw new Error('Private skill package contains files outside its SKILL.md root.')
  }
  return prefix
}

function normalizedArchivePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') ||
    value.startsWith('/') || /^[A-Za-z]:/u.test(value) || value.includes('\0')) {
    throw new Error(`Unsafe private skill package path: ${String(value)}`)
  }
  const directory = value.endsWith('/')
  const path = directory ? value.slice(0, -1) : value
  safeRelativePath(path)
  return directory ? `${path}/` : path
}

function parseSkillIdentity(bytes) {
  const text = bytes.toString('utf8')
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)
  if (!match) throw new Error('SKILL.md must begin with bounded YAML frontmatter.')
  const fields = new Map()
  for (const line of match[1].split(/\r?\n/u)) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/u)
    if (field) fields.set(field[1], unquote(field[2]))
  }
  const name = fields.get('name')
  const version = fields.get('version')
  if (!SKILL_NAME_PATTERN.test(name ?? '') || !VERSION_PATTERN.test(version ?? '')) {
    throw new Error('SKILL.md must declare a safe name and version.')
  }
  return Object.freeze({ name, version })
}

async function installedPackageStatus(target, loaded) {
  try {
    const entry = await lstat(target)
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`Skill install target is not a real directory: ${target}`)
    }
    await verifyInstalledPackage(target, loaded)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function verifyInstalledPackage(target, loaded) {
  await assertPathWithoutSymlinks(dirname(target), target)
  let receipt
  try {
    receipt = JSON.parse(await readFile(join(target, RECEIPT_FILE), 'utf8'))
  } catch (error) {
    throw new Error(`Installed skill ${loaded.skillName} has no valid SciForge receipt.`, {
      cause: error
    })
  }
  if (!isRecord(receipt) || receipt.kind !== 'sciforge-private-skill-receipt' ||
    receipt.contractVersion !== 1 || receipt.skillName !== loaded.skillName ||
    receipt.version !== loaded.version || receipt.archiveSha256 !== loaded.archiveSha256 ||
    !Array.isArray(receipt.files) || receipt.files.length !== loaded.files.length) {
    throw new Error(`Installed skill ${loaded.skillName} receipt does not match the archive.`)
  }
  for (const expected of loaded.files) {
    const file = resolveContainedPath(target, expected.path)
    await assertPathWithoutSymlinks(target, file)
    const handle = await open(file, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW)
    try {
      const entry = await handle.stat()
      if (!entry.isFile() || entry.size !== expected.size ||
        sha256(await handle.readFile()) !== expected.sha256) {
        throw new Error(`Installed skill file changed: ${expected.path}`)
      }
    } finally {
      await handle.close()
    }
  }
}

async function ensureProjectSkillsRoot(workspaceRoot) {
  const codexRoot = resolveContainedPath(workspaceRoot, '.codex')
  const skillsRoot = resolveContainedPath(workspaceRoot, '.codex/skills')
  await ensureContainedDirectory(workspaceRoot, codexRoot)
  await ensureContainedDirectory(workspaceRoot, skillsRoot)
  if (process.platform !== 'win32') {
    await chmod(codexRoot, 0o700)
    await chmod(skillsRoot, 0o700)
  }
  return skillsRoot
}

async function ensureContainedDirectory(root, directory) {
  const requestedRelation = relative(root, directory)
  if (!requestedRelation) return
  const target = resolveContainedPath(root, requestedRelation.split(sep).join('/'))
  const relation = relative(root, target)
  let current = root
  for (const segment of relation.split(sep)) {
    current = join(current, segment)
    try {
      const entry = await lstat(current)
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(`Private skill install parent is unsafe: ${current}`)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await mkdir(current, { mode: 0o700 })
    }
  }
}

async function assertPathWithoutSymlinks(root, target) {
  const relation = relative(root, target)
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)) {
    throw new Error('Private skill install path escapes its root.')
  }
  let current = root
  for (const segment of relation.split(sep)) {
    current = join(current, segment)
    const entry = await lstat(current)
    if (entry.isSymbolicLink()) {
      throw new Error(`Private skill install path contains a symbolic link: ${current}`)
    }
  }
}

async function canonicalRealDirectory(path, label) {
  const entry = await lstat(path)
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`)
  }
  return realpath(path)
}

function resolveContainedPath(root, relativePath) {
  const normalized = safeRelativePath(relativePath)
  const target = resolve(root, ...normalized.split('/'))
  const relation = relative(root, target)
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)) {
    throw new Error('Private skill package path escapes its root.')
  }
  return target
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') ||
    isAbsolute(value) || value.split('/').some((part) =>
      !part || part === '.' || part === '..'
    )) {
    throw new Error('Private skill package path must be a safe relative slash path.')
  }
  return value
}

function isRuntimeCredentialFile(path) {
  const name = basename(path).toLowerCase()
  return name === '.env' || (name.startsWith('.env.') && name !== '.env.example') ||
    RUNTIME_CREDENTIAL_FILE_NAMES.has(name) ||
    ['.key', '.p12', '.pfx'].some((extension) => name.endsWith(extension))
}

function isSymlink(entry) {
  return typeof entry.unixPermissions === 'number' &&
    (entry.unixPermissions & 0o170000) === 0o120000
}

function unquote(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Private skill package ${label} is required.`)
  }
  return value.trim()
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseCli(argv) {
  const [command, ...remaining] = argv
  if (!['verify', 'install'].includes(command)) {
    throw new Error(
      'Usage: node scripts/private-skill-package.mjs verify|install ' +
      '--archive /absolute/path/to/skill.zip [--workspace /absolute/workspace] ' +
      '[--expected-sha256 digest]'
    )
  }
  const flags = new Map()
  for (let index = 0; index < remaining.length; index += 1) {
    const flag = remaining[index]
    if (!['--archive', '--workspace', '--expected-sha256'].includes(flag) || flags.has(flag)) {
      throw new Error(`Unknown or duplicate private skill option: ${flag}`)
    }
    const value = remaining[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
    flags.set(flag, value)
    index += 1
  }
  if (!flags.has('--archive')) throw new Error('--archive is required.')
  if (command === 'install' && !flags.has('--workspace')) {
    throw new Error('--workspace is required for installation.')
  }
  return Object.freeze({
    command,
    archivePath: resolve(flags.get('--archive')),
    ...(flags.has('--workspace')
      ? { workspaceRoot: resolve(flags.get('--workspace')) }
      : {}),
    ...(flags.has('--expected-sha256')
      ? { expectedSha256: flags.get('--expected-sha256') }
      : {})
  })
}

async function main(argv) {
  const options = parseCli(argv)
  const result = options.command === 'verify'
    ? await verifyPrivateSkillPackage(options)
    : await installPrivateSkillPackage(options)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `[private-skill-package] ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  })
}
