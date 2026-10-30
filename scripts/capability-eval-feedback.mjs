#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseCapabilityEvalArgs } from './capability-eval-cli-utils.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseCapabilityEvalArgs(process.argv.slice(2))
if (args.help || !args.report) {
  printHelp()
  if (!args.help) process.exitCode = 2
} else if (args.promote) {
  await promoteFeedback(path.resolve(root, args.report), path.resolve(root, args.promote))
} else {
  await collectFeedback(
    path.resolve(root, args.report),
    path.resolve(root, args.output ?? 'eval-cases/capability/trace-feedback.jsonl'),
    args.traceDir ? path.resolve(root, args.traceDir) : undefined
  )
}

async function collectFeedback(reportPath, outputPath, traceDirectory) {
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  if (!Array.isArray(report.cases)) throw new Error(`Evaluation report ${reportPath} does not contain cases.`)
  const existing = await readJsonl(outputPath)
  const existingKeys = new Set(existing.map((entry) => `${entry.source?.reportPath ?? ''}:${entry.caseId}`))
  const candidates = report.cases
    .filter((entry) => entry.outcome !== 'PASS' || entry.actual?.evidenceStatus !== 'complete')
    .filter((entry) => !existingKeys.has(`${reportPath}:${entry.caseId}`))
    .map((entry) => ({
      schemaVersion: 'sciforge.capability-eval.trace-feedback.v1',
      caseId: entry.caseId,
      query: entry.query,
      tags: [...new Set([...(entry.tags ?? []), 'trace-feedback'])],
      status: 'needs-review',
      source: {
        reportPath,
        executionMode: report.executionMode,
        caseId: entry.caseId,
        ...(traceDirectory ? { tracePath: path.resolve(traceDirectory, `${entry.caseId}.jsonl`) } : {})
      },
      observed: {
        outcome: entry.outcome,
        failures: (entry.failures ?? []).map((failure) => failure.type),
        discoveredActions: entry.actual?.discoveredActions ?? entry.discoveredActions ?? [],
        invocations: (entry.actual?.invocations ?? entry.invocations ?? []).map((invocation) => ({
          actionId: invocation.actionId,
          success: invocation.success,
          ...(invocation.errorCode ? { errorCode: invocation.errorCode } : {})
        }))
      },
      review: {
        expectedCase: null,
        oracleEvidence: [],
        reviewer: null,
        reviewedAt: null
      }
    }))
  if (candidates.length === 0) {
    console.log('No new trace feedback candidates.')
    return
  }
  await mkdir(path.dirname(outputPath), { recursive: true })
  await appendFile(outputPath, candidates.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8')
  console.log(`Added ${candidates.length} trace feedback candidates to ${outputPath}.`)
}

async function promoteFeedback(inputPath, outputPath) {
  const rows = await readJsonl(inputPath)
  const { evalCaseSchema } = await import('../src/main/capability-eval/schema.ts')
  const approved = []
  for (const row of rows) {
    if (row.status !== 'approved' || !row.review?.expectedCase) continue
    const parsed = evalCaseSchema.safeParse(row.review.expectedCase)
    if (!parsed.success) throw new Error(`Approved feedback ${row.caseId} has an invalid expectedCase: ${parsed.error.message}`)
    if (parsed.data.id !== row.caseId) throw new Error(`Approved feedback ${row.caseId} must promote an expectedCase with the same id.`)
    approved.push(parsed.data)
  }
  const unique = new Map(approved.map((entry) => [entry.id, entry]))
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, [...unique.values()].map((entry) => JSON.stringify(entry)).join('\n') + (unique.size ? '\n' : ''), 'utf8')
  console.log(`Promoted ${unique.size} reviewed trace cases to ${outputPath}.`)
}

async function readJsonl(filePath) {
  let content
  try { content = await readFile(filePath, 'utf8') } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return []
    throw error
  }
  return content.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line))
}

function printHelp() {
  console.log('Collect failed or evidence-incomplete traces for human review, then promote approved cases.')
  console.log('Usage:')
  console.log('  npm run capability:eval:feedback -- --report <report.json> [--output <feedback.jsonl>] [--trace-dir <dir>]')
  console.log('  npm run capability:eval:feedback:promote -- --report <feedback.jsonl> --promote <cases.jsonl>')
}
