import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { downloadResource } from './resource-manager.js'

test('downloadResource rejects destinations outside the workspace', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-bgc-workspace-'))
  const outside = await mkdtemp(join(tmpdir(), 'sciforge-bgc-outside-'))

  await assert.rejects(
    downloadResource({
      workspaceRoot,
      kind: 'custom',
      url: 'https://example.com/resource.tar.gz',
      targetDir: outside,
      register: false
    }),
    /Path must stay inside workspace root/
  )
})
