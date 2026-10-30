import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  terminalSessionIdForWorkspace,
  terminalWorkspaceSessionKey
} from './terminal-session'

describe('terminal session ids', () => {
  it('namespaces equal tab ids by workspace identity', () => {
    const first = terminalSessionIdForWorkspace('/Users/zxy/project-a', 'main')
    const second = terminalSessionIdForWorkspace('/Users/zxy/project-b', 'main')

    assert.notEqual(first, second)
    assert.match(first, /^terminal:[a-z0-9]+:main$/)
    assert.match(second, /^terminal:[a-z0-9]+:main$/)
  })

  it('normalizes equivalent workspace roots before deriving ids', () => {
    assert.equal(terminalWorkspaceSessionKey('/Users/zxy/project-a/'),
      terminalWorkspaceSessionKey('/users/zxy/project-a')
    )
  })

  it('uses the main tab namespace when no tab id is supplied', () => {
    assert.match(terminalSessionIdForWorkspace('/Users/zxy/project-a', '  '), /:main$/)
  })

  it('does not leak long workspace paths into the session id', () => {
    const longWorkspace = `/Users/zxy/${'nested/'.repeat(80)}project`
    const sessionId = terminalSessionIdForWorkspace(longWorkspace, 'tab-1')

    assert.ok(sessionId.length < 80)
    assert.ok(!sessionId.includes('nested'))
  })
})
