/**
 * E3 — a version only moves through candidate → check → replace → apply; a
 * same-version candidate or a direct replace must be rejected before any live
 * state is written.
 */
import assert from 'node:assert/strict'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import {
  changeInspectorIds,
  contractFor,
  createHarness,
  EXPECTED_IDS,
  PACKAGE_NAME,
  PACKAGE_VERSION
} from './harness.js'

type Harness = Awaited<ReturnType<typeof createHarness>>

async function stageCandidate(harness: Harness, version?: string): Promise<string> {
  const candidate = join(harness.pluginsRoot, '.candidates', 'next')
  await mkdir(dirname(candidate), { recursive: true })
  await cp(join(harness.pluginsRoot, 'change-inspector'), candidate, { recursive: true })
  if (version !== undefined) {
    const packagePath = join(candidate, 'package.json')
    const parsed = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>
    parsed.version = version
    await writeFile(packagePath, `${JSON.stringify(parsed, null, 2)}\n`)
  }
  return candidate
}

test('same-version check and direct replace are rejected without changing state', { timeout: 120_000 }, async () => {
  const harness = await createHarness()
  try {
    await harness.service.setEnabled(PACKAGE_NAME, true)
    const before = await harness.service.updateStatus(PACKAGE_NAME)
    const candidate = await stageCandidate(harness)

    await assert.rejects(
      harness.service.checkCandidate(PACKAGE_NAME, candidate),
      /version must change/i
    )
    await assert.rejects(
      harness.service.replacePlugin(PACKAGE_NAME, candidate),
      /version must change/i
    )
    const after = await harness.service.updateStatus(PACKAGE_NAME)
    assert.equal(after.version, before.version)
    assert.equal(after.generation, before.generation)
    assert.equal(after.version, PACKAGE_VERSION)
    assert.deepEqual(changeInspectorIds(harness.registry), EXPECTED_IDS)
  } finally {
    await harness.dispose()
  }
})

test('candidate → check → replace → apply moves the live version once', { timeout: 120_000 }, async () => {
  const harness = await createHarness()
  try {
    await harness.service.setEnabled(PACKAGE_NAME, true)
    const candidate = await stageCandidate(harness, '0.2.0')
    // The exact-version approval follows the candidate (host-owned contract).
    harness.contracts.set(PACKAGE_NAME, contractFor(PACKAGE_NAME, '0.2.0'))

    await harness.service.checkCandidate(PACKAGE_NAME, candidate)
    await harness.service.replacePlugin(PACKAGE_NAME, candidate)
    const applied = await harness.service.updateStatus(PACKAGE_NAME)
    assert.equal(applied.version, '0.2.0')
    assert.notEqual(applied.version, PACKAGE_VERSION)
    assert.equal(applied.activationState, 'active')

    // Applying again would be a same-version replacement.
    await assert.rejects(
      harness.service.applyCandidate(PACKAGE_NAME),
      /version must change/i
    )
    assert.equal((await harness.service.updateStatus(PACKAGE_NAME)).version, '0.2.0')
    assert.deepEqual(changeInspectorIds(harness.registry), EXPECTED_IDS)
  } finally {
    await harness.dispose()
  }
})

test('checkCandidate → applyCandidate hot-swaps the checked version without replacePlugin', { timeout: 120_000 }, async () => {
  const harness = await createHarness()
  try {
    await harness.service.setEnabled(PACKAGE_NAME, true)
    const candidate = await stageCandidate(harness, '0.4.0')
    harness.contracts.set(PACKAGE_NAME, contractFor(PACKAGE_NAME, '0.4.0'))

    await harness.service.checkCandidate(PACKAGE_NAME, candidate)
    await harness.service.applyCandidate(PACKAGE_NAME)
    const applied = await harness.service.updateStatus(PACKAGE_NAME)
    assert.equal(applied.version, '0.4.0')
    assert.equal(applied.activationState, 'active')
    assert.deepEqual(changeInspectorIds(harness.registry), EXPECTED_IDS)
  } finally {
    await harness.dispose()
  }
})

test('a candidate with a different package identity is rejected untouched', { timeout: 120_000 }, async () => {
  const harness = await createHarness()
  try {
    await harness.service.setEnabled(PACKAGE_NAME, true)
    const candidate = await stageCandidate(harness, '0.3.0')
    const packagePath = join(candidate, 'package.json')
    const parsed = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>
    parsed.name = '@sciforge/plugin-change-inspector-imposter'
    await writeFile(packagePath, `${JSON.stringify(parsed, null, 2)}\n`)

    await assert.rejects(
      harness.service.checkCandidate(PACKAGE_NAME, candidate),
      /identity mismatch/i
    )
    assert.equal((await harness.service.updateStatus(PACKAGE_NAME)).version, PACKAGE_VERSION)
  } finally {
    await harness.dispose()
  }
})