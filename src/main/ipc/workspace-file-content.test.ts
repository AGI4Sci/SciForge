import { describe, expect, it } from 'vitest'
import { isBoundedWorkspaceBase64 } from '../../shared/workspace-file-content'
import { workspaceFileWritePayloadSchema } from './app-ipc-schemas'

describe('local workspace binary content admission', () => {
  it.each(['AA==', 'AAA=', 'AAAA', '', '/w==', '//8='])('accepts canonical %j', content => {
    expect(isBoundedWorkspaceBase64(content)).toBe(true)
  })
  it.each(['A', 'AAA', 'AAAA=', 'AB==', 'AAB=', 'AA\n=', 'AA-A', 'AA_A', '=AAA', '!!!!'])('rejects noncanonical %j before byte allocation', content => {
    expect(isBoundedWorkspaceBase64(content)).toBe(false)
    expect(workspaceFileWritePayloadSchema.safeParse({ path: 'data.parquet', contentBase64: content }).success).toBe(false)
  })
  it('admits exactly 100 MiB and rejects one additional decoded byte at the same encoded length', () => {
    const atLimit = Buffer.alloc(100 * 1024 * 1024).toString('base64')
    expect(isBoundedWorkspaceBase64(atLimit)).toBe(true)
    expect(workspaceFileWritePayloadSchema.safeParse({ path: 'data.parquet', contentBase64: atLimit }).success).toBe(true)
    // 100 MiB has two padding bytes; replacing one retains encoded length but adds one byte.
    const overLimit = `${atLimit.slice(0, -2)}A=`
    expect(overLimit.length).toBe(atLimit.length)
    expect(isBoundedWorkspaceBase64(overLimit)).toBe(false)
    expect(workspaceFileWritePayloadSchema.safeParse({ path: 'data.parquet', contentBase64: overLimit }).success).toBe(false)
  })
})
