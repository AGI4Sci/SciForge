import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('transcript-diff quality report', () => {
  it('uses the latest cumulative usage snapshot and reports loop metrics', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sciforge-transcript-diff-'))
    tempDirs.push(dir)
    const left = join(dir, 'left.jsonl')
    const right = join(dir, 'right.jsonl')
    await writeFile(left, jsonl([
      event('turn_started'),
      stage('pre_send'),
      usage(40, 10),
      stage('pre_send'),
      usage(100, 20),
      event('tool_call_ready'),
      event('turn_completed')
    ]), 'utf8')
    await writeFile(right, jsonl([
      event('turn_started'),
      stage('pre_send'),
      usage(70, 15),
      event('turn_completed')
    ]), 'utf8')

    const script = resolve(process.cwd(), 'scripts/transcript-diff.mjs')
    const { stdout } = await execFileAsync(process.execPath, [script, left, right])

    expect(stdout).toContain('| model steps | 2 | 1 | -1 |')
    expect(stdout).toContain('| tool calls | 1 | 0 | -1 |')
    expect(stdout).toContain('| prompt tokens | 100 | 70 | -30 |')
    expect(stdout).not.toContain('| prompt tokens | 140 |')
  })
})

function jsonl(events: unknown[]): string {
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
}

function event(kind: string): Record<string, unknown> {
  return { kind }
}

function stage(stageName: string): Record<string, unknown> {
  return { kind: 'pipeline_stage', stage: stageName }
}

function usage(promptTokens: number, completionTokens: number): Record<string, unknown> {
  return {
    kind: 'usage',
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      turns: 1
    }
  }
}
