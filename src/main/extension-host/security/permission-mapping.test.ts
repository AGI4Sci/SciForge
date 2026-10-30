import { describe, expect, it } from 'vitest'
import type { DomainPackageRequestedPermission } from '@sciforge/domain-sdk/contract'
import {
  derivePermissionCapabilityDefaults,
  resolvePluginFsPermissions,
  resolvePluginNetDomains
} from './permission-mapping'

function permission(
  overrides: Partial<DomainPackageRequestedPermission>
): DomainPackageRequestedPermission {
  return {
    id: 'fs.read',
    process: 'main',
    reason: 'test permission',
    required: true,
    ...overrides
  }
}

describe('resolvePluginFsPermissions', () => {
  it('gathers fs.read and fs.write paths separately', () => {
    const resolved = resolvePluginFsPermissions([
      permission({ id: 'fs.read', parameters: { paths: ['./data', './docs'] } }),
      permission({ id: 'fs.write', parameters: { paths: ['./scratch'] } }),
      permission({ id: 'net.fetch', parameters: { domains: ['example.com'] } })
    ])
    expect(resolved.read).toEqual(['./data', './docs'])
    expect(resolved.write).toEqual(['./scratch'])
  })

  it('rejects a non-string-array paths parameter instead of silently ignoring it', () => {
    expect(() =>
      resolvePluginFsPermissions([permission({ id: 'fs.read', parameters: { paths: 'not-an-array' } })])
    ).toThrow()
  })
})

describe('resolvePluginNetDomains', () => {
  it('gathers net.fetch domains into a Set, de-duplicated', () => {
    const domains = resolvePluginNetDomains([
      permission({ id: 'net.fetch', parameters: { domains: ['a.com', 'b.com'] } }),
      permission({ id: 'net.fetch', parameters: { domains: ['a.com'] } })
    ])
    expect(domains).toEqual(new Set(['a.com', 'b.com']))
  })
})

describe('derivePermissionCapabilityDefaults', () => {
  it('maps fs.read to read/none', () => {
    expect(derivePermissionCapabilityDefaults(permission({ id: 'fs.read' })))
      .toEqual({ effect: 'read', approval: 'none' })
  })

  it('maps fs.write to workspace-write/confirmation', () => {
    expect(derivePermissionCapabilityDefaults(permission({ id: 'fs.write' })))
      .toEqual({ effect: 'workspace-write', approval: 'confirmation' })
  })

  it('maps net.fetch to external-write/confirmation', () => {
    expect(derivePermissionCapabilityDefaults(permission({ id: 'net.fetch' })))
      .toEqual({ effect: 'external-write', approval: 'confirmation' })
  })
})
