import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  COLLABORATION_SOURCE_CATALOG_FINGERPRINTS,
  COLLABORATION_SCHEMA_DESCRIPTOR,
  COLLABORATION_SCHEMA_FINGERPRINT,
  COLLABORATION_SCHEMA_VERSION,
  collaborationCatalogFingerprint,
  collaborationSchemaFingerprint,
  detectCollaborationSchemaRoute,
  isCollaborationDatabaseReady,
  runCollaborationMigrations
} from './migrations.js'
import type { SqlPool } from './postgres.js'

type Facts = {
  version: number | null
  managedContainers: boolean
  remoteApprovals: boolean
  oidcIdentities: boolean
  devices: boolean
  legacyResourceRefs: boolean
  taskResourceRefs: boolean
  projectContentSpaceBindings: boolean
}

describe('collaboration forward-only migration lineage', () => {
  it('routes only fresh/upstream v4, public v5, staging v9, and current v11', () => {
    expect(detectCollaborationSchemaRoute(facts(null))).toBe('fresh-v4')
    expect(detectCollaborationSchemaRoute(facts(4, { managedContainers: true, remoteApprovals: true })))
      .toBe('upstream-v4')
    expect(detectCollaborationSchemaRoute(facts(5, {
      oidcIdentities: true, devices: true, legacyResourceRefs: true
    }))).toBe('public-v5')
    expect(detectCollaborationSchemaRoute(facts(9, {
      managedContainers: true, oidcIdentities: true, devices: true, legacyResourceRefs: true
    }))).toBe('staging-v9')
    expect(() => detectCollaborationSchemaRoute(facts(10, {
      managedContainers: true, oidcIdentities: true, devices: true, legacyResourceRefs: true
    }))).toThrow(/lineage_unsupported/u)
  })

  it('installs fresh v4 then exactly one new 0011 migration and verifies the fingerprint', async () => {
    const harness = migrationHarness(facts(null))
    await runCollaborationMigrations(harness.pool, { sourceCatalogFingerprint: harness.sourceCatalogFingerprint })
    expect(COLLABORATION_SCHEMA_VERSION).toBe(11)
    expect(harness.migrations).toHaveLength(5)
    expect(harness.migrations[0]).toContain('VALUES (1)')
    expect(harness.migrations[3]).toContain('remote_capability_approvals')
    expect(harness.migrations[4]).toContain('migration_0011_unsupported_source_lineage')
    expect(harness.migrations[4]).not.toContain('assignment_epoch')
    await expect(isCollaborationDatabaseReady(harness.pool)).resolves.toBe(true)
  })

  it.each([
    ['public-v5', facts(5, { oidcIdentities: true, devices: true, legacyResourceRefs: true })],
    ['staging-v9', facts(9, {
      managedContainers: true, oidcIdentities: true, devices: true, legacyResourceRefs: true
    })]
  ] as const)('upgrades %s without replaying colliding historical migration numbers', async (_route, initial) => {
    const harness = migrationHarness(initial)
    await runCollaborationMigrations(harness.pool, { sourceCatalogFingerprint: harness.sourceCatalogFingerprint })
    expect(harness.migrations).toHaveLength(1)
    expect(harness.migrations[0]).toContain('VALUES (11)')
    expect(harness.migrations[0]).not.toContain('VALUES (10)')
  })

  it('computes the same deterministic canonical schema fingerprint used by readiness', async () => {
    const harness = migrationHarness(facts(11, {
      managedContainers: true, remoteApprovals: true, oidcIdentities: true, devices: true,
      taskResourceRefs: true, projectContentSpaceBindings: true
    }))
    await expect(collaborationSchemaFingerprint(harness.pool)).resolves.toBe(COLLABORATION_SCHEMA_FINGERPRINT)
  })

  it('fails before 0011 when the admitted source catalog fingerprint drifts', async () => {
    const harness = migrationHarness(facts(5, {
      oidcIdentities: true, devices: true, legacyResourceRefs: true
    }))
    await expect(runCollaborationMigrations(harness.pool, {
      sourceCatalogFingerprint: async () => '0'.repeat(64)
    })).rejects.toThrow(/source_fingerprint_mismatch:public-v5/u)
    expect(harness.migrations).toHaveLength(0)
  })

  it('hashes the ordered full catalog descriptor stream mechanically', async () => {
    const descriptors = ['column|tasks|00001|task_id|text|text|NO|', 'migration|0000000004']
    const pool = { query: async () => ({ rows: descriptors.map((descriptor) => ({ descriptor })),
      rowCount: descriptors.length }) } as unknown as SqlPool
    await expect(collaborationCatalogFingerprint(pool)).resolves.toBe(
      createHash('sha256').update(descriptors.join('\n'), 'utf8').digest('hex')
    )
  })
})

function facts(version: number | null, overrides: Partial<Facts> = {}): Facts {
  return {
    version, managedContainers: false, remoteApprovals: false, oidcIdentities: false,
    devices: false, legacyResourceRefs: false, taskResourceRefs: false,
    projectContentSpaceBindings: false, ...overrides
  }
}

function migrationHarness(initial: Facts): {
  pool: SqlPool
  migrations: string[]
  sourceCatalogFingerprint: () => Promise<string>
} {
  let current = { ...initial }
  const migrations: string[] = []
  const pool: SqlPool = {
    query: async (text) => {
      if (text.includes('SELECT table_name,column_name,data_type,is_nullable')) {
        return { rows: COLLABORATION_SCHEMA_DESCRIPTOR.map((descriptor) => {
          const [qualified, data_type, is_nullable] = descriptor.split(':')
          const separator = qualified!.indexOf('.')
          return { table_name: qualified!.slice(0, separator), column_name: qualified!.slice(separator + 1),
            data_type, is_nullable }
        }), rowCount: COLLABORATION_SCHEMA_DESCRIPTOR.length }
      }
      if (text.includes("to_regclass('sciforge_collaboration.schema_migrations')")) {
        return { rows: [{ migration_table: current.version === null ? null : 'schema_migrations',
          managed_containers: current.managedContainers,
          remote_approvals: current.remoteApprovals, oidc_identities: current.oidcIdentities,
          devices: current.devices, legacy_resource_refs: current.legacyResourceRefs,
          task_resource_refs: current.taskResourceRefs,
          project_content_space_bindings: current.projectContentSpaceBindings }], rowCount: 1 }
      }
      if (text.trim() === 'SELECT max(version) AS version FROM sciforge_collaboration.schema_migrations') {
        return { rows: [{ version: current.version }], rowCount: 1 }
      }
      migrations.push(text)
      if (text.includes('VALUES (4)')) {
        current = { ...current, version: 4, managedContainers: true, remoteApprovals: true }
      }
      if (text.includes('VALUES (11)')) {
        current = { ...current, version: 11, managedContainers: true, remoteApprovals: true,
          oidcIdentities: true, devices: true, taskResourceRefs: true,
          projectContentSpaceBindings: true }
      }
      return { rows: [], rowCount: 0 }
    },
    connect: async () => { throw new Error('migration unit harness does not acquire clients') },
    end: async () => undefined
  }
  return { pool, migrations, sourceCatalogFingerprint: async () => {
    const route = detectCollaborationSchemaRoute(current)
    if (route === 'upstream-v4' || route === 'public-v5' || route === 'staging-v9') {
      return COLLABORATION_SOURCE_CATALOG_FINGERPRINTS[route]
    }
    throw new Error(`unexpected source route in migration harness: ${route}`)
  } }
}
