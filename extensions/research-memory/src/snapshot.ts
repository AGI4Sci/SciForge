import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ExperimentRun, MemoryItem } from './types.js'

export function writeResearchMemorySnapshot(input: {
  workspaceRoot: string
  projectId: string
  format: 'markdown' | 'json'
  runs: ExperimentRun[]
  items: MemoryItem[]
}): { path: string } {
  const path = join(input.workspaceRoot, 'artifacts', input.format === 'json'
    ? 'research_memory_snapshot.json'
    : 'research_memory_snapshot.md')
  mkdirSync(dirname(path), { recursive: true })
  const content = input.format === 'json'
    ? `${JSON.stringify({ projectId: input.projectId, runs: input.runs, memory: input.items }, null, 2)}\n`
    : markdownSnapshot(input)
  writeFileSync(path, content, 'utf8')
  return { path }
}

function markdownSnapshot(input: {
  projectId: string
  runs: ExperimentRun[]
  items: MemoryItem[]
}): string {
  const active = input.items.filter((item) => item.status === 'active')
  const candidates = input.items.filter((item) => item.status === 'candidate')
  const hypotheses = input.items.filter((item) => item.status === 'hypothesis')
  return [
    '# Research Memory Snapshot',
    '',
    `Project: ${input.projectId}`,
    '',
    '## Experiment Ledger',
    '',
    ...input.runs.map((run) => [
      `### ${run.id} - ${run.title}`,
      '',
      `- Status: ${run.status}`,
      `- Metrics: ${JSON.stringify(run.metrics ?? {})}`,
      `- Artifacts: ${run.artifactRefs.join(', ') || 'none'}`,
      `- Evidence: experiment:${run.id}${run.metrics ? `, ${Object.keys(run.metrics).map((key) => `metric:${run.id}:${key}`).join(', ')}` : ''}`
    ].join('\n')),
    '',
    '## Active Memory',
    '',
    ...memoryLines(active),
    '',
    '## Candidate Memory',
    '',
    ...memoryLines(candidates),
    '',
    '## Hypotheses',
    '',
    ...memoryLines(hypotheses)
  ].join('\n')
}

function memoryLines(items: MemoryItem[]): string[] {
  if (items.length === 0) return ['None.']
  return items.map((item) => [
    `- ${item.id} [${item.type}/${item.status}/${item.evidenceLevel}]`,
    `  Claim: ${item.claim}`,
    item.recommendedAction ? `  Recommended action: ${item.recommendedAction}` : '',
    `  Evidence refs: ${item.evidenceRefs.join(', ') || 'none'}`
  ].filter(Boolean).join('\n'))
}
