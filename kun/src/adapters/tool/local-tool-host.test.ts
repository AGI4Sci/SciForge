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

function lifecycleTool(
  execute: Parameters<typeof LocalToolHost.defineTool>[0]['execute']
) {
  return LocalToolHost.defineTool({
    name: 'lifecycle',
    description: 'test execution lifecycle',
    inputSchema: { type: 'object', properties: {}, required: [] },
    policy: 'auto',
    execute
  })
}

function lifecycleCall() {
  return {
    callId: 'call-lifecycle',
    toolName: 'lifecycle',
    arguments: {}
  }
}

describe('LocalToolHost execution updates', () => {
  it('drains a started fire-and-forget update before returning the terminal result', async () => {
    let markUpdateStarted!: () => void
    const updateStarted = new Promise<void>((resolve) => {
      markUpdateStarted = resolve
    })
    let releaseUpdate!: () => void
    const updateGate = new Promise<void>((resolve) => {
      releaseUpdate = resolve
    })
    const statuses: string[] = []
    const host = new LocalToolHost({
      tools: [
        lifecycleTool(async (_args, _context, onUpdate) => {
          void onUpdate?.({ output: { partial: true } })
          return { output: { done: true } }
        })
      ]
    })

    let returned = false
    const execution = host.execute(lifecycleCall(), fakeContext(), async (item) => {
      markUpdateStarted()
      await updateGate
      statuses.push(item.status)
    }).then((result) => {
      returned = true
      statuses.push(result.item.status)
      return result
    })

    await updateStarted
    expect(returned).toBe(false)
    releaseUpdate()
    const result = await execution

    expect(result.item).toMatchObject({ status: 'completed', output: { done: true } })
    expect(statuses).toEqual(['running', 'completed'])
  })

  it('ignores updates emitted after the tool execution has returned', async () => {
    let emitLateUpdate: Parameters<Parameters<typeof LocalToolHost.defineTool>[0]['execute']>[2]
    const onUpdate = vi.fn()
    const host = new LocalToolHost({
      tools: [
        lifecycleTool(async (_args, _context, update) => {
          emitLateUpdate = update
          return { output: { done: true } }
        })
      ]
    })

    const result = await host.execute(lifecycleCall(), fakeContext(), onUpdate)
    await emitLateUpdate?.({ output: { tooLate: true } })

    expect(result.item).toMatchObject({ status: 'completed', output: { done: true } })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('observes a fire-and-forget update rejection until the lifecycle drain reports it', async () => {
    let finishExecution!: () => void
    const executionGate = new Promise<void>((resolve) => {
      finishExecution = resolve
    })
    const host = new LocalToolHost({
      tools: [
        lifecycleTool(async (_args, _context, update) => {
          void update?.({ output: { partial: true } })
          await executionGate
          return { output: { done: true } }
        })
      ]
    })

    const execution = host.execute(lifecycleCall(), fakeContext(), async () => {
      throw new Error('update write failed')
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    finishExecution()

    await expect(execution).resolves.toMatchObject({
      item: {
        status: 'completed',
        isError: true,
        output: {
          code: 'tool_execution_failed',
          error: 'update write failed'
        }
      }
    })
  })

  it('delivers updates while the tool execution is still running', async () => {
    let finishExecution!: () => void
    const executionGate = new Promise<void>((resolve) => {
      finishExecution = resolve
    })
    const onUpdate = vi.fn()
    const host = new LocalToolHost({
      tools: [
        lifecycleTool(async (_args, _context, update) => {
          await update?.({ output: { partial: true } })
          await executionGate
          return { output: { done: true } }
        })
      ]
    })

    const execution = host.execute(lifecycleCall(), fakeContext(), onUpdate)
    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
        status: 'running',
        output: { partial: true }
      }))
    })
    finishExecution()

    await expect(execution).resolves.toMatchObject({
      item: { status: 'completed', output: { done: true } }
    })
  })
})

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
