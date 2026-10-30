import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalJson } from './canonical-json'
import {
  DSH_PLUGIN_ARTIFACT_MANIFEST_PATH,
  readDshPluginArtifact,
  readDshPluginArtifactBytes,
  sha256Hex
} from './dsh-plugin-artifact'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function tempRoot(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  roots.push(path)
  return path
}

const PACKAGE = {
  name: '@sciforge/plugin-fixture',
  version: '1.0.0',
  type: 'module',
  exports: { '.': { import: './dist/main.js' } },
  engines: { dsh: '>=0.2.0-rc.2 <0.3.0' },
  dsh: { bundle: { patch: './cordis.patch.yml' } }
}

const PAYLOAD = Object.freeze({
  'package.json': Buffer.from(`${JSON.stringify(PACKAGE, null, 2)}\n`),
  'dist/main.js': Buffer.from('export function apply() {}\n'),
  'cordis.patch.yml': Buffer.from('- insert: []\n')
})

const TOOLS = Object.freeze({
  status: { id: 'fixture.status', effect: 'read' as const },
  render: { id: 'fixture.render', effect: 'workspace-write' as const }
})

function buildManifest(
    overrides: Record<string, unknown> = {},
    payload: Readonly<Record<string, Buffer>> = PAYLOAD
  ) {
  return {
    schemaVersion: 1,
    packageName: PACKAGE.name,
    version: PACKAGE.version,
    entry: 'dist/main.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    engines: { dsh: '>=0.2.0-rc.2 <0.3.0' },
    hostDependencies: ['@deepseek-ai/dsh-tools'],
    tools: TOOLS,
    files: Object.fromEntries(
      Object.entries(payload)
        .map(([path, bytes]) => [path, sha256Hex(bytes)])
        .sort(([left], [right]) => String(left).localeCompare(String(right)))
    ),
    ...overrides
  }
}

async function buildArtifact(options: Readonly<{
  manifest?: Record<string, unknown>
  payload?: Readonly<Record<string, Buffer>>
  extraFiles?: Readonly<Record<string, Buffer>>
  canonicalManifest?: boolean
}> = {}): Promise<Buffer> {
  const payload = options.payload ?? PAYLOAD
  const manifest = options.manifest ?? buildManifest({}, payload)
  const manifestBytes = options.canonicalManifest === false
    ? Buffer.from(JSON.stringify(manifest, null, 2))
    : Buffer.from(canonicalJson(manifest as never))
  const zip = new JSZip()
  for (const [path, bytes] of Object.entries(payload)) zip.file(path, bytes, { date: new Date('2000-01-01T00:00:00.000Z') })
  for (const [path, bytes] of Object.entries(options.extraFiles ?? {})) zip.file(path, bytes, { date: new Date('2000-01-01T00:00:00.000Z') })
  zip.file(DSH_PLUGIN_ARTIFACT_MANIFEST_PATH, manifestBytes, { date: new Date('2000-01-01T00:00:00.000Z') })
  return zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
}

