/**
 * Scratch directory for the market tooling.
 *
 * Why this exists: `electron-builder.config.cjs` packs `out/**\/*` wholesale, so
 * anything left under `out/` ends up inside `app.asar`. Scratch that travelled in
 * that way (a Python venv with symlinks, logs, a nested test .app) made the
 * packaged app exit immediately on launch — before it even ran its JS.
 *
 * `.tmp/` is neither packed nor tracked by git; it is the safe home for tool
 * scratch. Override with SCIFORGE_MARKET_WORK_DIR when a run needs its own dir.
 */
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export const DEFAULT_MARKET_WORK_DIR = '.tmp/market-work'

export function resolveMarketWorkDir() {
  const configured = process.env.SCIFORGE_MARKET_WORK_DIR?.trim()
  return resolve(configured && configured.length > 0 ? configured : DEFAULT_MARKET_WORK_DIR)
}

export async function ensureMarketWorkDir() {
  const dir = resolveMarketWorkDir()
  await mkdir(dir, { recursive: true })
  return dir
}

/** Log/evidence files for one acceptance run, kept out of the packed tree. */
export async function marketLogDir() {
  const dir = resolve(resolveMarketWorkDir(), 'logs')
  await mkdir(dir, { recursive: true })
  return dir
}