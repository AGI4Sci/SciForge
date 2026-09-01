import { describe, expect, it } from 'vitest'

import {
  WORKBENCH_NAVIGATION_SECTION_SLOT,
  WorkbenchNavigationSectionContributionRegistry
} from './workbench-navigation-section-slot'

const contract = {
  location: WORKBENCH_NAVIGATION_SECTION_SLOT,
  contractVersion: '1.0.0' as const,
  label: 'fixtureCloudProjects'
}

describe('WorkbenchNavigationSectionContributionRegistry', () => {
  it('orders package-owned sections deterministically', () => {
    const registry = new WorkbenchNavigationSectionContributionRegistry()
    registry.register({
      id: 'zeta.navigation',
      ownerId: 'fixture.zeta',
      order: 20,
      contract,
      value: { render: () => null }
    })
    registry.register({
      id: 'beta.navigation',
      ownerId: 'fixture.beta',
      order: 10,
      contract,
      value: { render: () => null }
    })
    registry.register({
      id: 'alpha.navigation',
      ownerId: 'fixture.alpha',
      order: 10,
      contract,
      value: { render: () => null }
    })

    expect(registry.list().map(({ id }) => id)).toEqual([
      'alpha.navigation',
      'beta.navigation',
      'zeta.navigation'
    ])
  })

  it('rejects duplicate IDs and disposes registrations idempotently', () => {
    const registry = new WorkbenchNavigationSectionContributionRegistry()
    const registration = {
      id: 'fixture.navigation',
      ownerId: 'fixture.owner',
      contract,
      value: { render: () => null }
    }
    const disposable = registry.register(registration)

    expect(() => registry.register({
      ...registration,
      ownerId: 'fixture.other'
    })).toThrow('Duplicate renderer contribution "fixture.navigation"')

    disposable.dispose()
    disposable.dispose()
    expect(registry.list()).toEqual([])

    registry.register(registration)
    registry.dispose()
    registry.dispose()
    expect(registry.list()).toEqual([])
  })
})
