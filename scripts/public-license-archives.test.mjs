import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile, readdir, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { discoverDomainPackages, isLicenseOnlyDomainArchive } from './domain-packages.mjs'

const root = resolve(import.meta.dirname, '..')
// Audited original published license bytes at ba00016cd864127102e9736e8acfb942050bfc80.
// Static digests keep this safety check valid in shallow checkouts and source archives.
const licenseSHA256 = {
  'plugins/evidence-dag': 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  'plugins/project-dag': 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  'plugins/git-checkpoints': 'b5c2a30f74cfdea30026edcfd190052c466436dd6b6fd22dcf9a1da5b904095c',
  'plugins/research-checkpoints': 'b5c2a30f74cfdea30026edcfd190052c466436dd6b6fd22dcf9a1da5b904095c',
  'packages/domains/content-space': 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  'packages/domains/content-space-mock-provider': 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'
}

test('only nonempty regular license-text-only directories are archives', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'public-license-archive-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.equal(await isLicenseOnlyDomainArchive(dir), false, 'empty remains strict')
  await writeFile(join(dir, 'LICENSE'), 'Synthetic license text')
  await writeFile(join(dir, 'NOTICE.md'), 'Synthetic attribution text')
  assert.equal(await isLicenseOnlyDomainArchive(dir), true)
  for (const name of ['package.json', 'sciforge.domain.json', 'runtime.ts', '.hidden.ts', 'README.md', 'unknown.txt']) {
    await writeFile(join(dir, name), '{}')
    assert.equal(await isLicenseOnlyDomainArchive(dir), false, name)
    await rm(join(dir, name))
  }
  await mkdir(join(dir, 'src'))
  assert.equal(await isLicenseOnlyDomainArchive(dir), false, 'subdirectories remain strict')
  await rm(join(dir, 'src'), { recursive: true })
  await symlink(join(dir, 'LICENSE'), join(dir, 'COPYING'))
  assert.equal(await isLicenseOnlyDomainArchive(dir), false, 'symlink license is not an archive')
})

test('discovery ignores license archives but fails incomplete runtime packages', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'public-domain-discovery-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const archived = join(dir, 'packages/domains/archive')
  await mkdir(archived, { recursive: true })
  await writeFile(join(archived, 'LICENSE'), 'Synthetic license text')
  assert.deepEqual(await discoverDomainPackages(dir, { parseDefinition: x => x }), [])
  await writeFile(join(archived, 'package.json'), '{}')
  await assert.rejects(discoverDomainPackages(dir, { parseDefinition: x => x }), /missing sciforge.domain.json/)
})

test('retired independent runtimes are absent while original licenses and six canonical domains remain', async () => {
  const retired = ['evidence-dag', 'project-dag', 'git-checkpoints', 'research-checkpoints']
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.workspaces.filter(x => x.startsWith('plugins/')), [
    'plugins/anchored-comments', 'plugins/change-inspector', 'plugins/scientific-plotting'
  ])
  for (const name of retired) {
    for (const file of ['package.json', 'cordis.patch.yml', 'sciforge.dsh.json']) {
      await assert.rejects(readFile(join(root, 'plugins', name, file)), { code: 'ENOENT' })
    }
  }
  for (const [directory, expected] of Object.entries(licenseSHA256)) {
    if (directory !== 'plugins/project-dag') assert.equal(isLicenseOnlyDomainArchive(join(root, directory)), true, `${directory} must contain only regular archived license text, not runtime remnants`)
    const current = await readFile(join(root, directory, 'LICENSE'))
    assert.equal(createHash('sha256').update(current).digest('hex'), expected, directory)
  }
  const fixtureArchive = {
    'LICENSE': licenseSHA256['plugins/project-dag'],
    'tests/fixtures/legacy-runtime.source.json': '7a007e1c6a3ccb13b9ad4df82c748fcb82b2057123fa2ae59559414a4fbcfdee',
    'tests/fixtures/legacy-runtime.ts.txt': '36f50cead195817f4c891ec05c5e9447d065e72b43ba0e3327ef6eb926e83af4'
  }
  const archiveRoot = join(root, 'plugins/project-dag'), actual = []
  async function inventory(directory, prefix = '') {
    for (const entry of await readdir(directory)) {
      const relative = prefix ? `${prefix}/${entry}` : entry
      const path = join(directory, entry), info = await lstat(path)
      assert.equal(info.isSymbolicLink(), false, relative)
      if (info.isDirectory()) {
        assert.ok(Object.keys(fixtureArchive).some(file => file.startsWith(relative + '/')), relative)
        await inventory(path, relative)
      } else {
        assert.equal(info.isFile(), true, relative)
        actual.push(relative)
        assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), fixtureArchive[relative], relative)
      }
    }
  }
  await inventory(archiveRoot)
  assert.deepEqual(actual.sort(), Object.keys(fixtureArchive).sort(), 'only original inert safety/provenance fixtures and license may survive')
  const packages = await discoverDomainPackages(root)
  for (const name of [...retired, 'artifact-versions', 'research-dossier']) {
    const matches = packages.filter(x => x.packageName === `@sciforge/domain-${name}`)
    assert.equal(matches.length, 1, name)
    const entries = matches[0].definition.entrypoints
    assert.equal(entries.filter(x => x.process === 'renderer').length, 1, name)
    if (name !== 'research-dossier') assert.equal(entries.filter(x => x.process === 'main').length, 1, name)
  }
})
