import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalizeJson } from './canonical-json.js'
import { canonicalizeReproValue } from './reproducibility.js'

test('canonical JSON rejects sparse arrays and invalid Unicode rather than aliasing signed payloads', () => {
  for (const value of [Array(1), Object.assign(Array(2), { 1: 1 }), [undefined], NaN, Infinity, '\ud800', { ['\udfff']: 1 }]) {
    assert.throws(() => canonicalizeJson(value))
  }
  const target = { z: ['μ', 1, null], a: { yes: true } }
  assert.equal(canonicalizeJson(target), '{"a":{"yes":true},"z":["μ",1,null]}')
  assert.equal(canonicalizeJson(target), canonicalizeReproValue(target))
})
