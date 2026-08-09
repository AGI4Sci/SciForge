import { describe, expect, it } from 'vitest'
import { createDomainRendererEntry } from './index'
import { domainPackageDefinition } from '../definition'

describe('Computer Use renderer domain entry', () => {
  it('contributes its settings surface through the generic renderer contract', () => {
    const entry = createDomainRendererEntry({ invokeCapability: async () => ({}) } as never)

    expect(entry.definition).toBe(domainPackageDefinition)
    expect(entry.contributions).toHaveLength(1)
    expect(entry.contributions[0]).toMatchObject({
      kind: 'renderer.settings-section',
      id: 'computer-use.settings-section',
      value: { section: 'agents.permissions', order: 180 }
    })
    const contribution = entry.contributions[0]?.value as {
      render(context: unknown): unknown
    }
    expect(contribution.render({ host: {} })).toBeTruthy()
  })
})
