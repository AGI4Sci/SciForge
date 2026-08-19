import { readFile } from 'node:fs/promises'

import type { SqlPool } from './postgres.js'

export const COLLABORATION_SCHEMA_VERSION = 2

export async function runCollaborationMigrations(pool: SqlPool): Promise<void> {
  for (const name of ['0001_collaboration_schema.sql', '0002_provider_identity_inbox.sql']) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
    await pool.query(sql)
  }
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
