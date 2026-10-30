import { it, expect } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EvidenceRuntime } from '../src/runtime.js'
import { artifactFixture } from './artifact-fixture.js'
it('replays the same watermark after clock advance and runtime restart', async () => {
  const f = await artifactFixture()
  let time = new Date('2026-07-26T00:00:00Z')
  let runtime = new EvidenceRuntime(f.ports, { now: () => time })
  try {
    await runtime.start()
    const first = await runtime.update(f.scope)
    time = new Date('2026-07-26T00:00:05Z')
    expect((await runtime.update(f.scope)).deltaDigest).toBe(first.deltaDigest)
    await runtime.close()
    runtime = new EvidenceRuntime(f.ports, { now: () => time })
    await runtime.start()
    const replay = await runtime.update(f.scope)
    expect(replay.idempotent).toBe(true)
    expect(replay.deltaDigest).toBe(first.deltaDigest)
  } finally { await runtime.close() }
})

it('lifecycle delta retries retain generated createdAt after crash rewind and the clock advances', async () => {
  const f = await artifactFixture()
  let time = new Date('2026-07-26T00:00:00Z')
  const runtime = new EvidenceRuntime(f.ports, { now: () => time })
  try {
    await runtime.start(); await runtime.update(f.scope)
    // Simulate a crash after accepting the delta but before the lifecycle
    // receipt became durable, by restoring its saved pre-poll file.
    const file = join(f.ports.storageRoot, 'artifact-version-lifecycle.json')
    const before = await readFile(file, 'utf8')
    await runtime.pollArtifactEvents(f.scope)
    const records = (await runtime.store.chain('codex:thread-1')).list()
    expect(records.filter(r => r.scope.kind === 'artifact_lifecycle')).toHaveLength(1)
    await runtime.close()
    await writeFile(file, before, { mode: 0o600 })
    time = new Date('2026-07-26T00:01:00Z')
    const restarted = new EvidenceRuntime(f.ports, { now: () => time })
    try {
      await restarted.start(); await restarted.pollArtifactEvents(f.scope)
      expect((await restarted.store.chain('codex:thread-1')).list()).toEqual(records)
    } finally { await restarted.close() }
  } finally { await runtime.close() }
})
