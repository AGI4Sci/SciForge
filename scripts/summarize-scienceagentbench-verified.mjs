#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { exists, helpRequested, isMain, readManifest, required, writeJson, validateRecord } from './scientific-benchmark-support.mjs'
export async function summarizeScienceAgentBench(env = process.env) {
  const outputRoot = resolve(required(env, 'SAB_OUTPUT'))
  const manifest = await readManifest(outputRoot)
  const resultDirectory = join(outputRoot, 'results')
  const names = await exists(resultDirectory) ? (await readdir(resultDirectory)).filter(name => name.endsWith('.json')).sort() : []
  const records = [], invalidRecords = []
  for (const name of names) {
    try {
      const record = JSON.parse(await readFile(join(resultDirectory, name), 'utf8'))
      if (name !== `${record.instance_id}.json`) throw new Error('Filename differs from record task ID.')
      validateRecord(record, manifest, outputRoot, record.instance_id)
      records.push(record)
    } catch (error) { invalidRecords.push({ name, error: error.message }) }
  }
  const expected = new Set(manifest.expectedIds)
  const byId = new Map(records.map(record => [record.instance_id, record]))
  const missingIds = manifest.expectedIds.filter(id => !byId.has(id))
  const unexpectedIds = [...byId.keys()].filter(id => !expected.has(id))
  const selected = records.filter(record => expected.has(record.instance_id))
  const countBy = (selector) => Object.fromEntries([...new Set(selected.map(selector))].map(key => [key, selected.filter(record => selector(record) === key).length]))
  const measured = selected.filter(record => record.score?.executionStatus === 'completed' && record.score.metric?.status === 'reported' && [0, 1].includes(record.score.metric.score))
  const passed = measured.filter(record => record.score.metric.score === 1).length
  const summary = {
    generatedAt: new Date().toISOString(), benchmark: manifest.benchmark, model: manifest.model, runtimeId: manifest.runtimeId,
    isolation: manifest.isolation, resultCount: selected.length, expectedCount: expected.size,
    completeRowCoverage: !missingIds.length && !unexpectedIds.length && !invalidRecords.length,
    missingIds, unexpectedIds, invalidRecords, executionStatus: countBy(record => record.agent?.executionStatus ?? 'missing'),
    scorerExecutionStatus: countBy(record => record.score?.executionStatus ?? 'missing'),
    outputCount: selected.filter(record => record.outputExists).length,
    measuredCount: measured.length, passedCount: passed, failedCount: measured.length - passed,
    unmeasuredCount: expected.size - measured.length,
    passRateAmongMeasured: measured.length ? passed / measured.length : null,
    fullRunPassRate: measured.length === expected.size && !unexpectedIds.length && !invalidRecords.length ? passed / expected.size : null
  }
  await writeJson(join(outputRoot, 'summary.json'), summary)
  await writeFile(join(outputRoot, 'summary.md'), [
    `# ${manifest.benchmark} — ${manifest.model} (${manifest.runtimeId})`, '',
    '- Development pilot only: reference files are staged separately, but OS isolation is not enforced.',
    `- Result coverage: ${summary.resultCount}/${summary.expectedCount}`,
    `- Missing IDs: ${missingIds.join(', ') || 'none'}`,
    `- Unexpected IDs: ${unexpectedIds.join(', ') || 'none'}`,
    `- Invalid records: ${invalidRecords.length}`,
    `- Agent execution: ${JSON.stringify(summary.executionStatus)}`,
    `- Scorer execution: ${JSON.stringify(summary.scorerExecutionStatus)}`,
    `- Measured pass/fail: ${passed}/${summary.failedCount}; unmeasured: ${summary.unmeasuredCount}`,
    `- Pass rate among measured: ${summary.passRateAmongMeasured ?? 'unavailable'}`,
    `- Full-run pass rate: ${summary.fullRunPassRate ?? 'unavailable (incomplete scoring)'}`,
    '', 'A completed scorer process is not a passed task. Full scorer stdout/stderr are in `scorer-logs/`.', ''
  ].join('\n'), { mode: 0o600 })
  return summary
}
if (isMain(import.meta.url)) {
  if (!helpRequested('Run: SAB_OUTPUT=... node scripts/summarize-scienceagentbench-verified.mjs\nUses manifest task IDs and configuration; does not contact models. See docs/scientific-benchmark-runners.md.')) console.log(JSON.stringify(await summarizeScienceAgentBench(), null, 2))
}
