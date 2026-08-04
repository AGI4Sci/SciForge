import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  WORKSPACE_SERVER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
} from '@sciforge/domain-sdk/workspace-server'
import {
  LIFE_SCIENCE_WORKSPACE_PREVIEW_MANIFESTS_BY_PLUGIN_ID
} from '@sciforge/domain-life-science-preview/contract'

import { createWorkspaceHostPreviewOperation } from './preview-service.js'

describe('Workspace Host preview operation', () => {
  it('forces provider file placement to the authorized root and encodes bytes', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-host-preview-'))
    await writeFile(join(workspaceRoot, 'sequence.fa'), '>a\nACGT\n')
    let seenPath: string | undefined
    try {
      const registration = createWorkspaceHostPreviewOperation([{
        kind: WORKSPACE_SERVER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
        value: {
          manifest: LIFE_SCIENCE_WORKSPACE_PREVIEW_MANIFESTS_BY_PLUGIN_ID['sequence-genomics'],
          provider: {
            pluginId: 'sequence-genomics',
            observe: async (input: { file: { path: string } }) => {
              seenPath = input.file.path
              return {
                ok: true,
                observation: { source: 'remote' },
                bytesRead: 8,
                truncated: false
              }
            }
          }
        }
      }])
      assert.ok(registration)
      const opened = await registration.handler({
        pluginId: 'sequence-genomics',
        method: 'open',
        input: {
          relativePath: 'sequence.fa'
        }
      }, {
        workspaceRoot,
        sessionId: 'session',
        publishEvent: () => {
          throw new Error('not expected')
        }
      })
      assert.ok(opened && typeof opened === 'object' && !Array.isArray(opened))
      const session = 'session' in opened && opened.session
      assert.ok(session && typeof session === 'object' && !Array.isArray(session))
      const sessionId = 'id' in session ? session.id : undefined
      assert.equal(typeof sessionId, 'string')
      const output = await registration.handler({
        pluginId: 'sequence-genomics',
        method: 'observe',
        input: { sessionId }
      }, {
        workspaceRoot,
        sessionId: 'session',
        publishEvent: () => {
          throw new Error('not expected')
        }
      })
      assert.equal(seenPath, join(await realpath(workspaceRoot), 'sequence.fa'))
      assert.deepEqual(output, {
        ok: true,
        observation: { source: 'remote' }
      })
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})
