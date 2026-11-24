import { describe, expect, it } from 'vitest'
import type { AnchoredCommentThread } from './contract'
import { buildConversationContext, snapshotConversation } from './conversation-context'

function conversation(): AnchoredCommentThread {
  const at = '2026-11-12T00:00:00.000Z'
  return {
    schemaVersion: 2, id: 'root', workspaceKey: '/workspace', purpose: 'research',
    anchor: { targetKey: 'code', targetLabel: 'Code',
      canonical: { kind: 'research', resourceKind: 'code', resourceId: 'src/test.ts' },
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      codeAnchor: { filePath: 'src/test.ts', side: 'new', line: 1, hunkHeader: '',
        code: 'const value = 1', baseRevision: 'abc', contentDigest: 'a'.repeat(64) } },
    capture: { capturedAt: at, appVersion: 'test', platform: 'test',
      viewport: { width: 100, height: 100, scaleFactor: 1 }, targetLabel: 'Code',
      targetBounds: { x: 0, y: 0, width: 1, height: 1 }, unavailableReason: 'Text evidence only.' },
    messages: [{ id: 'm1', authorKind: 'user', body: 'Explain', createdAt: at, updatedAt: at }],
    status: 'open', anchorResolution: 'resolved', feedback: { state: 'local' }, createdAt: at, updatedAt: at
  }
}

describe('plugin conversation context', () => {
  it('keeps only the chosen parent prefix and returns an independent snapshot', () => {
    const thread = conversation()
    thread.messages.push({ ...thread.messages[0]!, id: 'm2', body: 'Later' })
    const snapshot = snapshotConversation(thread, 'm1')
    expect(snapshot.messages.map((message) => message.id)).toEqual(['m1'])
    thread.messages[0]!.body = 'Edited'
    expect(snapshot.messages[0]!.body).toBe('Explain')
    expect(() => snapshotConversation(thread, 'absent')).toThrow(/fork point/)
  })

  it('bounds escaped text and code while retaining the latest question', () => {
    const thread = conversation()
    thread.anchor.codeAnchor!.code = '\\"'.repeat(20_000)
    thread.messages = Array.from({ length: 100 }, (_, index) => ({
      ...thread.messages[0]!, id: `m${index}`, body: '\\"'.repeat(10_000)
    }))
    thread.messages.at(-1)!.body = 'Latest question'
    const context = buildConversationContext(thread)
    expect(context.truncated).toBe(true)
    expect(context.prompt.length).toBeLessThan(30_000)
    expect(context.prompt).toContain('Latest question')
    expect(context.prompt).not.toContain('/workspace')
  })
})
