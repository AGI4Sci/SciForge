/**
 * Source fidelity: the migrated core must stay byte-for-byte identical to the
 * static package sources after import blocks are stripped, with exactly one
 * sanctioned divergence — the runtime's context type token
 * (`DomainMainRuntimeLifecycleContext` → the narrowed
 * `ResearchCheckpointRuntimeContext` port). Any edit to the static package
 * must be mirrored here; this test is the tripwire.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STATIC_MAIN = join(
  PLUGIN_ROOT, '..', '..', 'packages', 'domains', 'research-checkpoints', 'src', 'main'
)
const STATIC_SRC = join(STATIC_MAIN, '..')

/**
 * Removes whole import statements (single- and multi-line, including
 * `import type` and side-effect imports) so that re-pointed specifiers do not
 * count as drift. Keeps every other byte, including blank lines, in place.
 */
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
    kept.push(line)
  }
  return kept.join('\n')
}

function pluginCore(file: string): string {
  return readFileSync(join(PLUGIN_ROOT, 'src', 'core', file), 'utf8')
}

for (const file of ['crypto.ts', 'atomic-store.ts', 'unified-file-patch.ts', 'extract.ts', 'store.ts']) {
  test(`${file}: byte-identical to the static source after import stripping`, () => {
    assert.equal(stripImports(pluginCore(file)), stripImports(readFileSync(join(STATIC_MAIN, file), 'utf8')))
  })
}

test('contract.ts: byte-identical to the static source after import stripping', () => {
  assert.equal(
    stripImports(readFileSync(join(PLUGIN_ROOT, 'src', 'contract.ts'), 'utf8')),
    stripImports(readFileSync(join(STATIC_SRC, 'contract.ts'), 'utf8'))
  )
})

test('runtime.ts: identical after import stripping and the context-token remap', () => {
  const plugin = stripImports(pluginCore('runtime.ts'))
    .split('ResearchCheckpointRuntimeContext').join('DomainMainRuntimeLifecycleContext')
  const staticSource = stripImports(readFileSync(join(STATIC_MAIN, 'runtime.ts'), 'utf8'))
  assert.equal(plugin, staticSource)
  const occurrences = pluginCore('runtime.ts').split('ResearchCheckpointRuntimeContext').length - 1
  assert.equal(
    occurrences,
    6,
    'the runtime context token must stay confined to the import plus the five usage sites'
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
