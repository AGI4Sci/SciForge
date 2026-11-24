import { describe, expect, it } from 'vitest'
import { context, definitions, recordingInvoker } from './test-support.js'

describe('staging read handlers', () => {
  it('explicitly refuses unimplemented read contracts without invoking a write', async () => {
    const { invoker, calls } = recordingInvoker()
    for (const definition of definitions(invoker).slice(1)) {
      await expect(definition.handler({}, context)).rejects.toThrow(/contract is not defined/)
    }
    expect(calls).toHaveLength(0)
  })
  it.todo('reads the agreed evidence slice through public read capabilities with zero writes')
  it.todo('returns coverage_unknown and no ranking for stale or unavailable graph')
  it.todo('bounds negative and oversized budgets according to the agreed input contract')
})
