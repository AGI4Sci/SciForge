import assert from 'node:assert/strict'
import test from 'node:test'
import { mergePageModel } from './page-model.js'

test('merges semantic and visual observations without losing stable refs', () => {
  const model = mergePageModel({
    page: { url: 'https://example.test', title: 'Demo', ariaSnapshot: '- button "Save"', targets: [{ targetRef: 'target_dom' }], truncated: false },
    revision: 'browser-3',
    extraText: '- cdp row "Alice"',
    extraTargets: [{ targetRef: 'target_visual', source: 'visual', name: 'chart', confidence: 0.8 }],
    visual: { mimeType: 'image/png', width: 100, height: 80 }
  })
  assert.equal(model.text, '- button "Save"\n- cdp row "Alice"')
  assert.deepEqual(model.targets.map(target => target.targetRef), ['target_dom', 'target_visual'])
  assert.equal(model.visual?.width, 100)
})
