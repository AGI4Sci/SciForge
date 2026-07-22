import assert from 'node:assert/strict'
import test from 'node:test'
import {
  paperRadarI18nResourceContribution,
  paperRadarMessages
} from './paper-radar-messages'

test('keeps the package-owned English and Chinese Paper Radar catalogs aligned', () => {
  const englishKeys = Object.keys(paperRadarMessages.en).sort()
  const chineseKeys = Object.keys(paperRadarMessages.zh).sort()

  assert.equal(englishKeys.length, 41)
  assert.deepEqual(chineseKeys, englishKeys)
  assert.equal(englishKeys.includes('rightPanelPaperRadar'), true)
  assert.equal(englishKeys.includes('rightPanelCollapse'), false)
})

test('exposes translations as immutable data without registration side effects', () => {
  assert.equal(paperRadarI18nResourceContribution.namespace, 'common')
  assert.equal(
    paperRadarI18nResourceContribution.resources.en.paperRadarTitle,
    'Paper Radar'
  )
  assert.equal(Object.isFrozen(paperRadarMessages), true)
  assert.equal(Object.isFrozen(paperRadarMessages.en), true)
})
