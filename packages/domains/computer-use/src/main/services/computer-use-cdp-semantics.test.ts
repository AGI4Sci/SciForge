import { describe, expect, it } from 'vitest'
import {
  CDP_SEMANTIC_TREE_EXPRESSION,
  cdpClickReadbackExpression,
  normalizeCdpClickReadback,
  normalizeCdpSemanticTree,
  verifyCdpClick
} from './computer-use-cdp-semantics'

describe('shared CDP semantic readback', () => {
  it('keeps a bounded, normalized semantic tree for both browser and Electron targets', () => {
    expect(normalizeCdpSemanticTree([{
      tag: 'BUTTON', role: 'button', name: ' Commit Alpha ', center: [-20.2, 1004.8], disabled: false
    }])).toEqual([{
      tag: 'BUTTON', role: 'button', name: 'Commit Alpha', center: [0, 1000], disabled: false,
      current: '', selected: '', expanded: '', pressed: ''
    }])
    expect(normalizeCdpSemanticTree([{ name: 'invalid', center: [1] }])).toEqual([])
    expect(CDP_SEMANTIC_TREE_EXPRESSION).toContain('sciforge-computer-use-semantic-tree-v1')
  })

  it('verifies a click only from target-scoped semantic readback', () => {
    const before = normalizeCdpClickReadback({
      url: 'http://127.0.0.1/alpha', targetName: 'Commit Alpha', activeName: '', targetState: ''
    })
    const after = normalizeCdpClickReadback({
      url: 'http://127.0.0.1/alpha', targetName: 'Commit Alpha', activeName: 'Commit Alpha', targetState: ''
    })
    expect(verifyCdpClick(before, after, [], [])).toEqual({
      status: 'verified', details: { reason: 'clicked-element-focused' }
    })
    expect(cdpClickReadbackExpression(12, 34)).toContain('elementFromPoint(12, 34)')
  })

  it('uses semantic-tree changes as readback without accepting an unchanged click', () => {
    const readback = normalizeCdpClickReadback({ url: 'http://127.0.0.1/alpha' })
    const before = normalizeCdpSemanticTree([{
      tag: 'output', name: 'State Alpha: READY', center: [500, 500]
    }])
    const after = normalizeCdpSemanticTree([{
      tag: 'output', name: 'State Alpha: ALPHA_COMMITTED', center: [500, 500]
    }])
    expect(verifyCdpClick(readback, readback, before, after)).toEqual({
      status: 'verified', details: { reason: 'semantic-tree-changed' }
    })
    expect(verifyCdpClick(readback, readback, before, before)).toEqual({
      status: 'unverified', details: { reason: 'click-has-no-semantic-readback' }
    })
  })
})
