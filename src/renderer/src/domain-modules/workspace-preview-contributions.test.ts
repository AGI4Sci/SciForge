import type { InstalledDomainContribution } from '@sciforge/domain-sdk'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS } from '@shared/workspace-preview'
import { isRendererWorkspacePreviewPluginContribution } from './workspace-preview-contributions'

const manifest = DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS.find(value => value.id === 'text')!
const metadata: InstalledDomainContribution<'renderer'> = {
  process: 'renderer', packageName: '@fixture/resource-preview', entrypoint: './renderer',
  declaration: { id: 'fixture.resource-preview', kind: 'renderer.workspace-preview-plugin', priority: 100 },
  owner: { moduleId: 'fixture.resource-preview', moduleVersion: '1.0.0' }, contract: manifest
}

describe('workspace preview resource contribution boundary', () => {
  it('accepts an optional resource hook on the existing canonical contribution', () => {
    const contribution = { manifest, render: vi.fn(), resource: { contentKinds: ['text'], render: vi.fn() } }
    expect(isRendererWorkspacePreviewPluginContribution(contribution, metadata)).toBe(true)
    expect(isRendererWorkspacePreviewPluginContribution({ manifest, render: vi.fn() }, metadata)).toBe(true)
  })

  it.each([
    null,
    { contentKinds: [], render: vi.fn() },
    { contentKinds: ['csv'], render: vi.fn() },
    { contentKinds: ['text'], render: 'invalid' },
    { render: vi.fn() }
  ])('rejects malformed resource support without activating it', resource => {
    expect(isRendererWorkspacePreviewPluginContribution({ manifest, render: vi.fn(), resource }, metadata)).toBe(false)
  })
})