describe('DSH plugin artifact validation', () => {
  it('accepts a well-formed artifact and reports identity, entry and grants', async () => {
    const artifact = await readDshPluginArtifactBytes(await buildArtifact())
    expect(artifact.manifest.packageName).toBe(PACKAGE.name)
    expect(artifact.manifest.entry).toBe('dist/main.js')
    expect(Object.keys(artifact.manifest.tools).sort()).toEqual(['render', 'status'])
    expect([...artifact.files.keys()].sort()).toEqual([
      'META-INF/sciforge-dsh-plugin.json',
      'cordis.patch.yml',
      'dist/main.js',
      'package.json'
    ])
    expect(artifact.artifactSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects a payload byte change as a digest mismatch', async () => {
    // Model a real tamper: the manifest keeps the digests it was published
    // with, while the payload bytes are altered afterwards.
    const tampered: Readonly<Record<string, Buffer>> = {
      ...PAYLOAD,
      'dist/main.js': Buffer.from('export function apply() { /* tampered */ }\n')
    }
    const bytes = await buildArtifact({ payload: tampered, manifest: buildManifest() })
    await expect(readDshPluginArtifactBytes(bytes)).rejects.toThrow(/digest mismatch: dist\/main\.js/)
  })

  it('rejects an artifact whose payload contains an undeclared extra file', async () => {
    const bytes = await buildArtifact({ extraFiles: { 'dist/evil.js': Buffer.from('console.log(1)\n') } })
    await expect(readDshPluginArtifactBytes(bytes)).rejects.toThrow(/file list does not match the payload/)
  })

  it('rejects a manifest that is not canonical JSON', async () => {
    const bytes = await buildArtifact({ canonicalManifest: false })
    await expect(readDshPluginArtifactBytes(bytes)).rejects.toThrow(/canonical JSON/)
  })

  it('rejects a package.json identity that disagrees with the manifest', async () => {
    const payload: Readonly<Record<string, Buffer>> = {
      ...PAYLOAD,
      'package.json': Buffer.from(`${JSON.stringify({ ...PACKAGE, version: '9.9.9' }, null, 2)}\n`)
    }
    const manifest = buildManifest({}, payload)
    const bytes = await buildArtifact({ payload, manifest })
    await expect(readDshPluginArtifactBytes(bytes)).rejects.toThrow(/version 9\.9\.9 does not match manifest version 1\.0\.0/)
  })

  it('rejects an artifact that would run an install-time lifecycle script', async () => {
    const payload: Readonly<Record<string, Buffer>> = {
      ...PAYLOAD,
      'package.json': Buffer.from(`${JSON.stringify({ ...PACKAGE, scripts: { postinstall: 'curl evil' } }, null, 2)}\n`)
    }
    const bytes = await buildArtifact({ payload, manifest: buildManifest({}, payload) })
    await expect(readDshPluginArtifactBytes(bytes)).rejects.toThrow(/forbidden lifecycle script: postinstall/)
  })

  it('rejects a ZIP entry that tries to escape the artifact root', async () => {
    const zip = new JSZip()
    zip.file('../escape.js', Buffer.from('nope\n'), { date: new Date('2000-01-01T00:00:00.000Z') })
    zip.file('package.json', PAYLOAD['package.json'], { date: new Date('2000-01-01T00:00:00.000Z') })
    zip.file('dist/main.js', PAYLOAD['dist/main.js'], { date: new Date('2000-01-01T00:00:00.000Z') })
    zip.file(DSH_PLUGIN_ARTIFACT_MANIFEST_PATH, Buffer.from(canonicalJson(buildManifest() as never)), {
      date: new Date('2000-01-01T00:00:00.000Z')
    })
    const bytes = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
    await expect(readDshPluginArtifactBytes(bytes)).rejects.toThrow(/Unsafe extension artifact path/)
  })

  it('rejects an artifact with no DSH declaration and one with an unknown effect', async () => {
    const noDsh = await buildArtifact({ manifest: buildManifest({ dsh: {} }) })
    await expect(readDshPluginArtifactBytes(noDsh)).rejects.toThrow(/must declare bundle, client or profile/)

    const badEffect = await buildArtifact({
      manifest: buildManifest({ tools: { status: { id: 'fixture.status', effect: 'teleport' } } })
    })
    await expect(readDshPluginArtifactBytes(badEffect)).rejects.toThrow(/invalid/)
  })

  it('reads a directory source as well as archive bytes', async () => {
    const root = await tempRoot('dsh-artifact-dir-')
    for (const [path, bytes] of Object.entries(PAYLOAD)) {
      const target = join(root, ...path.split('/'))
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, bytes)
    }
    const manifestPath = join(root, 'META-INF', 'sciforge-dsh-plugin.json')
    await mkdir(dirname(manifestPath), { recursive: true })
    await writeFile(manifestPath, Buffer.from(canonicalJson(buildManifest() as never)))
    const artifact = await readDshPluginArtifact(root)
    expect(artifact.manifest.packageName).toBe(PACKAGE.name)
    expect(artifact.artifactSha256).toBe('')
    expect(await readFile(join(root, 'dist', 'main.js'), 'utf8')).toContain('apply')
  })
})