import { describe, expect, it } from 'vitest'

import { COLLABORATION_SCHEMA_VERSION, isCollaborationDatabaseReady, runCollaborationMigrations } from './migrations.js'
import type { SqlPool } from './postgres.js'

describe('collaboration migrations', () => {
  it('installs provider-identity inbox and managed container jobs as schema version 3', async () => {
    const statements: string[] = []
    const pool: SqlPool = {
      query: async (text) => {
        statements.push(text)
        if (text.includes('SELECT max(version)')) {
          return { rows: [{ version: 3 }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      },
      connect: async () => { throw new Error('migrations use pool queries directly') },
      end: async () => undefined
    }

    await runCollaborationMigrations(pool)

    expect(COLLABORATION_SCHEMA_VERSION).toBe(3)
    expect(statements).toHaveLength(3)
    expect(statements[1]).toContain("'provider_identity'")
    expect(statements[2]).toContain('managed_provider_containers')
    expect(statements[2]).toContain('managed_provider_container_jobs')
    expect(statements[1]).toContain('VALUES (2)')
    expect(statements[2]).toContain('VALUES (3)')
    await expect(isCollaborationDatabaseReady(pool)).resolves.toBe(true)
  })
})
