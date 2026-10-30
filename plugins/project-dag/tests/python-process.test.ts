import { expect, test } from 'vitest'
import { chmod, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProjectDagPythonProcess } from '../src/python-process.js'
import { ProjectDagCore } from '../../../packages/domains/project-dag/src/core/index.js'

test('concurrent compound Goal saves keep their own titles through the canonical core', async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'project-goals-'))
  const evidence = join(root, 'evidence'); await mkdir(evidence)
  const options = { python: process.env.PROJECT_DAG_PYTHON!, db: join(root, 'project.db'), evidence,
    workspace: root, environment: { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } }
  const python = new ProjectDagPythonProcess(options)
  const port = { serviceUrl: 'http://127.0.0.1:3898', request: (...args: Parameters<typeof python.request>) => python.request(...args) }
  try {
    const a = new ProjectDagCore(port as never), b = new ProjectDagCore(port as never)
    const results = await Promise.all([a.saveGoal({ workspaceRoot: root, title: 'Goal A' }),
      b.saveGoal({ projectRoot: root + '/.', title: 'Goal B' })])
    expect(results.map(result => result.goal.title)).toEqual(['Goal A', 'Goal B'])
  } finally { await python.close() }
  expect(() => process.kill(python.pid!, 0)).toThrow()
  const restart = new ProjectDagPythonProcess(options)
  try {
    const old = await restart.request('/goals?workspaceRoot=' + encodeURIComponent(root), 'GET') as { title: string }[]
    expect(old.map(goal => goal.title).sort()).toEqual(['Goal A', 'Goal B'])
  } finally { await restart.close() }
})

test('real wheel process reads a goal written before restart and exits after close', async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'project-process-'))
  const evidence = join(root, 'evidence')
  await mkdir(evidence)
  const options = { python: process.env.PROJECT_DAG_PYTHON!, db: join(root, 'project.db'), evidence,
    workspace: root, environment: { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } }
  const first = new ProjectDagPythonProcess(options)
  await first.request('/goals/draft', 'POST', { workspaceRoot: root, title: 'Old durable goal' })
  const pid = first.pid
  await first.close()
  expect(() => process.kill(pid!, 0)).toThrow()
  const second = new ProjectDagPythonProcess(options)
  try {
    const old = await second.request(`/goals/draft?workspaceRoot=${encodeURIComponent(root)}`, 'GET')
    expect(old).toMatchObject({ title: 'Old durable goal' })
  } finally { await second.close() }
})

test('an unattributable protocol line is dropped without killing the sidecar', async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'project-noise-'))
  // Synthetic sidecar: answers each request, but emits one unattributable
  // id=null error line after the first request, exactly as runtime_stdio does
  // for a malformed frame it cannot attribute.
  const script = join(root, 'noise.py')
  await writeFile(script, `import json, sys
for line in sys.stdin:
    try:
        req = json.loads(line)
    except Exception:
        continue
    rid = req.get('id')
    sys.stdout.write(json.dumps({'id': rid, 'ok': True, 'data': 'answer-' + str(rid)}) + '\\n')
    if rid == 1:
        sys.stdout.write(json.dumps({'id': None, 'ok': False, 'error': {'name': 'JSONDecodeError', 'message': 'bad frame'}}) + '\\n')
    sys.stdout.flush()
`)
  const wrapper = join(root, 'fake-python')
  await writeFile(wrapper, `#!/bin/sh\nexec /usr/bin/python3 -u "${script}"\n`)
  await chmod(wrapper, 0o755)
  const python = new ProjectDagPythonProcess({ python: wrapper, db: join(root, 'p.db'),
    evidence: root, workspace: root, environment: { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
    closeTimeoutMs: 2000 })
  const pid = python.pid
  const first = await python.request('/updates/status', 'GET', { workspaceRoot: root })
  expect(first).toBe('answer-1')
  // The unattributable line must not reject unrelated in-flight or later
  // requests and must not execute the sidecar.
  const second = await python.request('/updates/status', 'GET', { workspaceRoot: root })
  expect(second).toBe('answer-2')
  expect(() => process.kill(pid!, 0)).not.toThrow()
  await python.close()
  expect(() => process.kill(pid!, 0)).toThrow()
})
