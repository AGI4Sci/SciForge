#!/usr/bin/env node
import { join, resolve } from 'node:path'
import {
  createBenchmarkRuntime, ensureManifest, executeBenchmarkTask, exists, helpRequested, isMain, isolation,
  loadScienceAgentBenchRows, positiveInteger, prepareScienceAgentBenchWorkspace, readJson,
  repositoryRoot, required, runtimeConfig, scoreScienceAgentBenchWorkspace, scorerConfig,
  separateRoots, writeJson, inside, validateRecord, validateScorerConfiguration, plainPath
} from './scientific-benchmark-support.mjs'
export async function runScienceAgentBench(env = process.env, runtimeFactory = createBenchmarkRuntime) {
  const rowsPath = resolve(required(env, 'SAB_ROWS'))
  const benchmarkRoot = resolve(required(env, 'SAB_BENCHMARK'))
  const outputRoot = resolve(env.SAB_OUTPUT?.trim() || join(repositoryRoot, 'eval-results/scienceagentbench-verified'))
  const model = required(env, 'SAB_MODEL')
  const runtimeOptions = runtimeConfig(env)
  const timeoutMs = positiveInteger(env.SAB_TIMEOUT_MS, 'SAB_TIMEOUT_MS', 300_000)
  const scorer = scorerConfig(env)
  await separateRoots(benchmarkRoot, outputRoot)
  const { rows, datasetDigest } = await loadScienceAgentBenchRows(rowsPath, env)
  await validateScorerConfiguration(scorer, env)
  for (const row of rows) await plainPath(benchmarkRoot, `eval_programs/${row.eval_script_name}`)
  const manifest = await ensureManifest(outputRoot, {
    benchmark: 'ScienceAgentBench verified', benchmarkRoot, datasetDigest, model,
    runtimeId: runtimeOptions.runtimeId, expectedIds: rows.map(row => String(row.instance_id)),
    timeoutMs, scorer
  })
  const runtime = await runtimeFactory(runtimeOptions)
  try {
    for (const row of rows) {
      const id = String(row.instance_id)
      const resultPath = join(outputRoot, 'results', `${id}.json`)
      if (await exists(resultPath)) {
        const previous = await readJson(resultPath)
        validateRecord(previous, manifest, outputRoot, id)
        if (previous.agent?.executionStatus === 'completed' && previous.score?.executionStatus === 'completed' &&
          await exists(inside(previous.workspace, previous.output_fname))) continue
      }
      const workspace = await prepareScienceAgentBenchWorkspace(row, benchmarkRoot, join(outputRoot, 'workspaces'))
      const query = `Solve this scientific analysis task inside this workspace. Data is under benchmark/datasets. Write and run a reproducible solution and produce the exact requested output. Do not access evaluator programs, gold results, reference solutions, or files outside this workspace. Keep computation bounded.\n\nTask:\n${row.task_inst}\n\nRequired output: ${row.output_fname}`
      const agent = await executeBenchmarkTask({
        runtime, runtimeId: runtimeOptions.runtimeId, model, timeoutMs, id: `scienceagentbench-${id}`,
        query, workspace, tracePath: join(outputRoot, 'traces', `${id}.json`)
      })
      const outputExists = await exists(inside(workspace, row.output_fname))
      // A timed-out or unconfirmed turn is never scored while it may still be writing artifacts.
      const score = agent.executionStatus === 'completed' && outputExists
        ? await scoreScienceAgentBenchWorkspace({ row, workspace, benchmarkRoot, outputRoot, ...scorer, env })
        : { executionStatus: 'not-run', metric: { status: 'unavailable', score: null, reason: null } }
      const record = {
        schemaVersion: 1, instance_id: id, datasetDigest, model, runtimeId: manifest.runtimeId,
        isolation, domain: row.domain, task_inst: row.task_inst, output_fname: row.output_fname,
        eval_script_name: row.eval_script_name, workspace, agent, score, outputExists
      }
      await writeJson(resultPath, record)
      console.log(JSON.stringify({ instance_id: id, agent: agent.executionStatus, score, outputExists }))
    }
  } finally { await runtime.close() }
}
if (isMain(import.meta.url)) {
  if (!helpRequested('Run: node --import tsx scripts/run-scienceagentbench-verified.mjs\nRequired: SAB_ROWS, SAB_BENCHMARK, SAB_MODEL. See docs/scientific-benchmark-runners.md.')) await runScienceAgentBench()
}
