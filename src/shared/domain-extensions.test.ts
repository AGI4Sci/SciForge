import { describe, expect, it } from 'vitest'
import {
  domainExtensionRendererContributionsEqual,
  type DomainExtensionRendererContribution
} from './domain-extensions'

function contribution(
  overrides: Partial<DomainExtensionRendererContribution> = {}
): DomainExtensionRendererContribution {
  return {
    pluginId: 'sciforge.example',
    contributionId: 'example.panel',
    kind: 'panel',
    title: 'Example',
    generation: 1,
    version: '1.0.0',
    entryUrl: 'file:///plugins/example/panel.js',
    stateVersion: 3,
    ...overrides
  }
}

describe('domainExtensionRendererContributionsEqual', () => {
  it('treats identical projections as equal regardless of array identity', () => {
    const left = [contribution(), contribution({ contributionId: 'example.tab', kind: 'tab' })]
    const right = left.map((entry) => ({ ...entry }))

    expect(right).not.toBe(left)
    expect(right[0]).not.toBe(left[0])
    expect(domainExtensionRendererContributionsEqual(left, right)).toBe(true)
  })

  it('is reflexive for the same reference', () => {
    const left = [contribution()]

    expect(domainExtensionRendererContributionsEqual(left, left)).toBe(true)
    expect(domainExtensionRendererContributionsEqual([], [])).toBe(true)
  })

  it.each([
    ['pluginId', { pluginId: 'sciforge.other' }],
    ['contributionId', { contributionId: 'example.other' }],
    ['kind', { kind: 'tab' as const }],
    ['title', { title: 'Renamed' }],
    ['generation', { generation: 2 }],
    ['version', { version: '1.0.1' }],
    ['entryUrl', { entryUrl: 'file:///plugins/example/panel-next.js' }],
    ['stateVersion', { stateVersion: 4 }]
  ])('detects a changed %s so reloads still reach the renderer', (_field, patch) => {
    expect(domainExtensionRendererContributionsEqual(
      [contribution()],
      [contribution(patch)]
    )).toBe(false)
  })

  it('detects additions, removals, and reordering', () => {
    const first = contribution({ contributionId: 'a' })
    const second = contribution({ contributionId: 'b' })

    expect(domainExtensionRendererContributionsEqual([first], [first, second])).toBe(false)
    expect(domainExtensionRendererContributionsEqual([first, second], [first])).toBe(false)
    expect(domainExtensionRendererContributionsEqual([first, second], [second, first])).toBe(false)
  })
})