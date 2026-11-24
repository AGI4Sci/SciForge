import { describe, expect, it, vi } from 'vitest'
import { createCodeSelection, openCodeSelection, diffCodeRows } from '../renderer/src/lib/code-selection'
import { selectionFromResource } from '../../plugins/anchored-comments/src/selection'

const scope = { runtimeId: 'runtime', threadId: 'session', workspaceRoot: '/workspace' }
const bounds = { x: 10, y: 20, width: 80, height: 20 }
const viewport = { width: 1000, height: 800, scaleFactor: 1 }
describe('code evidence producer', () => {
  it('routes exact source range through the generic resource receiver without replacing source pane', async () => {
    const selection = await createCodeSelection({ scope, filePath: '/workspace/src/a.ts', text: 'first\n  second\nthird', start: 8, end: 14, bounds, viewport })
    let received: unknown
    const openResource = vi.fn(input => { received = selectionFromResource(input.resource, { workspaceRoot: '/workspace', sessionId: 'session', runtimeId: 'runtime' }); return true })
    await openCodeSelection(selection, { canOpenResource: () => true, openResource })
    expect(received).toEqual(selection)
    expect(selection.codeAnchor).toMatchObject({ filePath: 'src/a.ts', line: 2, endLine: 2, code: 'second' })
    expect(selection.codeAnchor.contentDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(openResource.mock.calls[0][0].placement).toBe('new')
  })
  it('rejects paths outside workspace, empty and oversized selections', async () => {
    for (const change of [{ filePath: '/elsewhere/a.ts' }, { start: 1, end: 1 }, { text: 'x'.repeat(4001), end: 4001 }]) {
      await expect(createCodeSelection({ scope, filePath: 'a.ts', text: 'value', start: 0, end: 5, bounds, viewport, ...change })).rejects.toThrow()
    }
  })
  it('maps deleted and added diff rows to their own revision side and hunk', () => {
    expect(diffCodeRows('--- a/a.ts\n+++ b/a.ts\n@@ -3,2 +7,2 @@\n-old\n+new\n same')).toEqual([
      { code: 'old', side: 'old', line: 3, hunkHeader: '@@ -3,2 +7,2 @@' },
      { code: 'new', side: 'new', line: 7, hunkHeader: '@@ -3,2 +7,2 @@' },
      { code: 'same', side: 'new', line: 8, hunkHeader: '@@ -3,2 +7,2 @@' }
    ])
  })
  it('reports an unavailable receiver without writing anything', async () => {
    const selection = await createCodeSelection({ scope, filePath: 'a.ts', text: 'value', start: 0, end: 5, bounds, viewport })
    const openResource = vi.fn()
    await expect(openCodeSelection(selection, { canOpenResource: () => false, openResource })).rejects.toThrow(/入口/)
    expect(openResource).not.toHaveBeenCalled()
  })
})
