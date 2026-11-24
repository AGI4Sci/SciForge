import { expect, it } from 'vitest'
import { siyuanDirectoryListContract, siyuanNotebookListContract, siyuanTreePathSchema } from './catalog-contract.js'

it('uses strict project-scoped requests with bounded pagination and exact file-tree paths', () => {
  expect(siyuanNotebookListContract.inputSchema.parse({ spaceId: 'spc_00000000000000000000000000000001' })).toEqual({ spaceId: 'spc_00000000000000000000000000000001', limit: 50 })
  expect(siyuanDirectoryListContract.inputSchema.parse({ spaceId: 'spc_00000000000000000000000000000001', notebook: '20261108120000-noteboo' })).toMatchObject({ path: '/', limit: 50 })
  for (const path of ['/../private', '/human title', '/20261108120000-abcdefg/../x.sy', 'https://notes.test/']) {
    expect(siyuanTreePathSchema.safeParse(path).success).toBe(false)
  }
  expect(siyuanTreePathSchema.safeParse('/20261108120000-abcdefg/20261108120000-hijklmn.sy').success).toBe(true)
  for (const request of [{ limit: 0 }, { limit: 101 }, { spaceId: '' }, { scope: 'override' }, { cursor: 'x'.repeat(513) }]) {
    expect(siyuanNotebookListContract.inputSchema.safeParse(request).success).toBe(false)
  }
})
