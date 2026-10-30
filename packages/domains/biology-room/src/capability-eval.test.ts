import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BIOLOGY_ROOM_CAPABILITY_EVAL_CONTRIBUTION,
  BIOLOGY_ROOM_EVAL_CASE_IDS
} from './capability-eval.js'
import { BIOLOGY_ROOM_CAPABILITY_IDS } from './contract.js'

describe('Biology Room capability evaluation', () => {
  it('exposes all Agent-visible actions', () => {
    expect(BIOLOGY_ROOM_CAPABILITY_EVAL_CONTRIBUTION.actionIds).toEqual(Object.values(BIOLOGY_ROOM_CAPABILITY_IDS))
    expect(BIOLOGY_ROOM_CAPABILITY_EVAL_CONTRIBUTION.evaluationActionIds).toEqual(
      BIOLOGY_ROOM_CAPABILITY_EVAL_CONTRIBUTION.actionIds
    )
  })

  it('prepares and independently inspects a room fixture', async () => {
    const workspaceDirectory = await mkdtemp(join(tmpdir(), 'sciforge-biology-room-eval-'))
    try {
      const context = {
        caseId: BIOLOGY_ROOM_EVAL_CASE_IDS.load,
        runId: 'run-biology-room-load',
        workspaceDirectory,
        userDataDirectory: workspaceDirectory
      }
      const fixture = await BIOLOGY_ROOM_CAPABILITY_EVAL_CONTRIBUTION.prepare?.(context)
      expect(fixture).toBeDefined()
      const result = await BIOLOGY_ROOM_CAPABILITY_EVAL_CONTRIBUTION.inspect?.({
        context,
        fixture,
        invocations: [{
          actionId: BIOLOGY_ROOM_CAPABILITY_IDS.load,
          args: { roomId: 'eval-room' },
          success: true
        }]
      })
      expect(result?.taskSuccess).toBe(true)
    } finally {
      await rm(workspaceDirectory, { recursive: true, force: true })
    }
  })
})
