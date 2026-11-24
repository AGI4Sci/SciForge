import assert from 'node:assert/strict'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { EvidenceFileStorage, prepareEvidenceStorage } from './secure-storage.js'

test('Windows evidence warmup shares verified identities with subsequent storage reads', { skip: process.platform !== 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'evidence-warmup-'))
  try {
    const directory = join(root, 'private')
    mkdirSync(directory)
    const path = join(directory, 'record.json')
    writeFileSync(path, '{"human":"preserved"}')
    await prepareEvidenceStorage([directory, path].map(path => {
      const info = lstatSync(path, { bigint: true })
      return { path, dev: info.dev, ino: info.ino, directory: info.isDirectory() }
    }))
    const storage = new EvidenceFileStorage(path)
    for (let i = 0; i < 5; i++) assert.equal(storage.readText(), readFileSync(path, 'utf8'))
    assert.equal(storage.readText(), '{"human":"preserved"}')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
