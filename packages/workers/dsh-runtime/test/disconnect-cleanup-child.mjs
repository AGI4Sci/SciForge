import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDshRuntimeAdapter } from '../src/index.ts'

const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url))
for (const failure of [new Error('deterministic deployment cleanup failure'), undefined]) {
  const root = await mkdtemp(join(process.env.TMPDIR, 'disconnect-cleanup-'))
  const adapter = createDshRuntimeAdapter({ executable: process.execPath, executableArgs: [fixture], stateDirectory: root, requestTimeoutMs: 1000, verifyDeployment: async () => {} })
  const events = []
  const controller = new AbortController()
  let stream
  let realCleanup
  let pid
  try {
    const thread = await adapter.startThread({}, { runtimeId: 'dsh', workspace: root })
    stream = (async () => { for await (const event of adapter.subscribeEvents({}, { runtimeId: 'dsh', threadId: thread.id, signal: controller.signal })) events.push(event) })()
    const wait = async predicate => {
      const deadline = Date.now() + 3000
      while (!predicate()) { assert.ok(Date.now() < deadline, 'fixture barrier deadline'); await new Promise(resolve => setTimeout(resolve, 5)) }
    }
    const first = await adapter.startTurn({}, { runtimeId: 'dsh', threadId: thread.id, text: 'env' })
    await wait(() => events.some(e => e.turnId === first.turnId && e.kind === 'turn_lifecycle' && e.state === 'completed'))
    pid = JSON.parse(events.find(e => e.turnId === first.turnId && e.kind === 'assistant_delta').text).pid
    const launch = (await readdir(root)).find(name => name.startsWith('launch-'))
    assert.ok(launch)
    // Nonpublic fault injection ONLY at the acquired deployment cleanup boundary.
    // Production connect/stdio disconnect/retire remain unchanged and execute for real.
    realCleanup = adapter.deploymentCleanup
    assert.equal(typeof realCleanup, 'function')
    let attempts = 0
    let failed = false
    adapter.deploymentCleanup = async () => { attempts++; failed = true; throw failure }
    const crashed = await adapter.startTurn({}, { runtimeId: 'dsh', threadId: thread.id, text: 'crash' })
    await wait(() => failed && events.some(e => e.turnId === crashed.turnId && e.kind === 'turn_lifecycle' && e.state === 'failed'))
    // Let the strict unhandled-rejection checkpoint run before any public observer.
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.throws(() => process.kill(pid, 0), /ESRCH/)
    assert.ok(existsSync(join(root, launch)), 'failed cleanup must not be credited as success')
    for (const action of [() => adapter.connect({}), () => adapter.connect({}), () => adapter.close(), () => adapter.close()]) {
      const result = await Promise.allSettled([action()])
      assert.equal(result[0].status, 'rejected', 'public observer must preserve cleanup failure')
      assert.equal(result[0].reason, failure, 'original rejection identity/value must survive')
    }
    assert.equal(attempts, 1, 'failed cleanup must not automatically retry')
    assert.ok(existsSync(join(root, launch)))
    console.log(JSON.stringify({ strictHostSurvived: true, childExited: true, savedFailure: failure instanceof Error ? failure.message : 'undefined', cleanupAttempts: attempts, publicRejections: 4 }))
  } finally {
    controller.abort()
    await stream
    // Release the synthetic obstruction using the actual acquired cleanup owner.
    if (realCleanup) await realCleanup()
    else await adapter.close()
    if (pid) assert.throws(() => process.kill(pid, 0), /ESRCH/)
    await rm(root, { recursive: true, force: true })
  }
}
