import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BoundedWorkspaceHostJournal } from './journal.js'

describe('BoundedWorkspaceHostJournal', () => {
  it('replays ordered events and reports an explicit bounded-window gap', () => {
    const journal = new BoundedWorkspaceHostJournal({ capacity: 2 })
    journal.append('workspace.fs.changed', { path: 'a' })
    journal.append('workspace.fs.changed', { path: 'b' })
    journal.append('workspace.fs.changed', { path: 'c' })

    assert.deepEqual(
      journal.replay(1).status === 'ok'
        ? journal.replay(1).events.map((event) => event.seq)
        : [],
      [2, 3]
    )
    assert.deepEqual(journal.replay(0), {
      status: 'gap',
      events: [],
      earliestSeq: 2,
      latestSeq: 3
    })
  })

  it('publishes each event after assigning a monotonic sequence', () => {
    const journal = new BoundedWorkspaceHostJournal()
    const seen: number[] = []
    const unsubscribe = journal.subscribe((event) => seen.push(event.seq))
    journal.append('workspace.fs.changed', {})
    unsubscribe()
    journal.append('workspace.fs.changed', {})
    assert.deepEqual(seen, [1])
  })
})
