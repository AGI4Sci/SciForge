import { describe, expect, it } from 'vitest'

import {
  DOMAIN_PACKAGE_HOST_API_VERSION,
  isDomainPackageHostApiCompatible
} from '@sciforge/domain-sdk/contract'

import {
  domainPackageDefinition as connectorDefinition
} from '@sciforge/domain-opencontent-connector/definition'

import {
  OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRACT,
  OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'

describe('OpenContent Content Space adapter manifest', () => {
  it('requires the exact Principal-bound Host API for both composed packages', () => {
    expect(connectorDefinition.module.hostApi.minimum).toBe('1.9.0')
    expect(domainPackageDefinition.module.hostApi.minimum).toBe('1.9.0')
    expect(isDomainPackageHostApiCompatible(
      connectorDefinition.module.hostApi,
      DOMAIN_PACKAGE_HOST_API_VERSION
    )).toBe(true)
    expect(isDomainPackageHostApiCompatible(
      domainPackageDefinition.module.hostApi,
      DOMAIN_PACKAGE_HOST_API_VERSION
    )).toBe(true)
  })

  it('declares the exact provider-neutral Content Space enrollment contract', () => {
    expect(OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRIBUTION).toMatchObject({
      id: 'opencontent-content-space.provider-enrollment',
      kind: 'renderer.extension',
      version: '1.0.0'
    })
    expect(OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRACT).toEqual({
      location: 'content-space.provider-enrollment-view',
      contractVersion: '1.0.0',
      providerKind: 'opencontent'
    })
    expect(domainPackageDefinition.entrypoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        process: 'renderer',
        export: './renderer',
        contributions: [OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRIBUTION]
      })
    ]))
  })

  it('leaves no standalone OpenContent renderer surface in the Connector package', () => {
    expect(connectorDefinition.entrypoints.some(({ process }) => process === 'renderer'))
      .toBe(false)
    expect(Object.keys(connectorDefinition.contributionContracts)).not.toEqual(
      expect.arrayContaining([
        'opencontent-connector.workbench-right-panel',
        'opencontent-connector.workbench-toolbar-action'
      ])
    )
    expect(JSON.stringify(connectorDefinition)).not.toContain(
      'opencontent-connector.open-connection'
    )
  })
})
