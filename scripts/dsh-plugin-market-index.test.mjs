import assert from 'node:assert/strict'
import test from 'node:test'
import { indexFromBatchReport } from './dsh-plugin-market-index.mjs'

test('catalog Host operations come from the validated artifact rather than batch metadata', async () => {
  const report = { generatedAt: '2026-11-03T00:00:00Z', dshRuntimeVersion: '0.2.1-rc.4', catalogEntries: [], plugins: [{
    packageName: '@example/view', plugin: 'view', version: '1.0.0', activated: true,
    artifact: { path: '/reviewed/view.zip', publisherId: 'example', sizeBytes: 100, sha256: 'a'.repeat(64), ports: ['untrusted.operation'] }
  }] }
  const index = await indexFromBatchReport(report, async () => ({ manifest: {
    entry: 'dist/main.js', tools: { list: { id: 'view.list', effect: 'read', scope: 'workspace', approval: 'confirmation', tags: ['review'] } },
    hostDependencies: [], ports: ['view.list', 'view.capture']
  } }))
  assert.deepEqual(index.plugins[0].ports, ['view.list', 'view.capture'])
  assert.deepEqual(index.plugins[0].tools, [{ name: 'list', id: 'view.list', effect: 'read', scope: 'workspace', approval: 'confirmation', tags: ['review'] }])
  assert.equal(index.blocked.length, 0)
})
