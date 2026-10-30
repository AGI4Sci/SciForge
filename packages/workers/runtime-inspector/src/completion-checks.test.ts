import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { COMPLETION_CHECK_MAX_FILE_BYTES, COMPLETION_CHECK_REGEX_TIMEOUT_MS } from './completion-checks.js'
import { createRuntimeInspectorService } from './service.js'

test('runs configurable completion checks with blocking and non-blocking findings', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'completion-checks-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'paper'), { recursive: true })
  const documentPath = join(root, 'paper', 'report.tex')
  const original = [
    '\\title{SciForge}',
    'The repository contains 197 commits.',
    'Independent audit: 197 commits.'
  ].join('\n')
  await writeFile(documentPath, original, 'utf8')
  await writeFile(join(root, 'paper', 'report.log'), [
    'This is pdfTeX',
    'Overfull \\hbox (2.0pt too wide) in paragraph at lines 1--2'
  ].join('\n'), 'utf8')
  await writeFile(join(root, 'paper', 'report.pdf'), '%PDF fixture', 'utf8')

  const service = createRuntimeInspectorService({ workspaceRoot: await realpath(root) })
  const result = await service.completionChecks({
    files: [{
      path: 'paper/report.tex',
      required: [
        { pattern: 'SciForge', label: 'product identity' },
        { pattern: '\\\\title\\{[^}]+\\}', mode: 'regex', label: 'title exists' }
      ],
      forbidden: [{ pattern: 'TODO', blocking: true }]
    }],
    file_exists: [{ path: 'paper/report.pdf', label: 'compiled PDF' }],
    capture_equalities: [{
      label: 'commit count is consistent',
      sources: [{ path: 'paper/report.tex', pattern: '(\\d+) commits', group: 1 }],
      normalize: 'number'
    }],
    latex_logs: [{
      path: 'paper/report.log',
      errors: { max: 0 },
      undefined_references: { max: 0 },
      overfull_boxes: { max: 0, blocking: false }
    }]
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.passed, true)
  assert.equal(result.clean, false)
  assert.equal(result.summary.blockingFindings, 0)
  assert.equal(result.summary.nonBlockingFindings, 1)
  assert.equal(result.findings[0]?.kind, 'latex_overfull_boxes')
  assert.equal(result.boundaries.shellExecution, 'disabled')
  assert.equal(result.boundaries.readOnly, true)
  assert.equal(await readFile(documentPath, 'utf8'), original)
})

test('reports missing text, forbidden text, and inconsistent captures as blocking', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'completion-check-failures-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'report.txt'), 'Version: 22\nRows: 197\nRows: 199\nPLACEHOLDER\n', 'utf8')
  const service = createRuntimeInspectorService({ workspaceRoot: root })

  const result = await service.completionChecks({
    files: [{
      path: 'report.txt',
      required: [{ pattern: 'Evidence DAG' }],
      forbidden: [{ pattern: 'PLACEHOLDER' }]
    }],
    file_exists: [{ path: 'missing.pdf' }],
    capture_equalities: [{
      label: 'row counts',
      sources: [{ path: 'report.txt', pattern: 'Rows: (\\d+)' }],
      normalize: 'number'
    }]
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.passed, false)
  assert.equal(result.clean, false)
  assert.deepEqual(
    new Set(result.findings.map((finding) => finding.kind)),
    new Set(['required_text_missing', 'forbidden_text_present', 'file_missing', 'capture_mismatch'])
  )
  assert.equal(result.summary.blockingFindings, 4)
})

test('enforces workspace sandbox, symlink boundaries, regex safety, and file limits', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'completion-check-security-'))
  t.after(async () => rm(tempRoot, { recursive: true, force: true }))
  const workspace = join(tempRoot, 'workspace')
  await mkdir(workspace)
  await writeFile(join(tempRoot, 'secret.txt'), 'SECRET', 'utf8')
  await symlink(join(tempRoot, 'secret.txt'), join(workspace, 'outside-link.txt'))
  await writeFile(join(workspace, 'large.txt'), 'x'.repeat(64), 'utf8')
  await writeFile(join(workspace, 'safe.txt'), 'aaaa', 'utf8')
  const service = createRuntimeInspectorService({ workspaceRoot: workspace })

  for (const path of ['../secret.txt', 'outside-link.txt']) {
    const escaped = await service.completionChecks({
      files: [{ path, required: [{ pattern: 'SECRET' }] }]
    })
    assert.equal(escaped.ok, false)
    if (!escaped.ok) assert.equal(escaped.error.code, 'path_outside_repository')
  }

  const limited = await service.completionChecks({
    max_file_bytes: 16,
    files: [{ path: 'large.txt', required: [{ pattern: 'x' }] }]
  })
  assert.equal(limited.ok, true)
  if (limited.ok) {
    assert.equal(limited.passed, false)
    assert.equal(limited.findings[0]?.kind, 'file_too_large')
  }

  const unsafeRegex = await service.completionChecks({
    files: [{ path: 'safe.txt', required: [{ pattern: '(a+)+$', mode: 'regex' }] }]
  })
  assert.equal(unsafeRegex.ok, false)
  if (!unsafeRegex.ok) assert.equal(unsafeRegex.error.code, 'invalid_request')
})

