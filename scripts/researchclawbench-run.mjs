#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { createBenchmarkRuntime, executeBenchmarkTask, helpRequested, isMain, isolation, positiveInteger, plainPath, repositoryRoot, required, runtimeConfig, safeId, separateRoots, writeJson } from './scientific-benchmark-support.mjs'
export async function runResearchClawBench(env = process.env, runtimeFactory = createBenchmarkRuntime) {
  const taskId = safeId(required(env, 'RCB_TASK_ID'))
  // Validate before resolve(): resolve('') would silently select the repository.
  const workspace = resolve(required(env, 'RCB_WORKSPACE'))
  const model = required(env, 'RCB_MODEL')
  const outputRoot = resolve(env.RCB_OUTPUT?.trim() || join(repositoryRoot, 'eval-results/researchclawbench'))
  const timeoutMs = positiveInteger(env.RCB_TIMEOUT_MS, 'RCB_TIMEOUT_MS', 1_800_000)
  const options = runtimeConfig(env)
  await separateRoots(workspace, outputRoot)
  const instructions = await readFile(join(workspace, 'INSTRUCTIONS.md'), 'utf8')
  if (!instructions.trim()) throw new Error('INSTRUCTIONS.md is empty.')
  const reportPath = join(workspace, 'report/report.md')
  async function reportState() {
    try {
      await plainPath(workspace, 'report/report.md')
      const info = await stat(reportPath, { bigint: true })
      return info.isFile() && info.size > 0n ? `${info.ino}:${info.size}:${info.mtimeNs}` : null
    } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  const reportBefore = await reportState()
  const runtime = await runtimeFactory(options)
  const startedAt = new Date().toISOString()
  const runId = randomUUID()
  const prefix = `${taskId}-${runId}`
  const tracePath = join(outputRoot, `${prefix}.trace.json`)
  let trace
  try {
    trace = await executeBenchmarkTask({ runtime, runtimeId: options.runtimeId, model, timeoutMs, id: `researchclawbench-${taskId}`, query: instructions, workspace, tracePath })
  } finally { await runtime.close() }
  const reportAfter = await reportState()
  const reportExists = reportAfter !== null
  const reportChanged = reportAfter !== null && reportAfter !== reportBefore
  const record = { taskId, runId, runtimeId: options.runtimeId, model, workspace, startedAt, finishedAt: new Date().toISOString(),
    isolation, executionStatus: trace.executionStatus, executionError: trace.executionError ?? null,
    reportExists, reportChanged, reportPath, tracePath, benchmarkScore: null }
  await writeJson(join(outputRoot, `${prefix}.json`), record)
  if (trace.executionStatus !== 'completed' || !reportChanged) throw new Error(`ResearchClawBench task ${taskId}: execution=${trace.executionStatus}, reportExists=${reportExists}, reportChanged=${reportChanged}. See ${tracePath}.`)
  // Report generation is not a benchmark grade; run the upstream grader separately.
  return record
}
if (isMain(import.meta.url)) {
  if (!helpRequested('Run: node --import tsx scripts/researchclawbench-run.mjs\nRequired: RCB_TASK_ID, RCB_WORKSPACE, RCB_MODEL. Optional: RCB_OUTPUT, RCB_TIMEOUT_MS. See docs/scientific-benchmark-runners.md.')) console.log(JSON.stringify(await runResearchClawBench(), null, 2))
}
