import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  createChangeInspectorCommand
} from './change-inspector-contributions.js'

test('command owns availability, active state, and right-panel execution', async () => {
  const opened: unknown[] = []
  const host = {
    workbench: {
      openRightPanel: (input: unknown) => opened.push(input)
    }
  } as unknown as DomainRendererHost
  const command = createChangeInspectorCommand(host)
  const invocation = {
    sessionId: 'thread-1',
    runtimeId: 'codex',
    workspaceRoot: '/repo'
  }

  assert.equal(command.isAvailable?.(invocation), true)
  assert.equal(command.isActive?.({
    ...invocation,
    activeSurface: {
      kind: 'right-panel',
      contributionId: 'change-inspector.workbench-right-panel'
    }
  }), true)
  await command.execute(invocation)
  assert.deepEqual(opened, [{
    contributionId: 'change-inspector.workbench-right-panel',
    sessionId: 'thread-1'
  }])
})
