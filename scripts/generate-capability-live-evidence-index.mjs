#!/usr/bin/env node

import { access, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const planPath = path.join(root, 'eval-cases/capability/action-directed-plan.jsonl')
const resultsPath = path.join(root, 'eval-results')
const indexPath = path.join(root, 'eval-cases/capability/live-evidence-index.jsonl')
const markdownPath = path.join(root, 'docs/generated/capability-live-evidence-index.md')
const checkOnly = process.argv.includes('--check')

const plan = (await readJsonl(planPath)).sort((left, right) => left.actionId.localeCompare(right.actionId))
const liveObservations = await loadLiveObservations()
const index = plan.map((entry) => createIndexEntry(entry, liveObservations.get(entry.actionId)))
const indexContent = `${index.map((entry) => JSON.stringify(entry)).join('\n')}\n`
const markdownContent = renderMarkdown(index)

if (checkOnly) {
  const [currentIndex, currentMarkdown] = await Promise.all([
    readFile(indexPath, 'utf8'),
    readFile(markdownPath, 'utf8')
  ])
  if (currentIndex !== indexContent || currentMarkdown !== markdownContent) {
    throw new Error('Live evidence index is stale. Run npm run capability:eval:live-index.')
  }
  console.log(`Verified live evidence index for ${index.length} Agent-visible actions.`)
} else {
  await writeFile(indexPath, indexContent, 'utf8')
  await writeFile(markdownPath, markdownContent, 'utf8')
  const counts = countBy(index, (entry) => entry.status)
  console.log(`Indexed live evidence for ${index.length} Agent-visible actions: ${formatCounts(counts)}.`)
}

function createIndexEntry(planEntry, observation = {}) {
  const statuses = new Set(observation.statuses ?? [])
  const status = statuses.has('outcome-verified')
    ? 'outcome-verified'
    : statuses.has('invocation-succeeded')
      ? 'invocation-succeeded'
      : statuses.has('invoked')
        ? 'invoked'
        : 'no-live-evidence'
  return {
    schemaVersion: 'sciforge.capability-eval.live-evidence-index.v1',
    actionId: planEntry.actionId,
    owner: planEntry.owner,
    batch: planEntry.batch,
    effect: planEntry.effect,
    approval: planEntry.approval,
    designStatus: {
      fixture: planEntry.fixture?.status,
      oracle: planEntry.oracle?.status,
      boundary: planEntry.boundary?.status
    },
    status,
    liveEvidence: {
      observedInvocationCount: observation.observedInvocationCount ?? 0,
      successfulInvocationCount: observation.successfulInvocationCount ?? 0,
      outcomeVerifiedCount: observation.outcomeVerifiedCount ?? 0,
      passedCaseIds: observation.passedCaseIds ?? [],
      failedCaseIds: observation.failedCaseIds ?? [],
      representativeRunDirectories: observation.representativeRunDirectories ?? [],
      failureTypes: observation.failureTypes ?? []
    }
  }
}

async function loadLiveObservations() {
  const observations = new Map()
  let entries
  try {
    entries = await readdir(resultsPath, { withFileTypes: true })
  } catch {
    return observations
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const reportPath = path.join(resultsPath, entry.name, 'latest.json')
    try {
      await access(reportPath)
      const report = JSON.parse(await readFile(reportPath, 'utf8'))
      if (report.executionMode !== 'live-agent') continue
      for (const result of report.cases ?? []) {
        const actual = result.actual ?? {}
        const invoked = new Set([
          ...(actual.invocations ?? []).map((invocation) => invocation.actionId),
          ...(actual.selectedActions ?? []).map((action) => typeof action === 'string' ? action : action?.actionId),
          ...(actual.verifiedActionIds ?? [])
        ].filter(Boolean))
        const successful = new Set((actual.invocations ?? []).filter((invocation) => invocation.success === true).map((invocation) => invocation.actionId))
        const verified = result.passed === true ? new Set(actual.verifiedActionIds ?? []) : new Set()
        for (const actionId of invoked) {
          const observation = observations.get(actionId) ?? createObservation()
          observation.observedInvocationCount += 1
          observation.statuses.add(verified.has(actionId) ? 'outcome-verified' : successful.has(actionId) ? 'invocation-succeeded' : 'invoked')
          if (successful.has(actionId)) observation.successfulInvocationCount += 1
          if (verified.has(actionId)) observation.outcomeVerifiedCount += 1
          if (result.passed === true) observation.passedCaseIds.add(result.caseId)
          else observation.failedCaseIds.add(result.caseId)
          observation.failureTypes.push(...(result.failures ?? []).map((failure) => failure.type).filter(Boolean))
          observation.representativeRunDirectories.add(entry.name)
          observations.set(actionId, observation)
        }
      }
    } catch {
      // Partial or malformed result directories are not usable live evidence.
    }
  }
  for (const observation of observations.values()) {
    observation.passedCaseIds = [...observation.passedCaseIds].sort()
    observation.failedCaseIds = [...observation.failedCaseIds].sort()
    observation.representativeRunDirectories = [...observation.representativeRunDirectories].sort().slice(-3)
    observation.failureTypes = [...new Set(observation.failureTypes)].sort().slice(0, 8)
    observation.statuses = [...observation.statuses]
  }
  return observations
}

function createObservation() {
  return {
    statuses: new Set(),
    observedInvocationCount: 0,
    successfulInvocationCount: 0,
    outcomeVerifiedCount: 0,
    passedCaseIds: new Set(),
    failedCaseIds: new Set(),
    representativeRunDirectories: new Set(),
    failureTypes: []
  }
}

function renderMarkdown(index) {
  const counts = countBy(index, (entry) => entry.status)
  const batchSummary = summarizeBatches(index)
  const verified = index.filter((entry) => entry.status === 'outcome-verified')
  const lines = [
    '# Capability live evidence index',
    '',
    `This index contains all ${index.length} Agent-visible actions. Current live evidence is ${formatCounts(counts)}. Only \`outcome-verified\` means an accepted action result; invocation success alone is not outcome verification.`,
    '',
    '| Batch | Actions | Design-ready | Outcome-verified | Invocation-succeeded | Invoked | No live evidence |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(batchSummary).sort(([left], [right]) => left.localeCompare(right)).map(([batch, summary]) => `| ${batch} | ${summary.total} | ${summary.designReady} | ${summary.outcomeVerified} | ${summary.invocationSucceeded} | ${summary.invoked} | ${summary.noLiveEvidence} |`),
    '',
    '| Action | Owner | Batch | Effect | Approval | Live status | Passed cases | Representative runs | Failure types |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...index.map((entry) => `| \`${entry.actionId}\` | ${entry.owner} | ${entry.batch} | ${entry.effect} | ${entry.approval} | ${entry.status} | ${entry.liveEvidence.passedCaseIds.join(', ') || '—'} | ${entry.liveEvidence.representativeRunDirectories.join(', ') || '—'} | ${entry.liveEvidence.failureTypes.join(', ') || '—'} |`),
    '',
    `Accepted outcome-verified actions (${verified.length}): ${verified.map((entry) => `\`${entry.actionId}\``).join(', ') || 'none'}.`,
    '',
    `This is an evidence index, not a readiness report. Planned, blocked, failed and unobserved actions remain in the ${index.length}-action denominator.`,
    ''
  ]
  return lines.join('\n')
}

function summarizeBatches(index) {
  const summary = {}
  for (const entry of index) {
    const batch = summary[entry.batch] ?? {
      total: 0,
      designReady: 0,
      outcomeVerified: 0,
      invocationSucceeded: 0,
      invoked: 0,
      noLiveEvidence: 0
    }
    batch.total += 1
    if (entry.designStatus.fixture === 'ready' && entry.designStatus.oracle === 'ready') batch.designReady += 1
    if (entry.status === 'outcome-verified') batch.outcomeVerified += 1
    if (entry.status === 'invocation-succeeded') batch.invocationSucceeded += 1
    if (entry.status === 'invoked') batch.invoked += 1
    if (entry.status === 'no-live-evidence') batch.noLiveEvidence += 1
    summary[entry.batch] = batch
  }
  return summary
}

async function readJsonl(filePath) {
  const content = await readFile(filePath, 'utf8')
  return content.split(/\r?\n/u).filter((line) => line.trim().length > 0).map((line, index) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`Invalid JSONL at ${path.relative(root, filePath)}:${index + 1}: ${error.message}`)
    }
  })
}

function countBy(values, selector) {
  return values.reduce((counts, value) => {
    const key = selector(value)
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}

function formatCounts(counts) {
  return Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join(', ')
}
