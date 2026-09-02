import { describe, expect, it, vi } from 'vitest'
import { IDENTITY_RENDERER_GLOBAL_OVERLAY_CONTRIBUTION } from '../definition.js'
import { createDomainRendererEntry } from './index.js'

describe('local identity renderer entry', () => {
  it('registers the account command, toolbar action, overlay, and local lifecycle', () => {
    const toggleGlobalOverlay = vi.fn()
    const entry = createDomainRendererEntry({
      capabilityInvoker: { invoke: vi.fn() },
      workbench: { toggleGlobalOverlay }
    } as never)
    expect(entry.contributions.map((contribution) => contribution.kind)).toEqual([
      'renderer.command',
      'renderer.workbench-toolbar-action',
      'renderer.workbench-global-overlay',
      'renderer.lifecycle',
      'renderer.i18n-resource'
    ])
    const command = entry.contributions[0]!.value as { execute(input: unknown): void }
    command.execute({ sessionId: 'local-session' })
    expect(toggleGlobalOverlay).toHaveBeenCalledWith(expect.objectContaining({
      contributionId: IDENTITY_RENDERER_GLOBAL_OVERLAY_CONTRIBUTION.id,
      open: true
    }))
  })
})