test('rejects ambiguous repeated-alternation bypass corpus before execution', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'completion-check-regex-corpus-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'input.txt'), `${'a'.repeat(10_000)}!`, 'utf8')
  const service = createRuntimeInspectorService({ workspaceRoot: root })

  const bypassCorpus = [
    '^(a|aa)+$',
    '^(?:\\w|\\w\\w)+$',
    '^(a|a?)+$',
    '^(foo|foobar){1,}$'
  ]
  for (const pattern of bypassCorpus) {
    const result = await service.completionChecks({
      files: [{ path: 'input.txt', required: [{ pattern, mode: 'regex' }] }]
    })
    assert.equal(result.ok, false, pattern)
    if (!result.ok) {
      assert.equal(result.error.code, 'invalid_request', pattern)
      assert.match(result.error.reason, /rejected/i, pattern)
    }
  }
})

test('isolates an unrecognized catastrophic regex behind a hard timeout', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'completion-check-regex-timeout-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'input.txt'), `${'a'.repeat(50_000)}!`, 'utf8')
  const service = createRuntimeInspectorService({ workspaceRoot: root })

  let eventLoopAdvanced = false
  const resultPromise = service.completionChecks({
    files: [{ path: 'input.txt', required: [{ pattern: '^(?:(a|aa))+$', mode: 'regex' }] }]
  })
  await new Promise<void>((resolve) => setTimeout(() => {
    eventLoopAdvanced = true
    resolve()
  }, 25))
  const startedWaitingAt = Date.now()
  const result = await resultPromise

  assert.equal(eventLoopAdvanced, true)
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.code, 'invalid_request')
    assert.match(result.error.reason, /execution limit/i)
  }
  assert.ok(Date.now() - startedWaitingAt < COMPLETION_CHECK_REGEX_TIMEOUT_MS * 3)
})

test('keeps legal regex flags and numeric and named captures on maximum-sized input', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'completion-check-regex-valid-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const prefix = 'x'.repeat(COMPLETION_CHECK_MAX_FILE_BYTES - 32)
  await writeFile(join(root, 'input.txt'), `${prefix}\nResult: 00197\nEND`, 'utf8')
  const service = createRuntimeInspectorService({ workspaceRoot: root })

  const result = await service.completionChecks({
    max_file_bytes: COMPLETION_CHECK_MAX_FILE_BYTES,
    files: [{
      path: 'input.txt',
      required: [
        { pattern: '^result: \\d+$', mode: 'regex', flags: 'im' },
        { pattern: 'END$', mode: 'regex' },
        { pattern: '^(foo|bar)+$', mode: 'regex', blocking: false }
      ]
    }],
    capture_equalities: [{
      label: 'named capture remains supported',
      sources: [{ path: 'input.txt', pattern: 'Result: (?<count>\\d+)', group: 'count' }],
      normalize: 'number'
    }]
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.passed, true)
  assert.equal(result.summary.checksPassed, 3)
  assert.equal(result.summary.nonBlockingFindings, 1)
  assert.equal(result.findings[0]?.kind, 'required_text_missing')
})

test('returns invalid_request for syntactically invalid regexes without running them in-process', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'completion-check-regex-invalid-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'input.txt'), 'safe', 'utf8')
  const service = createRuntimeInspectorService({ workspaceRoot: root })

  const result = await service.completionChecks({
    files: [{ path: 'input.txt', required: [{ pattern: '[unterminated', mode: 'regex' }] }]
  })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.code, 'invalid_request')
    assert.match(result.error.reason, /invalid completion-check regex/i)
  }
})
