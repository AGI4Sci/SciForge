import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MANAGED_SURFACES,
  browserExecutableCandidates,
  emptyHarnessState,
  managedSurfaceHtml
} from './computer-use-managed-multisession-harness'

describe('managed Computer Use multisession harness', () => {
  it('defines four independently named, stateful acceptance surfaces', () => {
    assert.deepEqual(MANAGED_SURFACES.map(({ id }) => id), ['alpha', 'beta', 'gamma', 'delta'])
    for (const surface of MANAGED_SURFACES) {
      const html = managedSurfaceHtml(surface)
      const upper = surface.id.toUpperCase()
      assert.match(html, new RegExp(`Managed Session ${surface.label}`))
      assert.match(html, new RegExp(`name="sciforge-target-label" content="Managed CUA ${surface.label}"`))
      assert.match(html, new RegExp(`Commit ${surface.label}`))
      assert.match(html, new RegExp(`${upper}_CONTEXT`))
      assert.match(html, new RegExp(`${upper}_COMMITTED`))
      for (const other of MANAGED_SURFACES.filter(({ id }) => id !== surface.id)) {
        assert.equal(html.includes(`${other.id.toUpperCase()}_COMMITTED`), false)
      }
    }
  })

  it('starts every surface with independent uncommitted state', () => {
    const state = emptyHarnessState()
    assert.deepEqual(Object.keys(state), ['alpha', 'beta', 'gamma', 'delta'])
    assert.deepEqual(Object.values(state), Array.from({ length: 4 }, () => ({
      commits: 0, state: 'READY', cookie: '', storage: '', updatedAt: null
    })))
    assert.notEqual(state.alpha, state.beta)
  })

  it('prefers an explicit trusted Chromium executable', () => {
    assert.equal(browserExecutableCandidates('E:\\trusted\\chromium.exe')[0], 'E:\\trusted\\chromium.exe')
  })
})
