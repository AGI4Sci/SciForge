/**
 * Regenerates tests/baseline/golden.json from the plugin core. While the
 * static module exists, parity.test.ts is the primary guard; the golden file
 * keeps the baseline after the static module is removed. Run:
 *   node --import tsx tests/baseline/generate-baseline.ts
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { happyPathSteps, rejectionSteps, scriptedClock, scriptedIds, scriptedVcs, WORKSPACE } from '../cases.js'
import { runPluginScenario } from '../runner.js'

async function main(): Promise<void> {
  const probeDir = await mkdtemp(join(tmpdir(), 'golden-probe-'))
  try {
    const probe = await runPluginScenario(happyPathSteps('unused').slice(0, 1), {
      vcs: scriptedVcs().vcs,
      userDataDir: probeDir,
      now: scriptedClock(),
      createId: scriptedIds()
    })
    const createdId = (probe[0] as { value: { ok: true; value: { checkpointId: string } } })
      .value.value.checkpointId

    const scenarios: Record<string, readonly unknown[]> = {}
    for (const [name, steps] of [
      ['happy-path', happyPathSteps(createdId)],
      ['rejections', rejectionSteps(createdId)],
      ['dirty-restore', [
        { op: 'create', input: { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: WORKSPACE } },
        { op: 'restore', input: { checkpointId: createdId } },
        { op: 'list', input: {} }
      ]]
    ] as const) {
      const dir = await mkdtemp(join(tmpdir(), 'golden-run-'))
      try {
        scenarios[name] = await runPluginScenario(steps, {
          vcs: scriptedVcs(name === 'dirty-restore' ? { dirtyOnRestore: ['snapshot-1'] } : {}).vcs,
          userDataDir: dir,
          now: scriptedClock(),
          createId: scriptedIds()
        })
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }
    const target = new URL('./golden.json', import.meta.url)
    await writeFile(target, `${JSON.stringify({ createdId, scenarios }, null, 2)}\n`, 'utf8')
    console.log(`wrote ${target.pathname}`)
  } finally {
    await rm(probeDir, { recursive: true, force: true })
  }
}

await main()
