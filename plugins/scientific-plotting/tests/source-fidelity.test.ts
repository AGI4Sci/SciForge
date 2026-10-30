/**
 * Source fidelity: the migrated contract must stay byte-for-byte identical to
 * the static package source after import blocks are stripped. Any edit to the
 * static contract must be mirrored here; this test is the tripwire. The
 * plugin's hand-written operation layer mirrors the static handler bodies and
 * is pinned by capability-parity.test.ts instead.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STATIC_SRC = join(
  PLUGIN_ROOT, '..', '..', 'packages', 'domains', 'scientific-plotting', 'src'
)

function stripImports(source: string): string {
  const lines = source.split('\n')
  const kept: string[] = []
  let inImport = false
  const importEnd = /from\s+'[^']+'\s*;?\s*$/
  for (const line of lines) {
    if (inImport) {
      if (importEnd.test(line)) inImport = false
      continue
    }
    if (/^import\s/.test(line)) {
      if (!(importEnd.test(line) || /^import\s+'[^']+'\s*;?\s*$/.test(line))) inImport = true
      continue
    }
    if (/^export\s+\*\s+from\s+'[^']+'\s*;?\s*$/.test(line)) continue
    kept.push(line)
  }
  return kept.join('\n')
}

test('contract.ts: byte-identical to the static source after import stripping', () => {
  assert.equal(
    stripImports(readFileSync(join(PLUGIN_ROOT, 'src', 'contract.ts'), 'utf8')),
    stripImports(readFileSync(join(STATIC_SRC, 'contract.ts'), 'utf8'))
  )
})

function* pluginSources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* pluginSources(path)
    else if (entry.endsWith('.ts')) yield path
  }
}

test('no plugin source imports host-private paths or escapes the package root', () => {
  const forbidden = /(?:from|import)\s+'(?:@shared|@renderer|[^']*src\/(?:main|renderer|shared)\/|\.\.\/\.\.)/u
  for (const path of pluginSources(join(PLUGIN_ROOT, 'src'))) {
    const source = readFileSync(path, 'utf8')
    assert.equal(
      forbidden.test(source),
      false,
      `${path} imports a host-private or out-of-package path`
    )
  }
})
