import { describe, expect, it } from 'vitest'

import { COLLABORATION_SCHEMA_VERSION, isCollaborationDatabaseReady, runCollaborationMigrations } from './migrations.js'
import type { SqlPool } from './postgres.js'

describe('collaboration migrations', () => {
  it('installs managed containers and remote approval state through schema version 4', async () => {
    const statements: string[] = []
    const pool: SqlPool = {
      query: async (text) => {
        statements.push(text)
        if (text.includes('SELECT max(version)')) {
          return { rows: [{ version: 4 }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      },
      connect: async () => { throw new Error('migrations use pool queries directly') },
      end: async () => undefined
    }

    await runCollaborationMigrations(pool)

    expect(COLLABORATION_SCHEMA_VERSION).toBe(4)
    expect(statements).toHaveLength(4)
    expect(statements[1]).toContain("'provider_identity'")
    expect(statements[2]).toContain('managed_provider_containers')
    expect(statements[2]).toContain('managed_provider_container_jobs')
    expect(statements[3]).toContain('remote_capability_approvals')
    expect(statements[1]).toContain('VALUES (2)')
    expect(statements[2]).toContain('VALUES (3)')
    expect(statements[3]).toContain('VALUES (4)')
    await expect(isCollaborationDatabaseReady(pool)).resolves.toBe(true)
  })
})
