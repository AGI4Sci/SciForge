import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { createZulipCredentialResolver } from './secret-file.js'

describe('Zulip private secret-file runtime', () => {
  it('rejects unsafe references before reading credential material', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sciforge-zulip-secret-'))
    try {
      await assert.rejects(
        createZulipCredentialResolver(directory, '../outside'),
        { code: 'invalid_payload' }
      )
    } finally {
      await rm(directory, { recursive: true })
    }
  })

  it('rejects non-private files and links escaping the configured root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sciforge-zulip-secret-'))
    const outsideDirectory = await mkdtemp(join(tmpdir(), 'sciforge-zulip-outside-'))
    const syntheticCredential = randomUUID()
    try {
      const sharedFile = join(directory, 'shared-key')
      await writeFile(sharedFile, syntheticCredential, { encoding: 'utf8', mode: 0o600 })
      await chmod(sharedFile, 0o640)
      const sharedResolver = await createZulipCredentialResolver(directory, 'shared-key')
      await assert.rejects(sharedResolver(), { code: 'permission_denied' })

      const outsideFile = join(outsideDirectory, 'outside-key')
      await writeFile(outsideFile, syntheticCredential, { encoding: 'utf8', mode: 0o600 })
      await symlink(outsideFile, join(directory, 'linked-key'))
      const linkedResolver = await createZulipCredentialResolver(directory, 'linked-key')
      await assert.rejects(linkedResolver(), { code: 'permission_denied' })
    } finally {
      await rm(directory, { recursive: true })
      await rm(outsideDirectory, { recursive: true })
    }
  })
})
