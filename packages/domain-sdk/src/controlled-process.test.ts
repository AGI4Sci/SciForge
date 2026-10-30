import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'

import {
  CONTROLLED_PROCESS_CREATE_CONTRACT,
  CONTROLLED_PROCESS_DISPOSE_CONTRACT,
  CONTROLLED_PROCESS_LIMITS,
  CONTROLLED_PROCESS_READ_CONTRACT,
  CONTROLLED_PROCESS_RESIZE_CONTRACT,
  CONTROLLED_PROCESS_RESOURCE_KIND,
  CONTROLLED_PROCESS_WRITE_CONTRACT,
  controlledProcessCreateInputSchema,
  controlledProcessReadOutputSchema
} from './controlled-process.js'

describe('controlled process capability contract', () => {
  it('uses one host-owned process profile and canonical capability effects', () => {
    assert.deepEqual(controlledProcessCreateInputSchema.parse({
      profile: 'system-shell',
      cwd: '/workspace',
      terminal: { columns: 120, rows: 40 }
    }), {
      profile: 'system-shell',
      cwd: '/workspace',
      terminal: { columns: 120, rows: 40 }
    })
    assert.equal(CONTROLLED_PROCESS_RESOURCE_KIND, 'host.controlled-process')
    assert.equal(CONTROLLED_PROCESS_CREATE_CONTRACT.effect, 'external-write')
    assert.equal(CONTROLLED_PROCESS_READ_CONTRACT.effect, 'read')
    assert.equal(CONTROLLED_PROCESS_WRITE_CONTRACT.effect, 'external-write')
    assert.equal(CONTROLLED_PROCESS_RESIZE_CONTRACT.effect, 'compute')
    assert.equal(CONTROLLED_PROCESS_DISPOSE_CONTRACT.effect, 'external-write')
  })

  it('rejects arbitrary executables and out-of-bounds terminals', () => {
    assert.throws(
      () => controlledProcessCreateInputSchema.parse({
        executable: '/bin/sh',
        terminal: { columns: 120, rows: 40 }
      }),
      z.ZodError
    )
    assert.throws(
      () => controlledProcessCreateInputSchema.parse({
        profile: 'system-shell',
        terminal: {
          columns: CONTROLLED_PROCESS_LIMITS.maxColumns + 1,
          rows: 40
        }
      }),
      z.ZodError
    )
  })

  it('bounds cursor-based process output across all chunks', () => {
    assert.deepEqual(controlledProcessReadOutputSchema.parse({
      cursor: 'cursor-2',
      chunks: [
        { stream: 'stdout', data: 'ready' },
        { stream: 'stderr', data: 'warning' }
      ],
      truncated: false
    }).chunks.map(({ stream }) => stream), ['stdout', 'stderr'])

    assert.throws(
      () => controlledProcessReadOutputSchema.parse({
        cursor: 'cursor-3',
        chunks: [
          { stream: 'stdout', data: 'x'.repeat(600_000) },
          { stream: 'stdout', data: 'x'.repeat(600_000) }
        ],
        truncated: true
      }),
      z.ZodError
    )
  })
})
