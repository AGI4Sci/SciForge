import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { describeMissingMainEntry, resolveMainEntry } from './electron-entry-guard.mjs'

const repositoryRoot = new URL('..', import.meta.url).pathname

test('the package entry resolves through the shim instead of a build artifact', async () => {
  const manifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
  // Electron opens a native blocking alert when `main` is missing, so `main`
  // itself must be a file that always exists in a checkout (#218).
  assert.equal(manifest.main, './scripts/electron-entry.mjs')
  await access(join(repositoryRoot, manifest.main))
})

test('the packaged file list ships the shim it now points at', async () => {
  const configuration = await readFile(join(repositoryRoot, 'electron-builder.config.cjs'), 'utf8')
  // electron-builder packs an explicit allowlist; a shim outside it would make
  // every packaged build unlaunchable.
  assert.match(configuration, /'scripts\/electron-entry\.mjs'/u)
  assert.match(configuration, /'scripts\/electron-entry-guard\.mjs'/u)
})

test('a missing build output is reported as one line naming the fix, not a native alert', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-entry-'))
  try {
    const entry = resolveMainEntry(root)
    assert.equal(entry, join(root, 'out', 'main', 'index.js'))
    const message = describeMissingMainEntry(entry)
    assert.match(message, /out\/main\/index\.js is missing\./u)
    assert.match(message, /npm run build/u)
    assert.match(message, /npm run dev/u)
    assert.equal(message.split('\n').length, 2)

    // Present output must be honoured; the shim only guards absence.
    await mkdir(join(root, 'out', 'main'), { recursive: true })
    await writeFile(entry, '')
    await access(resolveMainEntry(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
