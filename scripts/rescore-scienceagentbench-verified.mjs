#!/usr/bin/env node
import { join, resolve } from 'node:path'
import { exists, inside, helpRequested, isMain, readJson, readManifest, required, safeId, scorerConfig, scoreScienceAgentBenchWorkspace, writeJson, validateRecord, validateScorerConfiguration } from './scientific-benchmark-support.mjs'
export async function rescoreScienceAgentBench(env = process.env, ids = []) {
  const outputRoot = resolve(required(env, 'SAB_OUTPUT'))
  const manifest = await readManifest(outputRoot)
  const requested = ids.length ? [...new Set(ids.map(safeId))] : manifest.expectedIds
  const scorer = scorerConfig(env)
  for (const id of requested) {
    if (!manifest.expectedIds.includes(id)) throw new Error(`Unknown task ID: ${id}`)
  }
  await validateScorerConfiguration(scorer, env)
  for (const id of requested) {
    const resultPath = join(outputRoot, 'results', `${id}.json`)
    if (!(await exists(resultPath))) continue
    const record = await readJson(resultPath)
    validateRecord(record, manifest, outputRoot, id)
    if (record.agent?.executionStatus !== 'completed') continue
    record.outputExists = await exists(inside(record.workspace, record.output_fname))
    record.score = record.outputExists
      ? await scoreScienceAgentBenchWorkspace({ row: record, workspace: record.workspace, benchmarkRoot: manifest.benchmarkRoot, outputRoot, ...scorer, env })
      : { executionStatus: 'not-run', metric: { status: 'unavailable', score: null, reason: null } }
    await writeJson(resultPath, record)
    console.log(JSON.stringify({ instance_id: id, score: record.score }))
  }
}
if (isMain(import.meta.url)) {
  if (!helpRequested('Run: SAB_OUTPUT=... node scripts/rescore-scienceagentbench-verified.mjs [task-id ...]\nOptional: SAB_PYTHON, SAB_VISUAL_JUDGE, SAB_SCORER_TIMEOUT_MS. No Agent/model calls. See docs/scientific-benchmark-runners.md.', true)) await rescoreScienceAgentBench(process.env, process.argv.slice(2))
}
