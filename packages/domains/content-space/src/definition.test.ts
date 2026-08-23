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
})
