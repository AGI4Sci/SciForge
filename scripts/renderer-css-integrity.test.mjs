// Permanent guard for the incident in #55: a stylesheet reached main with an
// unclosed block because no check compiled the renderer CSS. This scans every
// renderer stylesheet in the repository and fails on unbalanced braces — the
// condition postcss reports as "Unclosed block" during the full build.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import test from 'node:test'

const ROOT = new URL('..', import.meta.url).pathname

function unbalancedBlock(content) {
  // Strip comments and quoted strings so braces inside them do not count.
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
  let depth = 0
  for (const char of stripped) {
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth < 0) return 'closes more blocks than it opens'
  }
  return depth === 0 ? null : `ends with ${depth} unclosed block(s)`
}

async function collectStylesheets(dir, found = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      await collectStylesheets(path, found)
    } else if (entry.name.endsWith('.css')) {
      found.push(path)
    }
  }
  return found
}

test('the stylesheet guard detects an unclosed block (self-check)', () => {
  const broken = '.a { color: red; }\n.b svg {\n  width: 14px;\n'
  assert.equal(unbalancedBlock(broken), 'ends with 1 unclosed block(s)')
  const overClosed = '.a { color: red; }}\n'
  assert.equal(unbalancedBlock(overClosed), 'closes more blocks than it opens')
  assert.equal(unbalancedBlock('.a { color: red; }\n@media (x) { .b { y: 1; } }\n'), null)
})

test('every renderer stylesheet in the repository has balanced blocks', async () => {
  const files = [
    ...(await collectStylesheets(join(ROOT, 'src', 'renderer'))),
    ...(await collectStylesheets(join(ROOT, 'packages', 'domains'))),
  ]
  assert.ok(files.length >= 10, `expected the repository's renderer stylesheets, found ${files.length}`)
  const failures = []
  for (const file of files) {
    const problem = unbalancedBlock(await readFile(file, 'utf8'))
    if (problem) failures.push(`${relative(ROOT, file)}: ${problem}`)
  }
  assert.deepEqual(failures, [])
})
