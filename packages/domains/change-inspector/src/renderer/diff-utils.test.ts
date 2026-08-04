import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countDiffStats,
  extractDiffFilePath,
  formatFilePath
} from './diff-utils.js'

const patch = [
  'diff --git a/src/index.ts b/src/index.ts',
  '--- a/src/index.ts',
  '+++ b/src/index.ts',
  '@@ -1,2 +1,2 @@',
  '-const before = true',
  '+const after = true',
  ' unchanged'
].join('\n')

test('summarizes unified diff additions and removals', () => {
  assert.deepEqual(countDiffStats(patch), { added: 1, removed: 1 })
})

test('extracts and workspace-relativizes a diff file path', () => {
  assert.equal(extractDiffFilePath(patch), 'src/index.ts')
  assert.equal(
    formatFilePath('/workspace/project/src/index.ts', '/workspace/project'),
    'src/index.ts'
  )
})
