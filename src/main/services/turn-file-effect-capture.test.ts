import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, it } from 'vitest'

import {
  captureDeclaredTurnFileEffects,
  captureTurnFileBaseline,
  captureTurnFileEffects,
  freezeExactWorkspaceFile
} from './turn-file-effect-capture'

const roots: string[] = []

it('opens only authenticated declared paths at the terminal boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'turn-file-declared-effects-'))
  roots.push(root)
  await mkdir(join(root, 'outputs'), { recursive: true })
  await writeFile(join(root, 'outputs', 'result.csv'), 'declared')
  await writeFile(join(root, 'unrelated.txt'), 'must-not-be-recorded')
  await writeFile(join(root, '.env'), 'SECRET=must-not-be-recorded')

  const effects = await captureDeclaredTurnFileEffects(root, [{
    path: 'outputs/result.csv', operation: 'add'
  }, {
    path: '.env', operation: 'update'
  }], new Date().toISOString())

  assert.deepEqual(effects.effects.map((item) => item.path), ['outputs/result.csv'])
  assert.equal(JSON.stringify(effects).includes('must-not-be-recorded'), false)
  assert.deepEqual(effects.issues.map((item) => item.code), ['sensitive-file-quarantined'])
})

it('fails closed when an intermediate directory becomes an outside symlink after realpath', async () => {
  const root = await mkdtemp(join(tmpdir(), 'turn-file-intermediate-symlink-race-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  await mkdir(join(workspace, 'capture-output'), { recursive: true })
  await mkdir(join(workspace, 'freeze-output'), { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(workspace, 'capture-output', 'result.txt'), 'safe-capture')
  await writeFile(join(workspace, 'freeze-output', 'result.txt'), 'safe-freeze')
  await writeFile(join(outside, 'result.txt'), 'OUTSIDE_SECRET_MUST_NOT_ENTER_A_RECEIPT')

  const swapDirectory = (name: string) => async () => {
    await rename(join(workspace, name), join(workspace, `${name}-original`))
    await symlink(outside, join(workspace, name))
  }
  const effects = await captureDeclaredTurnFileEffects(
    workspace,
    [{ path: 'capture-output/result.txt', operation: 'add' }],
    new Date().toISOString(),
    () => new Date(),
    { afterInitialRealpath: swapDirectory('capture-output') }
  )
  assert.equal(effects.effects.length, 0)
  assert.equal(effects.issues.some((item) => item.code === 'declared-file-read-failed'), true)
  assert.equal(JSON.stringify(effects).includes('OUTSIDE_SECRET_MUST_NOT_ENTER_A_RECEIPT'), false)

  const frozen = await freezeExactWorkspaceFile(
    workspace,
    'freeze-output/result.txt',
    { afterInitialRealpath: swapDirectory('freeze-output') }
  )
  assert.equal(frozen.ok, false)
  assert.equal(JSON.stringify(frozen).includes('OUTSIDE_SECRET_MUST_NOT_ENTER_A_RECEIPT'), false)
})

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('freezes created dataset and plot bytes at the terminal boundary without following symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'turn-file-effects-'))
  roots.push(root)
  await mkdir(join(root, 'data'), { recursive: true })
  await writeFile(join(root, 'data', 'input.csv'), 'x,y\n1,2\n')
  await symlink('/private/tmp', join(root, 'outside-link'))
  const baseline = await captureTurnFileBaseline(root)

  await mkdir(join(root, 'figures'), { recursive: true })
  await writeFile(join(root, 'data', 'result.csv'), 'species,count\nAdelie,152\n')
  await writeFile(join(root, 'figures', 'penguins.png'), Buffer.from('terminal-png'))
  const effects = await captureTurnFileEffects(
    root,
    baseline,
    '2026-08-12T00:00:00.000Z',
    () => new Date('2026-08-12T00:00:00.010Z')
  )

  assert.deepEqual(effects.effects.map((item) => [item.path, item.kind]), [
    ['data/result.csv', 'created'],
    ['figures/penguins.png', 'created']
  ])
  const plot = effects.effects.find((item) => item.path === 'figures/penguins.png')
  if (!plot || !('dataBase64' in plot)) assert.fail('expected exact plot snapshot')
  assert.equal(plot.kind, 'created')
  assert.equal(Buffer.from(plot.dataBase64, 'base64').toString(), 'terminal-png')
  assert.equal(plot.mediaType, 'image/png')
  assert.equal(effects.effects.some((item) => item.path.startsWith('outside-link/')), false)

  // A later path mutation cannot change the already frozen receipt bytes.
  await writeFile(join(root, 'figures', 'penguins.png'), Buffer.from('late-mutation'))
  assert.equal(Buffer.from(plot.dataBase64, 'base64').toString(), 'terminal-png')
})

it('preserves a deleted-file identity without claiming new output bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'turn-file-delete-'))
  roots.push(root)
  await writeFile(join(root, 'old.txt'), 'old')
  const baseline = await captureTurnFileBaseline(root)
  await rm(join(root, 'old.txt'))
  const receipt = await captureTurnFileEffects(root, baseline, new Date().toISOString())
  assert.equal(receipt.effects[0]?.kind, 'deleted')
  assert.match(
    receipt.effects[0]?.kind === 'deleted' ? receipt.effects[0].baselineFingerprint : '',
    /^[a-f0-9]{64}$/u
  )
})

it('quarantines environment files, credential stores, and private keys without persisting their bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'turn-file-sensitive-'))
  roots.push(root)
  await mkdir(join(root, 'config'), { recursive: true })
  await mkdir(join(root, 'secrets'), { recursive: true })
  await mkdir(join(root, 'outputs'), { recursive: true })
  await writeFile(join(root, '.env'), 'TOKEN=before-env-secret')
  await writeFile(join(root, 'config', 'credentials.json'), '{"token":"before-credential-secret"}')
  await writeFile(join(root, 'secrets', 'sample.txt'), 'before-directory-secret')
  await writeFile(join(root, 'server.pem'), 'before-private-key')
  const baseline = await captureTurnFileBaseline(root)

  await writeFile(join(root, '.env'), 'TOKEN=after-env-secret')
  await writeFile(join(root, 'config', 'credentials.json'), '{"token":"after-credential-secret"}')
  await writeFile(join(root, 'secrets', 'sample.txt'), 'after-directory-secret')
  await writeFile(join(root, 'service-account-key.json'), '{"private_key":"after-service-secret"}')
  await writeFile(join(root, 'server.pem'), 'after-private-key')
  await writeFile(join(root, 'outputs', 'summary.csv'), 'species,count\nAdelie,152\n')

  const receipt = await captureTurnFileEffects(root, baseline, new Date().toISOString())
  assert.deepEqual(receipt.effects.map((item) => item.path), ['outputs/summary.csv'])
  assert.deepEqual(
    receipt.issues
      .filter((item) => item.code === 'sensitive-file-quarantined')
      .map((item) => item.path),
    [
      '.env',
      'config/credentials.json',
      'secrets/sample.txt',
      'server.pem',
      'service-account-key.json'
    ]
  )
  const serialized = JSON.stringify(receipt)
  for (const secret of [
    'after-env-secret',
    'after-credential-secret',
    'after-directory-secret',
    'after-private-key',
    'after-service-secret'
  ]) assert.equal(serialized.includes(secret), false)
})

