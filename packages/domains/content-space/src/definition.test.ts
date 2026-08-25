import { describe, expect, it } from 'vitest'

import { isDomainPackageHostApiCompatible } from '@sciforge/domain-sdk/contract'

import { domainPackageDefinition } from './definition.js'

describe('Content Space domain package definition', () => {
  it('requires the Host API that supports resource-authorized Agent writes', () => {
    expect(domainPackageDefinition.module.hostApi.minimum).toBe('1.5.0')
    expect(isDomainPackageHostApiCompatible(
      domainPackageDefinition.module.hostApi,
      '1.4.0'
    )).toBe(false)
    expect(isDomainPackageHostApiCompatible(
      domainPackageDefinition.module.hostApi,
      '1.5.0'
    )).toBe(true)
  })

  it('declares both provider-owned capability grants through the standard manifest', () => {
    const grants = domainPackageDefinition.entrypoints
      .find(({ process }) => process === 'main')
      ?.contributions.filter(({ kind }) => kind === 'main.system-capability-grant')
      .map(({ id }) => id)
      .sort()
    expect(grants).toEqual([
      'content-space.provisioning-batch',
      'content-space.system-transfer'
    ])
  })
})
