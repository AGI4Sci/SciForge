import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { dshPluginToolGrantSchema, readDshPluginArtifact } from './dsh-plugin-artifact'
// The CLI remains usable by plain Node; exercise its actual public packer.
// @ts-expect-error The repository packaging CLI is JavaScript without declarations.
import { normalizeDeclaration, packDshPlugin } from '../../../scripts/dsh-plugin-package.mjs'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const identity = { packageName: '@example/chart-tools', entry: 'dist/main.js' }
const declaration = (tags: unknown) => ({
  schemaVersion: 1, packageName: identity.packageName,
  tools: { draw: { id: 'example.draw', effect: 'compute', tags } }
})

it('preserves normalized discovery tags through a real packed artifact and installer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tags-'))
  roots.push(root)
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'dist/main.js'), 'export function apply() {}\n')
  await writeFile(join(root, 'cordis.patch.yml'), '- insert: []\n')
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: identity.packageName, version: '1.0.0', type: 'module',
    exports: { '.': { import: './dist/main.js' } }, dsh: { bundle: { patch: './cordis.patch.yml' } }
  }))
  await writeFile(join(root, 'sciforge.dsh.json'), JSON.stringify(declaration([' plot ', '绘图', 'plot'])))
  const packed = await packDshPlugin({ source: root, output: join(root, 'chart.sciforge-dsh-plugin') })
  const installed = await readDshPluginArtifact(packed.artifact)
  expect(installed.manifest.tools.draw).toEqual({ id: 'example.draw', effect: 'compute', tags: ['plot', '绘图'] })
})

it('rejects reserved, malformed and excessive discovery tags at packaging', () => {
  for (const tags of [['native'], ['DSH-TOOL'], ['managed-mcp'], ['sensitive-input'], ['dsh-workspace-read'], ['dsh-workspace-opener'], ['bad tag'], [''], [42], 'plot', Array.from({ length: 17 }, (_, i) => `tag-${i}`)]) {
    expect(() => normalizeDeclaration(declaration(tags), identity)).toThrow()
  }
  expect(normalizeDeclaration(declaration(Array.from({ length: 16 }, (_, i) => `tag-${i}`)), identity).tools.draw.tags).toHaveLength(16)
})

it('the installer independently accepts legal tags and denies reserved, duplicate or excessive tags', () => {
  const grant = { id: 'example.draw', effect: 'compute' }
  expect(dshPluginToolGrantSchema.safeParse(grant).success).toBe(true)
  expect(dshPluginToolGrantSchema.safeParse({ ...grant, tags: ['绘图', 'chart'] }).success).toBe(true)
  expect(dshPluginToolGrantSchema.safeParse({ ...grant, tags: Array.from({ length: 16 }, (_, i) => `tag-${i}`) }).success).toBe(true)
  for (const tags of [['native'], ['DSH-TOOL'], ['managed-mcp'], ['sensitive-input'], ['dsh-workspace-read'], ['dsh-workspace-opener'], ['chart', 'chart'], [' chart ', 'chart'], ['bad tag'], ['x'.repeat(65)], Array.from({ length: 17 }, (_, i) => `tag-${i}`)]) {
    expect(dshPluginToolGrantSchema.safeParse({ ...grant, tags }).success).toBe(false)
  }
})
