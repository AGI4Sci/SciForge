import { describe, expect, it } from 'vitest'
import { anchoredCommentThreadSchema } from '../contract.js'
import { sharedPublicationOf } from './shared-publication.js'

const at = '2026-11-12T00:00:00.000Z'
const input = { projectId: 'prj_CodeConversation01', requestId: 'req_CodePublish00001', idempotencyKey: 'idem_code_publish_0001', messageIds: ['m1'] }
const thread = anchoredCommentThreadSchema.parse({
  schemaVersion: 2, id: 'root', workspaceKey: '/private/project', purpose: 'research',
  anchor: { targetKey: '/private/project/file.ts', targetLabel: 'file.ts', canonical: { kind: 'visual', route: '/private/route' },
    bounds: { x: 1, y: 1, width: 1, height: 1 },
    codeAnchor: { filePath: 'file.ts', side: 'new', line: 1, hunkHeader: '', code: 'const x = 1', baseRevision: 'abc', contentDigest: 'a'.repeat(64) } },
  capture: { capturedAt: at, appVersion: '1', platform: 'darwin', viewport: { width: 100, height: 100, scaleFactor: 1 },
    targetLabel: 'private', targetBounds: { x: 1, y: 1, width: 1, height: 1 }, unavailableReason: 'private metadata' },
  messages: [{ id: 'm1', authorKind: 'user', body: 'Selected question', createdAt: at, updatedAt: at },
    { id: 'm2', authorKind: 'user', body: 'Unselected private draft', createdAt: at, updatedAt: at }],
  status: 'open', anchorResolution: 'resolved', feedback: { state: 'local' }, createdAt: at, updatedAt: at
})

describe('explicit shared publication projection', () => {
  it('publishes only selected portable code and messages', () => {
    const result = sharedPublicationOf(thread, input)
    expect(result.messages).toEqual([{ messageId: 'm1', kind: 'user', body: 'Selected question' }])
    expect(result.anchor).toEqual(thread.anchor.codeAnchor)
    expect(JSON.stringify(result)).not.toMatch(/private|viewport|bounds|capture|workspaceKey/u)
  })
  it.each([{ messageIds: [] }, { messageIds: ['missing'] }, { messageIds: ['m1', 'm1'] }])('rejects invalid selection $messageIds', ({ messageIds }) => {
    expect(() => sharedPublicationOf(thread, { ...input, messageIds })).toThrow()
  })
  it('rejects stale anchors and local forks without a shared parent', () => {
    expect(() => sharedPublicationOf({ ...thread, anchorResolution: 'needs_retargeting' }, input)).toThrow(/Retarget/u)
    expect(() => sharedPublicationOf({ ...thread, fork: { parentThreadId: 'p', parentMessageId: 'm', messages: [], truncated: false } }, input)).toThrow(/shared parent/u)
  })
})
