import { spawn, spawnSync } from 'node:child_process'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// No shell, environment dump, retries, or inferred pass from partial output.
export async function runValidation(stages, output) {
  await mkdir(output, { recursive: false }) // every invocation must retain a new report
  const report = { schemaVersion: 1, platform: process.platform, node: process.version, cwd: process.cwd(), startedAt: new Date().toISOString(), status: 'running', stages: [] }
  const save = () => writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await save()
  for (const [index, stage] of stages.entries()) {
    if (!stage.command || !Array.isArray(stage.args) || !Number.isSafeInteger(stage.timeoutMs) || stage.timeoutMs < 1) throw new Error('Explicit command, args and positive timeoutMs required')
    const entry = { name: stage.name, command: stage.command, args: stage.args, timeoutMs: stage.timeoutMs, startedAt: new Date().toISOString(), status: 'running', exitCode: null, signal: null, durationMs: null, stdout: `${index}.stdout.log`, stderr: `${index}.stderr.log` }
    report.stages.push(entry); await save()
    const out = await open(join(output, entry.stdout), 'wx'), err = await open(join(output, entry.stderr), 'wx'), start = performance.now()
    let child, interrupted = false, timedOut = false, spawnError
    const stop = () => {
      if (!child?.pid) return
      if (process.platform === 'win32') {
        const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
        entry.termination = { exitCode: killed.status, error: killed.error?.message ?? null }
      } else { try { process.kill(-child.pid, 'SIGKILL') } catch (e) { entry.termination = { error: e.message } } }
    }
    const onInterrupt = () => { interrupted = true; stop() }
    process.once('SIGINT', onInterrupt); process.once('SIGTERM', onInterrupt)
    const timer = setTimeout(() => { timedOut = true; stop() }, stage.timeoutMs)
    try {
      child = spawn(stage.command, stage.args, { cwd: stage.cwd ?? process.cwd(), stdio: ['ignore', out.fd, err.fd], detached: process.platform !== 'win32', windowsHide: true })
      await new Promise(resolveChild => {
        child.once('error', e => { spawnError = e; resolveChild() })
        child.once('close', (code, signal) => { entry.exitCode = code; entry.signal = signal; resolveChild() })
      })
    } finally {
      clearTimeout(timer); process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onInterrupt)
      await out.close(); await err.close()
      entry.durationMs = Math.round(performance.now() - start)
      entry.status = interrupted ? 'interrupted-unknown' : timedOut ? 'timed-out-unknown' : spawnError ? 'environment-failed' : entry.exitCode === 0 ? 'passed' : 'failed'
      entry.error = spawnError?.message ?? null
      await save()
    }
    if (interrupted || timedOut) break
  }
  report.status = report.stages.length === stages.length && report.stages.every(s => s.status === 'passed') ? 'passed' : 'not-passed'
  report.finishedAt = new Date().toISOString(); await save()
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [output, mode = 'root'] = process.argv.slice(2)
  if (!output || !['root', 'preflight'].includes(mode)) throw new Error('Usage: node scripts/validation-report.mjs <new-output-directory> [root|preflight]')
  const stages = [{ name: 'environment', command: process.execPath, args: ['scripts/validation-preflight.mjs'], timeoutMs: 30000 }]
  if (mode === 'root') stages.push({ name: 'root-vitest', command: process.execPath, args: ['node_modules/vitest/vitest.mjs', 'run'], timeoutMs: 180000 })
  const report = await runValidation(stages, resolve(output))
  console.log(JSON.stringify(report, null, 2)); if (report.status !== 'passed') process.exitCode = 1
}
