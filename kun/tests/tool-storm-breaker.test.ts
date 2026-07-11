import { describe, expect, it } from 'vitest'
import { ToolStormBreaker } from '../src/loop/tool-storm-breaker.js'
import type { ToolCallLike } from '../src/ports/tool-host.js'

let callId = 0

function call(argumentsValue: Record<string, unknown>): ToolCallLike {
  return {
    callId: `read_${callId += 1}`,
    toolName: 'read',
    arguments: argumentsValue
  }
}

function bashCall(argumentsValue: Record<string, unknown>): ToolCallLike {
  return {
    callId: Math.random().toString(36),
    toolName: 'bash',
    toolKind: 'command_execution',
    arguments: argumentsValue
  }
}

function genericCall(argumentsValue: Record<string, unknown>): ToolCallLike {
  return {
    callId: `generic_${callId += 1}`,
    toolName: 'echo',
    arguments: argumentsValue
  }
}

describe('ToolStormBreaker', () => {
  it('suppresses the third identical tool call in a turn', () => {
    const breaker = new ToolStormBreaker()

    expect(breaker.inspect(genericCall({ path: 'src/a.ts' })).suppress).toBe(false)
    expect(breaker.inspect(genericCall({ path: 'src/a.ts' })).suppress).toBe(false)
    const third = breaker.inspect(genericCall({ path: 'src/a.ts' }))

    expect(third.suppress).toBe(true)
    expect(third.reason).toContain('identical arguments 3 times')
  })

  it('canonicalizes argument key order', () => {
    const breaker = new ToolStormBreaker()

    expect(breaker.inspect(genericCall({ path: 'src/a.ts', offset: 10 })).suppress).toBe(false)
    expect(breaker.inspect(genericCall({ offset: 10, path: 'src/a.ts' })).suppress).toBe(false)
    expect(breaker.inspect(genericCall({ path: 'src/a.ts', offset: 10 })).suppress).toBe(true)
  })

  it('suppresses a path alias after the original read produced evidence', () => {
    const workspace = '/tmp/sciforge-storm-test'
    const breaker = new ToolStormBreaker({ workspace })
    const original = call({ path: 'src/a.ts', offset: 1, limit: 10 })

    expect(breaker.inspect(original).suppress).toBe(false)
    breaker.recordResult(original, {
      path: `${workspace}/src/a.ts`,
      content: 'lines 1-10',
      start_line: 1,
      end_line: 10
    })

    expect(
      breaker.inspect(call({ path: './src/a.ts', offset: 1, limit: 10 })).suppress
    ).toBe(true)
    expect(
      breaker.inspect(call({ path: `${workspace}/src/a.ts`, offset: 1, limit: 10 })).suppress
    ).toBe(true)
  })

  it('deduplicates path aliases scheduled in the same parallel batch', () => {
    const workspace = '/tmp/sciforge-storm-test'
    const breaker = new ToolStormBreaker({ workspace })

    expect(
      breaker.inspect(call({ path: 'src/a.ts', offset: 1, limit: 10 })).suppress
    ).toBe(false)
    expect(
      breaker.inspect(call({ path: `${workspace}/src/a.ts`, offset: 1, limit: 10 })).suppress
    ).toBe(true)
  })

  it('releases scheduled coverage when a read fails', () => {
    const breaker = new ToolStormBreaker({ workspace: '/tmp/ws' })
    const failed = call({ path: 'src/a.ts', offset: 1, limit: 10 })

    expect(breaker.inspect(failed).suppress).toBe(false)
    breaker.recordResult(failed, { message: 'permission denied' }, { isError: true })

    expect(
      breaker.inspect(call({ path: './src/a.ts', offset: 1, limit: 10 })).suppress
    ).toBe(false)
  })

  it('normalizes omitted read offset and limit to their defaults', () => {
    const breaker = new ToolStormBreaker({ workspace: '/tmp/ws', defaultReadLimit: 20 })
    const original = call({ path: 'src/a.ts' })

    expect(breaker.inspect(original).suppress).toBe(false)
    breaker.recordResult(original, {
      content: 'default page',
      start_line: 1,
      end_line: 20
    })

    expect(
      breaker.inspect(call({ path: './src/a.ts', offset: 1, limit: 20 })).suppress
    ).toBe(true)
  })

  it('suppresses a fully covered overlap but permits a range with new lines', () => {
    const breaker = new ToolStormBreaker({ workspace: '/tmp/ws' })
    const original = call({ path: 'src/a.ts', offset: 10, limit: 20 })

    breaker.inspect(original)
    breaker.recordResult(original, {
      content: 'lines 10-29',
      start_line: 10,
      end_line: 29
    })

    expect(
      breaker.inspect(call({ path: 'src/a.ts', offset: 15, limit: 5 })).suppress
    ).toBe(true)
    expect(
      breaker.inspect(call({ path: 'src/a.ts', offset: 25, limit: 10 })).suppress
    ).toBe(false)
  })

  it('suppresses a heavily overlapping range with negligible new coverage', () => {
    const breaker = new ToolStormBreaker({ workspace: '/tmp/ws' })
    const original = call({ path: 'src/a.ts', offset: 1, limit: 100 })

    breaker.inspect(original)
    breaker.recordResult(original, { content: 'first block', start_line: 1, end_line: 100 })

    const repeated = breaker.inspect(call({ path: './src/a.ts', offset: 10, limit: 100 }))
    expect(repeated.suppress).toBe(true)
    expect(repeated.reason).toContain('91% covered')
  })

  it('permits pagination and then suppresses a reread of that page', () => {
    const breaker = new ToolStormBreaker({ workspace: '/tmp/ws' })
    const firstPage = call({ path: 'src/a.ts', offset: 1, limit: 10 })
    const secondPage = call({ path: 'src/a.ts', offset: 11, limit: 10 })

    breaker.inspect(firstPage)
    breaker.recordResult(firstPage, { content: 'page one', start_line: 1, end_line: 10 })
    expect(breaker.inspect(secondPage).suppress).toBe(false)
    breaker.recordResult(secondPage, { content: 'page two', start_line: 11, end_line: 20 })

    expect(
      breaker.inspect(call({ path: './src/a.ts', offset: 11, limit: 10 })).suppress
    ).toBe(true)
  })

  it('reports identical result content as no new evidence', () => {
    const breaker = new ToolStormBreaker({ workspace: '/tmp/ws' })
    const first = call({ path: 'src/a.ts', offset: 1, limit: 5 })
    const second = call({ path: 'src/a.ts', offset: 6, limit: 5 })

    breaker.inspect(first)
    const firstEvidence = breaker.recordResult(first, {
      content: 'same content',
      start_line: 1,
      end_line: 5
    })
    breaker.inspect(second)
    const duplicateEvidence = breaker.recordResult(second, {
      content: 'same content',
      start_line: 6,
      end_line: 10
    })

    expect(firstEvidence.evidenceGained).toBe(true)
    expect(duplicateEvidence).toMatchObject({ evidenceGained: false, duplicateResult: true })
    expect(duplicateEvidence.resultHash).toBe(firstEvidence.resultHash)
  })

  it('allows a read after a file-changing call resets read-only history', () => {
    const breaker = new ToolStormBreaker()

    expect(breaker.inspect(call({ path: 'src/a.ts' })).suppress).toBe(false)
    expect(breaker.inspect(call({ path: 'src/a.ts' })).suppress).toBe(true)
    expect(
      breaker.inspect({
        callId: 'mutate',
        toolName: 'write',
        toolKind: 'file_change',
        arguments: { path: 'src/a.ts', content: 'new' }
      }).suppress
    ).toBe(false)
    expect(breaker.inspect(call({ path: 'src/a.ts' })).suppress).toBe(false)
  })

  it('allows covered ranges to be read again after that file is mutated', () => {
    const breaker = new ToolStormBreaker({ workspace: '/tmp/ws' })
    const original = call({ path: 'src/a.ts', offset: 1, limit: 10 })

    breaker.inspect(original)
    breaker.recordResult(original, { content: 'old', start_line: 1, end_line: 10 })
    expect(
      breaker.inspect(call({ path: './src/a.ts', offset: 1, limit: 10 })).suppress
    ).toBe(true)

    breaker.inspect({
      callId: 'mutate-range',
      toolName: 'edit',
      toolKind: 'file_change',
      arguments: { path: './src/a.ts', old_text: 'old', new_text: 'new' }
    })

    expect(
      breaker.inspect(call({ path: 'src/a.ts', offset: 1, limit: 10 })).suppress
    ).toBe(false)
  })

  it('allows one reasoned reread without making the reason a permanent bypass', () => {
    const breaker = new ToolStormBreaker({ workspace: '/tmp/ws' })
    const original = call({ path: 'src/a.ts', offset: 1, limit: 10 })
    breaker.inspect(original)
    breaker.recordResult(original, { content: 'old', start_line: 1, end_line: 10 })

    const reasonedArguments = {
      path: './src/a.ts',
      offset: 1,
      limit: 10,
      reason: 'verify generated output after an external build'
    }
    expect(breaker.inspect(call(reasonedArguments)).suppress).toBe(false)
    expect(breaker.inspect(call(reasonedArguments)).suppress).toBe(true)
  })

  it('allows repeated bash session polls for long-running commands', () => {
    const breaker = new ToolStormBreaker()
    const args = { action: 'poll', session_id: 'bash_123', yield_seconds: 30 }

    expect(breaker.inspect(bashCall(args)).suppress).toBe(false)
    expect(breaker.inspect(bashCall(args)).suppress).toBe(false)
    expect(breaker.inspect(bashCall(args)).suppress).toBe(false)
    expect(breaker.inspect(bashCall(args)).suppress).toBe(false)
  })

  it('still suppresses repeated bash command executions', () => {
    const breaker = new ToolStormBreaker()
    const args = { command: 'npm test', timeout: 300 }

    expect(breaker.inspect(bashCall(args)).suppress).toBe(false)
    expect(breaker.inspect(bashCall(args)).suppress).toBe(false)
    expect(breaker.inspect(bashCall(args)).suppress).toBe(true)
  })
})
