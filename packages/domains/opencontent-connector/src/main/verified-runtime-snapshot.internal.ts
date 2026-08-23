import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

import type {
  OpenContentSkillRuntimeFileIntegrity,
  OpenContentSkillRuntimeFileRole
} from './bundled-assets.js'

const TRUSTED_RUNTIME_FILE_ROLES = Object.freeze<readonly OpenContentSkillRuntimeFileRole[]>([
  'cli-entrypoint',
  'docflow-entrypoint',
  'docflow-probe-helper',
  'package-manifest',
  'cli-single-attempt-patch'
])

export type VerifiedOpenContentRuntimeSnapshot = Readonly<{
  files: readonly Readonly<{
    bytes: Buffer
    integrity: OpenContentSkillRuntimeFileIntegrity
  }>[]
}>

export class OpenContentRuntimeSnapshotIntegrityError extends Error {
  constructor() {
    super('The pinned OpenContent runtime snapshot integrity check failed.')
    this.name = 'OpenContentRuntimeSnapshotIntegrityError'
  }
}

export async function readVerifiedOpenContentRuntimeSnapshot(input: Readonly<{
  root: string
  trustedRuntimeFiles: readonly OpenContentSkillRuntimeFileIntegrity[]
}>): Promise<VerifiedOpenContentRuntimeSnapshot> {
  if (!isAbsolute(input.root) ||
    input.trustedRuntimeFiles.length !== TRUSTED_RUNTIME_FILE_ROLES.length) {
    throw new OpenContentRuntimeSnapshotIntegrityError()
  }
  const roles = new Set<OpenContentSkillRuntimeFileRole>()
  const paths = new Set<string>()
  try {
    const files = await Promise.all(input.trustedRuntimeFiles.map(async (integrity) => {
      const path = resolve(input.root, ...integrity.relativePath.split('/'))
      const relativePath = relative(input.root, path)
      if (!TRUSTED_RUNTIME_FILE_ROLES.includes(integrity.role) ||
        roles.has(integrity.role) || paths.has(integrity.relativePath) ||
        relativePath.startsWith('..') || isAbsolute(relativePath) ||
        !/^[a-f0-9]{64}$/u.test(integrity.sha256) ||
        !Number.isSafeInteger(integrity.size) || integrity.size < 1) {
        throw new OpenContentRuntimeSnapshotIntegrityError()
      }
      roles.add(integrity.role)
      paths.add(integrity.relativePath)
      const bytes = await readFile(path)
      if (bytes.byteLength !== integrity.size ||
        createHash('sha256').update(bytes).digest('hex') !== integrity.sha256) {
        throw new OpenContentRuntimeSnapshotIntegrityError()
      }
      return Object.freeze({ bytes, integrity: Object.freeze({ ...integrity }) })
    }))
    if (roles.size !== TRUSTED_RUNTIME_FILE_ROLES.length) {
      throw new OpenContentRuntimeSnapshotIntegrityError()
    }
    return Object.freeze({ files: Object.freeze(files) })
  } catch {
    throw new OpenContentRuntimeSnapshotIntegrityError()
  }
}

export async function materializeVerifiedOpenContentRuntimeSnapshot(input: Readonly<{
  destinationRoot: string
  snapshot: VerifiedOpenContentRuntimeSnapshot
  cliEntrypointBytes?: Uint8Array
}>): Promise<Readonly<{ root: string; entrypoint: string }>> {
  if (!isAbsolute(input.destinationRoot)) {
    throw new OpenContentRuntimeSnapshotIntegrityError()
  }
  const root = resolve(input.destinationRoot)
  await mkdir(root, { recursive: true, mode: 0o700 })
  let entrypoint = ''
  for (const file of input.snapshot.files) {
    const target = resolve(root, ...file.integrity.relativePath.split('/'))
    const relativePath = relative(root, target)
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new OpenContentRuntimeSnapshotIntegrityError()
    }
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    const isCliEntrypoint = file.integrity.role === 'cli-entrypoint'
    await writeFile(
      target,
      isCliEntrypoint && input.cliEntrypointBytes !== undefined
        ? input.cliEntrypointBytes
        : file.bytes,
      { flag: 'wx', mode: isCliEntrypoint ? 0o500 : 0o400 }
    )
    if (isCliEntrypoint) entrypoint = target
  }
  if (entrypoint === '') throw new OpenContentRuntimeSnapshotIntegrityError()
  return Object.freeze({ root, entrypoint })
}

export function verifiedOpenContentRuntimeFile(
  snapshot: VerifiedOpenContentRuntimeSnapshot,
  role: OpenContentSkillRuntimeFileRole
): Buffer {
  const file = snapshot.files.find((candidate) => candidate.integrity.role === role)
  if (!file) throw new OpenContentRuntimeSnapshotIntegrityError()
  return file.bytes
}
