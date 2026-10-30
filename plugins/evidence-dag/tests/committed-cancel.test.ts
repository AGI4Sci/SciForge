import { it, expect } from 'vitest'
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { readCommittedChain } from '@sciforge/domain-evidence-dag/host/committed-reader'
import { createEvidenceProductionService } from '@sciforge/domain-evidence-dag/host/production-service'
import { workerOptions } from './worker-fixture'
const posixTest = process.platform === 'win32' ? it.skip : it

posixTest.each(['abort', 'close'] as const)('%s interrupts a live owned committed-reader child and joins actual exit', async mode => {
  const root = await mkdtemp(join(tmpdir(), 'committed-cancel-'))
  const executable = join(root, 'held-reader'), pidFile = join(root, 'pid')
  await writeFile(executable, `#!${process.env.EVIDENCE_BUILD_PYTHON}\nimport os,time\nopen(${JSON.stringify(pidFile)},'w').write(str(os.getpid()))\ntime.sleep(30)\n`)
  await chmod(executable, 0o700)
  const controller = new AbortController()
  const worker = await workerOptions()
  const scope = { runtimeId: 'r', threadId: 't', workspaceRoot: root }
  const service = createEvidenceProductionService({ identity: { pluginId: 'cancel-test', version: '1', profileId: root }, storageRoot: root,
    storageInterpreter: executable, worker, clientModule: join(root, 'unused.mjs'),
    threads: { read: async () => ({ ...scope, watermark: '0', trace: [] }), list: async () => [] },
    artifacts: { invoke: async () => { throw Error('No effects') } } })
  let closeTask: Promise<void> | undefined
  const started = Date.now()
  const timer = setInterval(() => { if (existsSync(pidFile) || Date.now() - started > 3000) {
    if (mode === 'abort') controller.abort()
    else closeTask ??= service.close()
  } }, 25)
  try {
    const pending = mode === 'abort' ? readCommittedChain(root, executable, scope, controller.signal)
      : service.providers.evidenceDagPorts.operations['committed.status']({ serviceId: 'evidenceDagPorts', operation: 'committed.status', input: { scope, operation: 'committed.status', protocol: 'sciforge-evidence-ports.v1', identity: { pluginId: 'cancel-test', version: '1', profileId: root } }, requestId: 'close-read', signal: controller.signal, assertCurrent() {},
        owner: { connectionId: 'c', invocationId: 'i', generation: 1, pluginId: 'cancel-test', packageName: 'cancel-test', version: '1',
          authority: { effect: 'read', caller: { principalId: 'owner', workspaceId: root } } } })
    await expect(pending).rejects.toThrow()
    await closeTask
    expect(Date.now() - started).toBeLessThan(4000)
    expect(mode === 'abort' ? controller.signal.aborted : !!closeTask).toBe(true)
    const pid = Number(await readFile(pidFile, 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
  } finally { clearInterval(timer); await service.close(); await rm(root, { recursive: true, force: true }); await rm(worker.root, { recursive: true, force: true }) }
}, 15000)