it('does not emit a deleted effect for a quarantined sensitive path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'turn-file-sensitive-delete-'))
  roots.push(root)
  await mkdir(join(root, '.ssh'), { recursive: true })
  await writeFile(join(root, '.ssh', 'id_ed25519'), 'deleted-private-key')
  const baseline = await captureTurnFileBaseline(root)
  await rm(join(root, '.ssh', 'id_ed25519'))

  const receipt = await captureTurnFileEffects(root, baseline, new Date().toISOString())
  assert.equal(receipt.effects.length, 0)
  assert.deepEqual(
    receipt.issues.filter((item) => item.code === 'sensitive-file-quarantined').map((item) => item.path),
    ['.ssh/id_ed25519']
  )
  assert.equal(JSON.stringify(receipt).includes('deleted-private-key'), false)
})

it('skips SciForge runtime state without losing ordinary CSV and SVG outputs in a large workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'turn-file-large-workspace-'))
  roots.push(root)
  await mkdir(join(root, '.codex-runtime', 'codex-home', 'sessions'), { recursive: true })
  await mkdir(join(root, '.codex-runtime', 'codex-home', 'plugins', 'cache'), { recursive: true })
  await mkdir(join(root, '.claude-code-runtime', 'config'), { recursive: true })
  await mkdir(join(root, 'large-user-inputs'), { recursive: true })
  await mkdir(join(root, 'test-workspaces', 'visible', 'output'), { recursive: true })

  // Reproduce the old 4,096-file truncation failure with ordinary user files,
  // rather than hiding the count in a directory which is intentionally excluded.
  for (let shard = 0; shard < 42; shard += 1) {
    const shardRoot = join(root, 'large-user-inputs', `shard-${String(shard).padStart(2, '0')}`)
    await mkdir(shardRoot, { recursive: true })
    await Promise.all(Array.from({ length: 100 }, (_, index) =>
      writeFile(join(shardRoot, `${String(index).padStart(3, '0')}.txt`), 'stable input')
    ))
  }
  await writeFile(
    join(root, '.codex-runtime', 'codex-home', 'sessions', 'thread.jsonl'),
    '{"type":"private-session-before"}\n'
  )
  await writeFile(join(root, '.codex-runtime', 'state_5.sqlite'), 'private sqlite before')
  await writeFile(join(root, '.codex-runtime', 'state_5.sqlite-wal'), 'private wal before')
  await writeFile(
    join(root, '.codex-runtime', 'codex-home', 'plugins', 'cache', 'entry.json'),
    '{"private":true}'
  )
  await writeFile(join(root, '.claude-code-runtime', 'config', 'state.json'), '{"private":true}')
  const baseline = await captureTurnFileBaseline(root)
  assert.equal(baseline.files.length >= 4_200, true)
  assert.equal(baseline.files.some((item) => item.path.startsWith('.codex-runtime/')), false)
  assert.equal(baseline.files.some((item) => item.path.startsWith('.claude-code-runtime/')), false)
  assert.equal(baseline.issues.some((item) => item.code.endsWith('-overflow')), false)

  // These Host-owned files can change or disappear during a turn, but none is
  // a scientific output and none may enter the turn receipt or Artifact Versions.
  await writeFile(
    join(root, '.codex-runtime', 'codex-home', 'sessions', 'thread.jsonl'),
    '{"type":"private-session-after","secret":"must-not-be-captured"}\n'
  )
  await writeFile(join(root, '.codex-runtime', 'state_5.sqlite'), 'private sqlite after')
  await writeFile(join(root, '.codex-runtime', 'state_5.sqlite-wal'), 'private wal after')
  await rm(join(root, '.codex-runtime', 'codex-home', 'plugins', 'cache', 'entry.json'))
  await writeFile(
    join(root, '.claude-code-runtime', 'config', 'state.json'),
    '{"private":"must-not-be-captured"}'
  )
  await writeFile(
    join(root, 'test-workspaces', 'visible', 'output', 'species-counts.csv'),
    'species,count\nAdelie,152\n'
  )
  await writeFile(
    join(root, 'test-workspaces', 'visible', 'output', 'species-counts.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
  )
  const effects = await captureTurnFileEffects(root, baseline, new Date().toISOString())
  assert.equal(effects.issues.some((item) => item.code.endsWith('-overflow')), false)
  assert.equal(effects.effects.some((item) => item.path.startsWith('.codex-runtime/')), false)
  assert.equal(effects.effects.some((item) => item.path.startsWith('.claude-code-runtime/')), false)
  assert.equal(JSON.stringify(effects).includes('must-not-be-captured'), false)
  assert.deepEqual(effects.effects.map((item) => item.path), [
    'test-workspaces/visible/output/species-counts.csv',
    'test-workspaces/visible/output/species-counts.svg'
  ])
})
