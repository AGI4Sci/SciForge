#!/usr/bin/env node

/**
 * Electron's `main` entry point.
 *
 * When `main` names a file that does not exist, Electron opens a native
 * blocking alert ("Error launching app / Cannot find module ...") and the
 * process then sits at 0% CPU with nothing on stdout — indistinguishable from
 * a hang (#218). Resolving the real entry through this shim turns that into
 * one stderr line and exit code 1, whether Electron was started by
 * `electron-vite dev`, a smoke harness, or `electron .` by hand.
 *
 * The build output stays where electron-vite writes it and where
 * electron-builder packs it: `out/main/index.js`.
 */
import { access, realpath } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describeMissingMainEntry, resolveMainEntry } from './electron-entry-guard.mjs'

const scriptPath = fileURLToPath(import.meta.url)
// Inside an asar archive realpath still resolves; the fallback only covers a
// build that ships the shim without its parent directories.
const applicationRoot = dirname(dirname(await realpath(scriptPath).catch(() => scriptPath)))
const mainEntry = resolveMainEntry(applicationRoot)

try {
  // Both a missing file and a dangling link must fail here, before Electron
  // decides it has no application to launch.
  await access(mainEntry)
} catch {
  process.stderr.write(`${describeMissingMainEntry(mainEntry)}\n`)
  process.exit(1)
}

await import(pathToFileURL(mainEntry).href)
