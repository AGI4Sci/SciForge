import { readFile } from 'node:fs/promises'

import type { SqlPool } from './postgres.js'

export const COLLABORATION_SCHEMA_VERSION = 1

export async function runCollaborationMigrations(pool: SqlPool): Promise<void> {
  const migrationUrl = new URL('../migrations/0001_collaboration_schema.sql', import.meta.url)
  const sql = await readFile(migrationUrl, 'utf8')
  await pool.query(sql)
}

export async function isCollaborationDatabaseReady(pool: SqlPool): Promise<boolean> {
  try {
    const result = await pool.query<{ version: unknown }>(
      `SELECT max(version) AS version FROM sciforge_collaboration.schema_migrations`
    )
    return Number(result.rows[0]?.version) === COLLABORATION_SCHEMA_VERSION
  } catch {
    return false
  }
}
