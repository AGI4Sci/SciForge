import { describe, expect, it } from 'vitest'

import { COLLABORATION_SCHEMA_VERSION, isCollaborationDatabaseReady, runCollaborationMigrations } from './migrations.js'
import type { SqlPool } from './postgres.js'

describe('collaboration migrations', () => {
  it('installs the provider-identity inbox constraint as schema version 2', async () => {
    const statements: string[] = []
    const pool: SqlPool = {
      query: async (text) => {
        statements.push(text)
        if (text.includes('SELECT max(version)')) {
          return { rows: [{ version: 2 }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      },
      connect: async () => { throw new Error('migrations use pool queries directly') },
      end: async () => undefined
    }

    await runCollaborationMigrations(pool)

    expect(COLLABORATION_SCHEMA_VERSION).toBe(2)
    expect(statements).toHaveLength(2)
    expect(statements[1]).toContain("'provider_identity'")
    expect(statements[1]).toContain('VALUES (2)')
    await expect(isCollaborationDatabaseReady(pool)).resolves.toBe(true)
  })
})
