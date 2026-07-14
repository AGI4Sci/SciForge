#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)

if (args.length !== 2 && args.length !== 3) {
  console.error('Usage:')
  console.error('  transcript-diff <dataDir> <threadA> <threadB>')
  console.error('  transcript-diff <eventsA.jsonl> <eventsB.jsonl>')
  process.exit(2)
}

const [leftPath, rightPath] = args.length === 2
  ? [resolve(args[0]), resolve(args[1])]
  : [
      join(resolve(args[0]), 'threads', args[1], 'events.jsonl'),
      join(resolve(args[0]), 'threads', args[2], 'events.jsonl')
    ]

const [left, right] = await Promise.all([
  summarizeEvents(leftPath),
  summarizeEvents(rightPath)
])

printMarkdownTable(left, right)

async function summarizeEvents(path) {
  const events = await readJsonl(path)
  const usageEvents = events.filter((event) => event.kind === 'usage' && event.usage)
  // Usage events contain the thread's cumulative snapshot, not per-step deltas.
  // Taking the latest event avoids multiplying early usage across model steps.
  const summary = usageSnapshot(usageEvents.at(-1)?.usage)
  const terminals = events.filter((event) =>
    event.kind === 'turn_completed' || event.kind === 'turn_failed' || event.kind === 'turn_aborted'
  )
  const count = (predicate) => events.filter(predicate).length
  const toolCalls = count((event) => event.kind === 'tool_call_ready')
  const suppressedTools = count((event) => event.kind === 'tool_storm_suppressed')
  const modelSteps = count((event) =>
    event.kind === 'pipeline_stage' && event.stage === 'pre_send'
  ) || usageEvents.length
  return {
    path,
    usage: summary,
    quality: {
      turns: count((event) => event.kind === 'turn_started'),
      completed: terminals.filter((event) => event.kind === 'turn_completed').length,
      failed: terminals.filter((event) => event.kind === 'turn_failed').length,
      aborted: terminals.filter((event) => event.kind === 'turn_aborted').length,
      modelSteps,
      toolCalls,
      executedTools: Math.max(0, toolCalls - suppressedTools),
      suppressedTools,
      stuckStops: count((event) => event.kind === 'error' && event.code === 'agent_stuck'),
      budgetExhaustions: count((event) =>
        event.kind === 'error' && event.code === 'tool_budget_exhausted'
      ),
      steeringCorrections: count((event) => event.kind === 'turn_steered'),
      approvalRequests: count((event) => event.kind === 'approval_requested'),
      compactions: count((event) => event.kind === 'compaction_completed')
    }
  }
}

async function readJsonl(path) {
  const text = await readFile(path, 'utf8')
  const out = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed))
    } catch {
      // Skip malformed lines; transcript diff should be diagnostic, not brittle.
    }
  }
  return out
}

function usageSnapshot(usage = {}) {
  const promptTokens = Number(usage.promptTokens ?? 0)
  const completionTokens = Number(usage.completionTokens ?? 0)
  const cacheHitTokens = Number(usage.cacheHitTokens ?? 0)
  const cacheMissTokens = Number(usage.cacheMissTokens ?? 0)
  return {
    promptTokens,
    completionTokens,
    totalTokens: Number(usage.totalTokens ?? promptTokens + completionTokens),
    cacheHitTokens,
    cacheMissTokens,
    costUsd: Number(usage.costUsd ?? 0),
    cacheSavingsUsd: Number(usage.cacheSavingsUsd ?? 0)
  }
}

function hitRate(usage) {
  const total = usage.cacheHitTokens + usage.cacheMissTokens
  return total > 0 ? usage.cacheHitTokens / total : null
}

function printMarkdownTable(left, right) {
  const rows = [
    ['turns started', left.quality.turns, right.quality.turns],
    ['turns completed', left.quality.completed, right.quality.completed],
    ['turns failed', left.quality.failed, right.quality.failed],
    ['turns aborted', left.quality.aborted, right.quality.aborted],
    ['model steps', left.quality.modelSteps, right.quality.modelSteps],
    ['tool calls', left.quality.toolCalls, right.quality.toolCalls],
    ['executed tools', left.quality.executedTools, right.quality.executedTools],
    ['suppressed tools', left.quality.suppressedTools, right.quality.suppressedTools],
    ['stuck stops', left.quality.stuckStops, right.quality.stuckStops],
    ['tool budget exhaustions', left.quality.budgetExhaustions, right.quality.budgetExhaustions],
    ['steering corrections', left.quality.steeringCorrections, right.quality.steeringCorrections],
    ['approval requests', left.quality.approvalRequests, right.quality.approvalRequests],
    ['compactions', left.quality.compactions, right.quality.compactions],
    ['prompt tokens', left.usage.promptTokens, right.usage.promptTokens],
    ['completion tokens', left.usage.completionTokens, right.usage.completionTokens],
    ['total tokens', left.usage.totalTokens, right.usage.totalTokens],
    ['cache hit tokens', left.usage.cacheHitTokens, right.usage.cacheHitTokens],
    ['cache miss tokens', left.usage.cacheMissTokens, right.usage.cacheMissTokens],
    ['cache hit rate', formatRate(hitRate(left.usage)), formatRate(hitRate(right.usage))],
    ['cost USD', formatUsd(left.usage.costUsd), formatUsd(right.usage.costUsd)],
    ['cache savings USD', formatUsd(left.usage.cacheSavingsUsd), formatUsd(right.usage.cacheSavingsUsd)]
  ]
  console.log(`Comparing:\n- A: ${left.path}\n- B: ${right.path}\n`)
  console.log('| metric | A | B | delta B-A |')
  console.log('|---|---:|---:|---:|')
  for (const [metric, a, b] of rows) {
    console.log(`| ${metric} | ${a} | ${b} | ${formatDelta(a, b)} |`)
  }
}

function formatRate(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`
}

function formatUsd(value) {
  return `$${Number(value).toFixed(6)}`
}

function formatDelta(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return String(b - a)
  if (typeof a === 'string' && typeof b === 'string' && a.startsWith('$') && b.startsWith('$')) {
    return formatUsd(Number(b.slice(1)) - Number(a.slice(1)))
  }
  if (typeof a === 'string' && typeof b === 'string' && a.endsWith('%') && b.endsWith('%')) {
    return `${(Number(b.slice(0, -1)) - Number(a.slice(0, -1))).toFixed(2)}%`
  }
  return 'n/a'
}
