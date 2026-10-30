import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import { describe, expect, it, vi } from 'vitest'
import { LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS } from '../contract'
import { createDomainRendererEntry } from './index'

function createHost(): DomainRendererHost {
  return {
    capabilityInvoker: {
      invoke: vi.fn()
    },
    openExternal: vi.fn()
  } as unknown as DomainRendererHost
}

describe('Life Science Preview renderer entry', () => {
  it('publishes every canonical preview contract plus the Mol* lifecycle', () => {
    const entry = createDomainRendererEntry(createHost())
    const previews = entry.contributions.filter(
      (contribution) => contribution.kind === 'renderer.workspace-preview-plugin'
    )
    const lifecycle = entry.contributions.find(
      (contribution) => contribution.kind === 'renderer.lifecycle'
    )

    expect(previews.map((contribution) => contribution.id)).toEqual(
      LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS.map(({ contributionId }) => contributionId)
    )
    for (const [index, contribution] of previews.entries()) {
      const canonical = LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS[index]
      expect(contribution.contract).toStrictEqual(canonical.manifest)
      expect(contribution.value).toMatchObject({ manifest: canonical.manifest })
      expect((contribution.value as { render?: unknown }).render).toBeTypeOf('function')
    }
    expect(lifecycle?.id).toBe('sciforge.life-science-preview.molstar-prewarm')
    expect((lifecycle?.value as { activate?: unknown }).activate).toBeTypeOf('function')
  })

  it('keeps the biology index renderer generic and package-owned', () => {
    const entry = createDomainRendererEntry(createHost())
    const contribution = entry.contributions.find(
      (candidate) => candidate.id === 'sciforge.life-science-preview.biology-index-transport'
    )

    expect(contribution?.kind).toBe('renderer.workspace-preview-plugin')
    expect((contribution?.value as { actions?: unknown }).actions).toBeUndefined()
    expect((contribution?.value as { inspectObservation?: unknown }).inspectObservation).toBeTypeOf('function')
  })
})
