import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  closeResourcePreview,
  getResourcePreviewSnapshot,
  openResourcePreview
} from './resource-preview'

const input = {
  resource: { token: `cap_${'a'.repeat(24)}`, semanticRevision: 'sha256:one', expiresAt: '2099-10-22T00:00:00.000Z' },
  workspaceId: 'workspace-1',
  file: { name: 'report.pdf', mimeType: 'application/pdf', size: 42 }
}
afterEach(() => {
  const current = getResourcePreviewSnapshot()
  if (current) closeResourcePreview(current.id)
  vi.unstubAllGlobals()
})

describe('generic Broker resource preview', () => {
  it('uses only the exact Broker content URL and snapshots caller metadata', () => {
    const resourceContentUrl = vi.fn(() => 'sciforge-resource://content?access=exact')
    vi.stubGlobal('window', { sciforge: { capabilities: { resourceContentUrl } } })
    const request = structuredClone(input)
    expect(openResourcePreview(request)).toBe(true)
    expect(resourceContentUrl).toHaveBeenCalledWith({ resource: input.resource, workspaceId: input.workspaceId })
    request.resource.token = `cap_${'b'.repeat(24)}`
    request.file.name = 'mutated.pdf'
    expect(getResourcePreviewSnapshot()?.input).toEqual(input)
    expect(getResourcePreviewSnapshot()).not.toHaveProperty('sessionId')
  })

  it('does not let a stale close dismiss a newer resource', () => {
    vi.stubGlobal('window', { sciforge: { capabilities: { resourceContentUrl: () => 'sciforge-resource://content' } } })
    openResourcePreview(input)
    const first = getResourcePreviewSnapshot()!
    openResourcePreview({ ...input, file: { ...input.file, name: 'second.pdf' } })
    closeResourcePreview(first.id)
    expect(getResourcePreviewSnapshot()?.input.file.name).toBe('second.pdf')
  })

  it('declines malformed handles and caller-supplied URLs before transport', () => {
    const resourceContentUrl = vi.fn()
    vi.stubGlobal('window', { sciforge: { capabilities: { resourceContentUrl } } })
    expect(openResourcePreview({ ...input, resource: { ...input.resource, token: 'invalid' } })).toBe(false)
    expect(openResourcePreview({ ...input, sourceUrl: 'file:///private' } as typeof input)).toBe(false)
    expect(resourceContentUrl).not.toHaveBeenCalled()
  })
})
