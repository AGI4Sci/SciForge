import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PluginVersionStore } from './plugin-version-store.js'

for (const invalid of ['.', '..', '_hidden', '.hidden', 'Uppercase', 'node_modules', 'favicon.ico', 'a'.repeat(215), '../escape', 'name/escape', '@scope/../escape', '@.scope/name', 'https://example.test/pkg', 'name%2fescape', 'name\n']) {
  test(`version store rejects invalid npm package identity ${JSON.stringify(invalid)}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'invalid-npm-name-'))
    const store = new PluginVersionStore(root)
    try {
      await assert.rejects(store.versions(invalid), /Invalid plugin package name/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

for (const valid of ['-ordinary-plugin', '@-scope/-plugin']) {
  test(`version store accepts legal hyphen-prefixed npm identity ${valid}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'legal-npm-name-'))
    try {
      assert.deepEqual(await new PluginVersionStore(root).versions(valid), [])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

const name = 'ordinary-dsh-plugin'

test('unscoped packages use the canonical immutable version store and active pointer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unscoped-store-'))
  const source = join(root, 'source')
  await mkdir(source)
  const store = new PluginVersionStore(join(root, 'store'))
  const writeVersion = async (version: string, body = version) => {
    await writeFile(join(source, 'package.json'), JSON.stringify({ name, version, dsh: { bundle: { patch: './patch.yml' } } }))
    await writeFile(join(source, 'patch.yml'), body)
  }
  try {
    await writeVersion('1.0.0')
    const first = await store.stage(source)
    assert.equal(first.directory, join(root, 'store', 'packages', name, '1.0.0'))
    assert.equal(await store.verify(first), true)
    assert.deepEqual(await store.stage(source), first)
    const pointer = await store.activate(first)
    assert.deepEqual(await store.active(name), pointer)
    await assert.rejects(store.removeVersion(name, '1.0.0'), /active/)
    await writeVersion('1.0.0', 'changed')
    await assert.rejects(store.stage(source), { code: 'immutable_version' })
    await writeVersion('2.0.0')
    const second = await store.stage(source)
    await store.activate(second)
    assert.deepEqual(await store.versions(name), ['1.0.0', '2.0.0'])
    assert.equal(await store.stagedPath(name, '2.0.0'), second.directory)
    await store.restore(name, pointer)
    assert.deepEqual(await store.active(name), pointer)
    await store.removeVersion(name, '2.0.0')
    assert.deepEqual(await store.versions(name), ['1.0.0'])
    await store.clearActive(name)
    assert.equal(await store.active(name), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
