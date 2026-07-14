import { describe, expect, it, vi } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { LocalToolHost } from './local-tool-host.js'

function fakeContext(): ToolHostContext {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspace: '/tmp/research-workspace',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function bashCall(command: string) {
  return {
    callId: `call-${Math.random().toString(36).slice(2)}`,
    toolName: 'bash',
    toolKind: 'command_execution' as const,
    arguments: { command }
  }
}

function outputRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function bashTool(exec: (command: unknown) => void) {
  return LocalToolHost.defineTool({
    name: 'bash',
    description: 'test bash tool',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' }
      }
    },
    policy: 'auto',
    toolKind: 'command_execution',
    execute: async (args) => {
      exec(args.command)
      return {
        output: {
          command: args.command,
          exit_code: 0,
          output: ''
        }
      }
    }
  })
}

describe('LocalToolHost bash git staging safety', () => {
  it.each([
    'git add .',
    'git add -A',
    'git add --all',
    'git add -u',
    'git add --update',
    'cd repo && git add . && git commit -m ok',
    'git commit -am "wide commit"',
    'git commit --all -m "wide commit"'
  ])('blocks broad repository staging command: %s', async (command) => {
    const exec = vi.fn()
    const host = new LocalToolHost({
      tools: [bashTool(exec)]
    })

    const result = await host.execute(bashCall(command), fakeContext())
    const item = result.item as { output?: unknown; isError?: boolean }
    const output = outputRecord(item.output)

    expect(exec).not.toHaveBeenCalled()
    expect(item.isError).toBe(true)
    expect(output.code).toBe('bash_command_policy_denied')
    expect(String(output.error)).toContain('Stage explicit paths')
  })

  it.each([
    'git add outputs/112_stage88_pi_action_deposition_packet outputs/research_ideas_versions.md',
    'git add -A outputs/112_stage88_pi_action_deposition_packet',
    'git -C /tmp/repo add src/file.ts'
  ])('allows explicit scoped git staging command: %s', async (command) => {
    const exec = vi.fn()
    const host = new LocalToolHost({
      tools: [bashTool(exec)]
    })

    const result = await host.execute(bashCall(command), fakeContext())
    const item = result.item as { isError?: boolean }

    expect(exec).toHaveBeenCalledTimes(1)
    expect(item.isError).toBeFalsy()
  })
})

describe('LocalToolHost approval outcomes', () => {
  it('marks a successfully executed mandatory approval call as approved', async () => {
    const awaitApproval = vi.fn(async () => 'allow' as const)
    const execute = vi.fn(async () => ({ output: { accepted: true } }))
    const host = new LocalToolHost({
      tools: [LocalToolHost.defineTool({
        name: 'allocate_external_budget',
        description: 'test mandatory approval tool',
        inputSchema: { type: 'object', properties: {} },
        policy: 'on-request',
        approvalMode: 'mandatory',
        requiresApproval: () => true,
        execute
      })]
    })

    const result = await host.execute({
      callId: 'approved-budget-call',
      toolName: 'allocate_external_budget',
      arguments: {}
    }, {
      ...fakeContext(),
      approvalPolicy: 'auto',
      awaitApproval
    })

    expect(awaitApproval).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(result.approved).toBe(true)
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: false,
      output: { accepted: true }
    })
  })
})
