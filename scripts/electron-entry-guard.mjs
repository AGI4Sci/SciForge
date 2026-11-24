/**
 * Entry-point contract shared by the Electron `main` shim and its tests.
 *
 * Keeping this module free of side effects matters: the shim must run when
 * Electron loads it, but every test imports these helpers under plain Node.
 */
import { join } from 'node:path'

export function resolveMainEntry(root) {
  return join(root, 'out', 'main', 'index.js')
}

export function describeMissingMainEntry(entry) {
  return (
    `[sciforge] Cannot start: ${entry} is missing.\n` +
    'The build output is empty or stale. Run `npm run build` before launching the app, ' +
    'or `npm run dev` to start the development server.'
  )
}
