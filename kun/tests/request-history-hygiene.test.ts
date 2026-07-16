import { describe, expect, it } from 'vitest'
import { applyRequestHistoryHygiene } from '../src/loop/request-history-hygiene.js'
import { makeToolCallItem, makeToolResultItem } from '../src/domain/item.js'
import { shellRuntimeInstruction } from '../src/adapters/tool/builtin-tool-utils.js'

describe('request history hygiene', () => {
  it('shrinks oversized tool results while preserving head, signal lines, and tail', () => {
    const longOutput = Array.from({ length: 500 }, (_, index) => {
      if (index === 240) return 'ERROR failed to compile auth middleware'
      return `plain output line ${index}`
    }).join('\n')
    const result = makeToolResultItem({
      id: 'result',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_bash',
      toolName: 'bash',
      output: { output: longOutput }
    })

    const compacted = applyRequestHistoryHygiene([result], {
      maxToolResultLines: 80,
      maxToolResultBytes: 4 * 1024
    })
    const compactedResult = compacted[0]
    const originalText = result.kind === 'tool_result' ? JSON.stringify(result.output) : ''
    const compactedText = compactedResult?.kind === 'tool_result'
      ? JSON.stringify(compactedResult.output)
      : ''

    expect(compactedResult).not.toBe(result)
    expect(originalText).toContain('plain output line 499')
    expect(compactedText.length).toBeLessThan(originalText.length)
    expect(compactedText).toContain('plain output line 0')
    expect(compactedText).toContain('ERROR failed to compile auth middleware')
    expect(compactedText).toContain('plain output line 499')
    expect(compactedText).toContain('cache hygiene')
  })

  it('omits long completed tool-call argument strings only when the result is paired', () => {
    const pairedCall = makeToolCallItem({
      id: 'call_item',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_write',
      toolName: 'write',
      arguments: {
        path: 'src/generated.ts',
        content: 'x'.repeat(12_000)
      }
    })
    const result = makeToolResultItem({
      id: 'result_item',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_write',
      toolName: 'write',
      output: 'wrote src/generated.ts'
    })
    const unpairedCall = makeToolCallItem({
      id: 'unpaired_call_item',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_pending',
      toolName: 'write',
      arguments: { content: 'y'.repeat(12_000) }
    })

    const compacted = applyRequestHistoryHygiene([pairedCall, result, unpairedCall])
    const nextPairedCall = compacted[0]
    const nextUnpairedCall = compacted[2]

    expect(nextPairedCall?.kind === 'tool_call' ? String(nextPairedCall.arguments.content) : '')
      .toContain('cache hygiene')
    expect(nextPairedCall?.kind === 'tool_call' ? String(nextPairedCall.arguments.content) : '')
      .toContain('never execute, persist, or copy into future tool arguments')
    expect(nextPairedCall?.kind === 'tool_call' ? nextPairedCall.arguments.path : '')
      .toBe('src/generated.ts')
    expect(nextUnpairedCall?.kind === 'tool_call' ? String(nextUnpairedCall.arguments.content).length : 0)
      .toBe(12_000)
  })

  it('shrinks dense text when the approximate token cap is exceeded before the byte cap', () => {
    const denseOutput = '汉'.repeat(9_000)
    const result = makeToolResultItem({
      id: 'dense_result',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_read',
      toolName: 'read',
      output: { content: denseOutput }
    })

    const compacted = applyRequestHistoryHygiene([result], {
      maxToolResultBytes: 32 * 1024,
      maxToolResultTokens: 4_000
    })
    const compactedResult = compacted[0]
    const compactedText = compactedResult?.kind === 'tool_result'
      ? String((compactedResult.output as { content?: string }).content ?? '')
      : ''

    expect(Buffer.byteLength(denseOutput, 'utf8')).toBeLessThan(32 * 1024)
    expect(compactedText.length).toBeLessThan(denseOutput.length)
    expect(compactedText).toContain('approx')
    expect(compactedText).toContain('cache hygiene')
  })

  it('shrinks completed tool-call args when only the approximate token cap is exceeded', () => {
    const pairedCall = makeToolCallItem({
      id: 'dense_call',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_write',
      toolName: 'write',
      arguments: {
        path: 'src/generated.txt',
        content: '汉'.repeat(2_500)
      }
    })
    const result = makeToolResultItem({
      id: 'dense_result',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_write',
      toolName: 'write',
      output: 'wrote src/generated.txt'
    })

    const compacted = applyRequestHistoryHygiene([pairedCall, result], {
      maxToolArgumentStringBytes: 8 * 1024,
      maxToolArgumentStringTokens: 2_000
    })
    const nextCall = compacted[0]

    expect(nextCall?.kind === 'tool_call' ? String(nextCall.arguments.content) : '')
      .toContain('approx')
    expect(nextCall?.kind === 'tool_call' ? String(nextCall.arguments.content) : '')
      .toContain('cache hygiene')
    expect(nextCall?.kind === 'tool_call' ? String(nextCall.arguments.content) : '')
      .toContain('metadata only')
  })

  it('normalizes previously persisted hygiene placeholders in completed tool-call args', () => {
    const pairedCall = makeToolCallItem({
      id: 'old_placeholder_call',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_bash',
      toolName: 'bash',
      arguments: {
        command:
          '[cache hygiene: omitted completed bash.command argument, 7.5KB, approx 1913 token(s), 96 line(s); see following tool result] preview="python old long script"'
      }
    })
    const result = makeToolResultItem({
      id: 'old_placeholder_result',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_bash',
      toolName: 'bash',
      output: { error: 'Refusing to execute hygiene placeholder as a shell command.' }
    })

    const compacted = applyRequestHistoryHygiene([pairedCall, result])
    const nextCall = compacted[0]
    const command = nextCall?.kind === 'tool_call' ? String(nextCall.arguments.command) : ''

    expect(command).toBe(
      'false # sciforge history metadata only; prior shell command omitted; do not execute or reuse; create a fresh smaller command'
    )
    expect(command).not.toContain('cache hygiene')
    expect(command).not.toContain('see following tool result')
    expect(command).not.toContain('preview=')
  })

  it('normalizes request-hygiene placeholders in completed bash commands', () => {
    const pairedCall = makeToolCallItem({
      id: 'request_placeholder_call',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_bash',
      toolName: 'bash',
      arguments: {
        command:
          '[sciforge request_hygiene source=tool_call.arguments.command reason=large_argument_string digest=sha256:abc original_chars=7000 summary="touch should-not-run"]'
      }
    })
    const result = makeToolResultItem({
      id: 'request_placeholder_result',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_bash',
      toolName: 'bash',
      output: { output: '' }
    })

    const compacted = applyRequestHistoryHygiene([pairedCall, result])
    const nextCall = compacted[0]
    const command = nextCall?.kind === 'tool_call' ? String(nextCall.arguments.command) : ''

    expect(command).toBe(
      'false # sciforge history metadata only; prior shell command omitted; do not execute or reuse; create a fresh smaller command'
    )
    expect(command).not.toContain('[sciforge request_hygiene')
  })

  it('replaces oversized completed bash commands with an explicit failing history sentinel', () => {
    const pairedCall = makeToolCallItem({
      id: 'long_bash_call',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_bash',
      toolName: 'bash',
      arguments: {
        command: `python3 <<'PY'\n${'print("work")\n'.repeat(2_500)}PY`
      }
    })
    const result = makeToolResultItem({
      id: 'long_bash_result',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_bash',
      toolName: 'bash',
      output: { output: 'completed' }
    })

    const compacted = applyRequestHistoryHygiene([pairedCall, result])
    const nextCall = compacted[0]
    const command = nextCall?.kind === 'tool_call' ? String(nextCall.arguments.command) : ''

    expect(command).toBe(
      'false # sciforge history metadata only; prior shell command omitted; do not execute or reuse; create a fresh smaller command'
    )
    expect(command).not.toContain('[cache hygiene:')
  })

  it('replaces base64 payloads in model-bound history', () => {
    const result = makeToolResultItem({
      id: 'image_result',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_read',
      toolName: 'read',
      output: { data_base64: 'a'.repeat(2_000), mime: 'image/png' }
    })

    const compacted = applyRequestHistoryHygiene([result])
    const compactedResult = compacted[0]

    expect(compactedResult?.kind === 'tool_result' ? compactedResult.output : {}).toMatchObject({
      data_base64: expect.stringContaining('omitted base64 data'),
      mime: 'image/png'
    })
  })

  it('warns bash-capable turns not to execute hygiene metadata placeholders', () => {
    const instruction = shellRuntimeInstruction()

    expect(instruction).toContain('[cache hygiene: ...]')
    expect(instruction).toContain('[sciforge request_hygiene ...]')
    expect(instruction).toContain('false # sciforge history metadata only')
    expect(instruction).toContain('never execute or copy them into tool arguments')
  })
})
