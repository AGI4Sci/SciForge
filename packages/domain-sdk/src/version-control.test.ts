import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'

import {
  VERSION_CONTROL_CREATE_REFERENCE_CONTRACT,
  VERSION_CONTROL_CREATE_SNAPSHOT_CONTRACT,
  VERSION_CONTROL_DIFF_CONTRACT,
  VERSION_CONTROL_LIST_SNAPSHOTS_CONTRACT,
  VERSION_CONTROL_OPEN_WORKSPACE_CONTRACT,
  VERSION_CONTROL_PREVIEW_RESTORE_CONTRACT,
  VERSION_CONTROL_READ_FILE_CONTRACT,
  VERSION_CONTROL_RESTORE_CONTRACT,
  VERSION_CONTROL_STATUS_CONTRACT,
  VERSION_CONTROL_WORKSPACE_RESOURCE_KIND,
  versionControlRestoreInputSchema,
  versionControlStatusOutputSchema
} from './version-control.js'

describe('generic version-control capability contract', () => {
  it('publishes provider-neutral actions with explicit effects', () => {
    assert.equal(VERSION_CONTROL_WORKSPACE_RESOURCE_KIND, 'host.version-control.workspace')
    assert.equal(VERSION_CONTROL_OPEN_WORKSPACE_CONTRACT.effect, 'read')
    assert.equal(VERSION_CONTROL_STATUS_CONTRACT.effect, 'read')
    assert.equal(VERSION_CONTROL_CREATE_SNAPSHOT_CONTRACT.effect, 'workspace-write')
    assert.equal(VERSION_CONTROL_CREATE_REFERENCE_CONTRACT.effect, 'workspace-write')
    assert.equal(VERSION_CONTROL_LIST_SNAPSHOTS_CONTRACT.effect, 'read')
    assert.equal(VERSION_CONTROL_DIFF_CONTRACT.effect, 'read')
    assert.equal(VERSION_CONTROL_READ_FILE_CONTRACT.effect, 'read')
    assert.equal(VERSION_CONTROL_PREVIEW_RESTORE_CONTRACT.effect, 'read')
    assert.equal(VERSION_CONTROL_RESTORE_CONTRACT.effect, 'destructive')
  })

  it('models worktree status without exposing provider-specific values', () => {
    const status = versionControlStatusOutputSchema.parse({
      revision: 'revision-1',
      clean: false,
      changes: [
        { path: 'src/new.ts', status: 'added' },
        {
          path: 'src/renamed.ts',
          previousPath: 'src/old.ts',
          status: 'renamed'
        }
      ],
      truncated: false
    })

    assert.deepEqual(status.changes.map(({ status: value }) => value), ['added', 'renamed'])
    assert.throws(
      () => versionControlStatusOutputSchema.parse({
        revision: 'revision-1',
        clean: false,
        changes: [{ path: 'src/file.ts', status: 'git-index-modified' }],
        truncated: false
      }),
      z.ZodError
    )
  })

  it('strictly bounds destructive restore targets', () => {
    assert.deepEqual(versionControlRestoreInputSchema.parse({
      target: 'snapshot-1',
      paths: ['src/file.ts']
    }), {
      target: 'snapshot-1',
      paths: ['src/file.ts']
    })
    assert.throws(
      () => versionControlRestoreInputSchema.parse({
        target: 'snapshot-1',
        hard: true
      }),
      z.ZodError
    )
  })
})
