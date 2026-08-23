import { describe, expect, it, vi } from 'vitest'

import { readOpenContentFolderInfo } from './folder-info-reader.js'

describe('OpenContent folder-info reader', () => {
  it('reads one verified folder DTO through the canonical folder-info request', async () => {
    const signal = new AbortController().signal
    const request = vi.fn(async (input: Readonly<{
      path: string
      body: unknown
      signal?: AbortSignal
    }>) => {
      expect(input).toEqual({
        path: '/flatsdk/api/services/DocList/GetFolderInfoById',
        body: { token: 'fixture-token-value', folderId: 9002213 },
        signal
      })
      return {
        result: 0,
        msg: '',
        data: {
          id: 9002213,
          folderGuid: '11111111-2222-4333-8444-555555555555',
          parentFolderId: 0,
          folderType: 2,
          teamId: 9000019,
          permission: 15,
          childFolderCount: 0,
          childFileCount: 0
        }
      }
    })

    await expect(readOpenContentFolderInfo({
      token: 'fixture-token-value',
      folderId: 9002213,
      signal,
      request
    })).resolves.toEqual({
      result: 0,
      folder: {
        id: 9002213,
        folderGuid: '11111111-2222-4333-8444-555555555555',
        parentFolderId: 0,
        folderType: 2,
        teamId: 9000019,
        permission: 15,
        childFolderCount: 0,
        childFileCount: 0
      }
    })
    expect(request).toHaveBeenCalledOnce()
  })
})
