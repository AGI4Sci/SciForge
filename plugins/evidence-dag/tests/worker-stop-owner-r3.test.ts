import { it, expect } from 'vitest'
import { writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { PythonEvidenceWorker } from '@sciforge/domain-evidence-dag/host/python-worker'
import { workerOptions } from './worker-fixture.js'
const posixTest = process.platform === 'win32' ? it.skip : it
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const live = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

posixTest('ED-R3-02 short close deadlines retain one escalation clock through repeated and concurrent attempts', async () => {
  const options = await workerOptions(), executable = join(options.root, 'ignore-term.py')
  // Only the signal disposition is instrumented; requests/storage execute
  // the exact real wheel through the ordinary worker command lane.
  await writeFile(executable, `#!/opt/homebrew/bin/python3 -I
import os,sys
args=sys.argv[1:]
i=args.index('-c')+1
args[i]='import signal;signal.signal(signal.SIGTERM,signal.SIG_IGN);'+args[i]
os.execv('/opt/homebrew/bin/python3',['python3',*args])
`); await chmod(executable, 0o700)
  const worker = new PythonEvidenceWorker({ ...options, executable, closeTimeoutMs: 100 })
  await worker.request('readSnapshot', { threadId: 'codex:absent', snapshotDigest: 'sha256:' + 'a'.repeat(64), workspaceRoot: options.root }).catch(() => undefined)
  const pid = worker.pid!, start = Date.now(), errors: unknown[] = []
  expect(live(pid)).toBe(true)
  try {
    for (let n = 0; n < 6; n++) {
      const began = Date.now(), closing = worker.close(); expect(worker.close()).toBe(closing)
      const error = await closing.then(() => null, error => error)
      errors.push(error)
      expect(error).toMatchObject({ code: 'QUIESCENCE_TIMEOUT' })
      expect(Date.now() - began).toBeLessThan(400)
      expect(live(pid), 'deadline cannot claim an OS exit').toBe(true)
      await sleep(150)
    }
    // The original 2s clock, not the most recent close attempt, owns stop.
    await sleep(Math.max(0, 2300 - (Date.now() - start)))
    expect(live(pid), 'owned timer must SIGKILL automatically despite short deadlines').toBe(false)
    await worker.close(); await worker.close()
    console.log('ED_R3_02_OS_EXIT', JSON.stringify({ pid, exited: !live(pid), elapsedMs: Date.now() - start, deadlines: errors.length, manualKill: false }))
  } finally {
    // Failed RED runs alone require targeted leak cleanup. This branch is
    // never a passing assertion or a substitute for automatic escalation.
    if (live(pid)) {
      console.log('ED_R3_02_FAILED_RUN_CLEANUP_ONLY', JSON.stringify({ pid }))
      process.kill(pid, 'SIGKILL')
      for (let n = 0; n < 100 && live(pid); n++) await sleep(10)
    }
    await worker.close().catch(() => undefined)
  }
}, 10000)

it('ED-R3-02 normal SIGTERM confirms actual exit with a short timeout', async () => {
  const options = await workerOptions(), worker = new PythonEvidenceWorker({ ...options, closeTimeoutMs: 100 })
  await worker.request('readSnapshot', { threadId: 'codex:absent', snapshotDigest: 'sha256:' + 'a'.repeat(64), workspaceRoot: options.root }).catch(() => undefined)
  const pid = worker.pid!, closing = worker.close(); expect(worker.close()).toBe(closing)
  await closing; expect(live(pid)).toBe(false); await worker.close()
})

it.each(['hash', 'spawn'] as const)('ED-R3-02 failed %s startup remains safely closeable', async failure => {
  const options = await workerOptions(), worker = new PythonEvidenceWorker({ ...options,
    ...(failure === 'hash' ? { wheelSha256: '0'.repeat(64) } : { executable: join(options.root, 'absent-executable') }), closeTimeoutMs: 100 })
  await expect(worker.request('readSnapshot', {})).rejects.toThrow()
  const closing = worker.close(); expect(worker.close()).toBe(closing); await closing
  expect(worker.pid).toBeUndefined(); await worker.close()
})
