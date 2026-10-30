import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import type { PluginAdapterContract } from '@sciforge/plugin-sdk'
import { CapabilityBroker } from '../capabilities/broker'
import { CapabilityRegistry } from '../capabilities/registry'
import { DevelopmentExternalPluginService } from './development-external-plugins'

const source = process.env.DSH_REAL_PLUGIN_DIR
it.skipIf(!source)('unmodified unitverse registers through real Context/Tools, public Broker invokes, and stop removes it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-unitverse-broker-'))
  const installed = join(root, 'plugins/sample')
  const hashes: Record<string, string> = {}
  const files = ['package.json', 'LICENSE', 'cordis.patch.yml', 'lib/index.js', 'lib/convert.js', 'lib/chunk-TYC2FTN7.js', 'lib/client.js']
  for (const file of files) {
    const bytes = await readFile(join(source!, file))
    await mkdir(dirname(join(installed, file)), { recursive: true })
    await writeFile(join(installed, file), bytes)
    hashes[file] = createHash('sha256').update(bytes).digest('hex')
  }
  const contract: PluginAdapterContract = { hostApiRange: '^1.0.0', permissions: [], approved: true,
    dshAuthorization: { packageName: 'dsh-unitverse', packageVersion: '1.1.1', dshRuntimeVersion: '0.2.0-rc.2',
      tools: { convert: { id: 'unitverse.convert', effect: 'compute' } } } }
  const contracts = new Map([['dsh-unitverse', contract]])
  const registry = new CapabilityRegistry()
  const broker = new CapabilityBroker(registry)
  const service = new DevelopmentExternalPluginService({ root: join(root, 'plugins'), userDataPath: join(root, 'data'),
    hostApiVersion: '1.11.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: contracts })
  const caller = { audience: 'agent' as const, callerId: 'synthetic-agent' }
  try {
    await service.initialize()
    await service.attachCapabilityRegistry(registry)
    await service.setEnabled('dsh-unitverse', true)
    const child = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n')
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
      .find((match) => match && Number(match[2]) === process.pid && match[3].includes('process-extension-runner.mjs'))
    expect(child).toBeDefined()
    const pid = Number(child![1])
    expect(broker.discover(caller).map((d) => d.id)).toContain('unitverse.convert')
    const length = await broker.invoke(caller, { actionId: 'unitverse.convert', invocationId: 'length-1', input: { value: 5, from: 'ft', to: 'cm' } })
    expect(length.output).toMatchObject({ result: 152.4 })
    const pressure = await broker.invoke(caller, { actionId: 'unitverse.convert', invocationId: 'pressure-1', input: { value: 1, from: 'atm', to: 'kPa' } })
    expect(pressure.output).toMatchObject({ result: 101.325 })
    await expect(broker.invoke(caller, { actionId: 'unitverse.convert', invocationId: 'invalid-1', input: { value: 'bad', from: 'ft', to: 'cm' } })).rejects.toThrow()
    await expect(broker.invoke(caller, { actionId: 'unitverse.convert', invocationId: 'invalid-2', input: { value: 1, from: 'ft', to: 'kg' } })).rejects.toThrow()
    contracts.set('dsh-unitverse', { ...contract, dshAuthorization: { ...contract.dshAuthorization!, tools: {} } })
    await expect(broker.invoke(caller, { actionId: 'unitverse.convert', invocationId: 'revoked-1', input: { value: 2, from: 'ft', to: 'cm' } })).rejects.toMatchObject({ code: 'handler_failed', cause: expect.objectContaining({ message: expect.stringMatching(/grant|authoriz/i) }) })
    contracts.set('dsh-unitverse', contract)
    await service.setEnabled('dsh-unitverse', false)
    const alive = () => { try { process.kill(pid, 0); return true } catch { return false } }
    await expect.poll(alive, { timeout: 2000 }).toBe(false)
    expect(broker.discover(caller).map((d) => d.id)).not.toContain('unitverse.convert')
    await expect(broker.invoke(caller, { actionId: 'unitverse.convert', invocationId: 'stopped-1', input: { value: 1, from: 'ft', to: 'cm' } })).rejects.toThrow()
    console.log(JSON.stringify({ sample: 'dsh-unitverse@1.1.1', files: hashes, patchBytes: 0,
      broker: { length: length.output, pressure: pressure.output }, pid, childExited: !alive(), stopped: 'unregistered', hotReplacement: 'NOT VERIFIED' }))
  } finally {
    await service.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
