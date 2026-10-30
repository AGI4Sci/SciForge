/**
 * The plugin core against outputs saved from the static module. This keeps the
 * parity guarantee after the static module is removed.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { happyPathSteps, rejectionSteps, scriptedClock, scriptedIds, scriptedVcs, WORKSPACE } from './cases.js'
import { runPluginScenario } from './runner.js'

type Golden = {
  createdId: string
  scenarios: Record<string, readonly unknown[]>
}

const golden = JSON.parse(
  await readFile(new URL('./baseline/golden.json', import.meta.url), 'utf8')
) as Golden

test('plugin core reproduces the saved golden baseline', async () => {
  assert.match(golden.createdId, /^manual_\d+_id-1$/u)
  const stepsByName = {
    'happy-path': happyPathSteps(golden.createdId),
    rejections: rejectionSteps(golden.createdId),
    'dirty-restore': [
      { op: 'create', input: { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: WORKSPACE } },
      { op: 'restore', input: { checkpointId: golden.createdId } },
      { op: 'list', input: {} }
    ]
  } as const
  for (const [name, expected] of Object.entries(golden.scenarios)) {
    const steps = stepsByName[name as keyof typeof stepsByName]
    assert.ok(steps, `unknown golden scenario ${name}`)
    const dir = await mkdtemp(join(tmpdir(), 'golden-replay-'))
    try {
      const actual = await runPluginScenario(steps, {
        vcs: scriptedVcs(name === 'dirty-restore' ? { dirtyOnRestore: ['snapshot-1'] } : {}).vcs,
        userDataDir: dir,
        now: scriptedClock(),
        createId: scriptedIds()
      })
      assert.deepEqual(actual, expected, `scenario ${name} diverged from golden baseline`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
})
