import { createHash, sign, type KeyObject } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { canonicalJson, type CanonicalJsonValue } from './canonical-json'
import {
  EXTENSION_INTEGRITY_PATH,
  EXTENSION_SIGNATURE_PATH
} from './types'

export type TestArtifactOptions = Readonly<{
  privateKey: KeyObject
  keyId?: string
  packageName?: string
  moduleId?: string
  version?: string
  publisherId?: string
  publisherDisplayName?: string
  hostMinimum?: string
  hostMaximumExclusive?: string
  packageScripts?: Record<string, string>
}>

export function createSignedTestArtifact(
  options: TestArtifactOptions
): Map<string, Buffer> {
  const packageName = options.packageName ?? '@sciforge/domain-test-extension'
  const moduleId = options.moduleId ?? 'sciforge.test-extension'
  const version = options.version ?? '1.0.0'
  const publisherId = options.publisherId ?? 'sciforge'
  const manifest = {
    contractVersion: 1,
    kind: 'sandboxed-runtime',
    packageName,
    publisher: {
      id: publisherId,
      displayName: options.publisherDisplayName ?? 'SciForge'
    },
    module: {
      id: moduleId,
      displayName: 'Test Extension',
      version,
      hostApi: {
        minimum: options.hostMinimum ?? '1.0.0',
        maximumExclusive: options.hostMaximumExclusive ?? '2.0.0'
      },
      priority: 100
    },
    requestedPermissions: [{
      id: 'workspace.files.read',
      process: 'main',
      reason: 'Read explicitly selected workspace files.',
      required: true
    }],
    contributionContracts: {},
    entrypoints: [{
      process: 'main',
      isolation: 'extension-host',
      entry: 'dist/main.mjs',
      format: 'module',
      contributions: [{
        id: 'test-extension.capabilities',
        kind: 'main.capability-factory',
        priority: 100
      }]
    }]
  }
  const packageManifest = {
    name: packageName,
    version,
    type: 'module',
    ...(options.packageScripts ? { scripts: options.packageScripts } : {})
  }
  const files = new Map<string, Buffer>([
    ['dist/main.mjs', Buffer.from('export default Object.freeze({ activate() {} })\n')],
    ['package.json', Buffer.from(JSON.stringify(packageManifest, null, 2))],
    ['sciforge.domain.json', Buffer.from(JSON.stringify(manifest, null, 2))]
  ])
  const digestEntries = [...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, bytes]) => [path, sha256(bytes)])
  const integrity = {
    schemaVersion: 1,
    packageName,
    version,
    publisherId,
    files: Object.fromEntries(digestEntries)
  }
  const integrityBytes = Buffer.from(canonicalJson(integrity as CanonicalJsonValue))
  const signatureBytes = sign(null, integrityBytes, options.privateKey)
  files.set(EXTENSION_INTEGRITY_PATH, integrityBytes)
  files.set(EXTENSION_SIGNATURE_PATH, Buffer.from(JSON.stringify({
    schemaVersion: 1,
    algorithm: 'ed25519',
    keyId: options.keyId ?? 'official-test-key',
    signature: signatureBytes.toString('base64')
  })))
  return files
}

export async function writeArtifactDirectory(
  rootPath: string,
  files: ReadonlyMap<string, Buffer>
): Promise<void> {
  await mkdir(rootPath, { recursive: true })
  for (const [path, bytes] of files) {
    const targetPath = join(rootPath, ...path.split('/'))
    await mkdir(join(targetPath, '..'), { recursive: true })
    await writeFile(targetPath, bytes)
  }
}

export async function zipArtifact(files: ReadonlyMap<string, Buffer>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [path, bytes] of files) zip.file(path, bytes)
  return zip.generateAsync({
    type: 'nodebuffer',
    platform: 'UNIX',
    compression: 'DEFLATE'
  })
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
