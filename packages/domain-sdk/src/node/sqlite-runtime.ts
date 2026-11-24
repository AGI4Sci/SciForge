import { createRequire } from 'node:module'
import type * as NodeSqlite from 'node:sqlite'

export const MINIMUM_SQLITE_NODE_VERSION = '22.13.0'

/** node:sqlite is available without an experimental CLI flag starting in 22.13. */
export function assertSqliteRuntimeVersion(version: string = process.versions.node): void {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  const major = Number(match?.[1])
  const minor = Number(match?.[2])
  if (!match || major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`SciForge SQLite storage requires Node.js >=${MINIMUM_SQLITE_NODE_VERSION}; current runtime is ${version}. Upgrade Node.js or use the bundled Electron runtime.`)
  }
}

// A static value import would fail during module linking on older Node versions,
// before our version diagnostic could run. Keep the builtin load behind the guard.
assertSqliteRuntimeVersion()
const require = createRequire(import.meta.url)
let sqlite: typeof NodeSqlite
try {
  sqlite = require('node:sqlite') as typeof NodeSqlite
  if (typeof sqlite.DatabaseSync !== 'function') throw new Error('DatabaseSync is unavailable')
} catch (cause) {
  throw new Error(`SciForge SQLite storage requires a Node.js runtime with node:sqlite enabled (Node.js >=${MINIMUM_SQLITE_NODE_VERSION}); current runtime is ${process.versions.node}. Remove --no-experimental-sqlite or use the bundled Electron runtime.`, { cause })
}

export const DatabaseSync = sqlite.DatabaseSync
export type DatabaseSync = NodeSqlite.DatabaseSync
