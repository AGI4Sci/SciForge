import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REQUIRED_RUN0_BUILD_PATHS,
  assertRun0CandidateContract,
  assertSupportedNodeVersion,
  githubRepositorySlug,
  parseRun0ParticipantOptions,
  pathIsInside
} from './run0-source-participant.mjs'

const COMMIT = 'a'.repeat(40)

test('checks the canonical Electron source build outputs', () => {
  assert.deepEqual(REQUIRED_RUN0_BUILD_PATHS, [
    'out/main/index.js',
    'out/preload/index.cjs',
    'out/renderer/index.html'
  ])
})

test('parses the frozen five-person check and launch inputs', () => {
  assert.deepEqual(parseRun0ParticipantOptions([
    'check', '--expected-commit', COMMIT, '--role', 'U2'
  ]), {
    command: 'check',
    expectedCommit: COMMIT,
    role: 'U2'
  })
  assert.deepEqual(parseRun0ParticipantOptions([
    'launch', '--expected-commit', COMMIT, '--role', 'U4',
    '--profile-dir', '/tmp/sciforge-run0-u4'
  ]), {
    command: 'launch',
    expectedCommit: COMMIT,
    role: 'U4',
    profileDir: '/tmp/sciforge-run0-u4'
  })
})

test('rejects mutable commit aliases, unknown roles, and relative profiles', () => {
  assert.throws(
    () => parseRun0ParticipantOptions(['check', '--expected-commit', 'HEAD']),
    /exact 40-character/u
  )
  assert.throws(
    () => parseRun0ParticipantOptions([
      'launch', '--expected-commit', COMMIT, '--role', 'U5',
      '--profile-dir', '/tmp/sciforge-run0-u5'
    ]),
    /U0, U1, U2, U3, or U4/u
  )
  assert.throws(
    () => parseRun0ParticipantOptions([
      'launch', '--expected-commit', COMMIT, '--role', 'U1',
      '--profile-dir', 'relative-profile'
    ]),
    /absolute path/u
  )
})

test('accepts only the team Fork remote forms', () => {
  assert.equal(
    githubRepositorySlug('https://github.com/SCU-areszhang/SciForge_Loop.git'),
    'SCU-areszhang/SciForge_Loop'
  )
  assert.equal(
    githubRepositorySlug('git@github.com:SCU-areszhang/SciForge_Loop.git'),
    'SCU-areszhang/SciForge_Loop'
  )
  assert.equal(githubRepositorySlug('https://example.com/team/repo.git'), null)
})

test('enforces supported Node lines and profile containment checks', () => {
  assert.equal(assertSupportedNodeVersion('22.12.0'), '22.12.0')
  assert.equal(assertSupportedNodeVersion('24.0.0'), '24.0.0')
  assert.throws(() => assertSupportedNodeVersion('23.11.0'), /requires Node\.js/u)
  assert.equal(pathIsInside('/repo', '/repo/profile'), true)
  assert.equal(pathIsInside('/repo', '/profiles/u0'), false)
})

test('accepts only the unauthenticated candidate collaboration contract boundary', () => {
  const requestId = 'req_Run0Candidate01'
  assert.equal(assertRun0CandidateContract({
    protocolVersion: '1.0',
    requestId,
    error: { code: 'authentication_required' }
  }, requestId), 'worker.availability.list')
  assert.throws(() => assertRun0CandidateContract({
    protocolVersion: '1.0',
    requestId,
    error: { code: 'validation_error' }
  }, requestId), /does not expose the frozen candidate/u)
})
