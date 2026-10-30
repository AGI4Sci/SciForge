import {
  DelegateTaskInput,
  DelegateTaskOutput,
  DelegateTaskRunRequest,
  type DelegateTaskInput as DelegateTaskInputType,
  type DelegateTaskOutput as DelegateTaskOutputType,
  type DelegateTaskRunRequest as DelegateTaskRunRequestType,
  type MultiAgentChildRunRecord
} from './contract.js'
import { MultiAgentRuntime, MultiAgentRuntimeError } from './runtime.js'

export function parseDelegateTaskInput(value: unknown): DelegateTaskInputType {
  const parsed = DelegateTaskInput.parse(value)
  return {
    prompt: parsed.prompt.trim(),
    label: parsed.label?.trim(),
    workspace: parsed.workspace?.trim(),
    model: parsed.model?.trim()
  }
}

export function delegateTaskOutputFromRecord(record: MultiAgentChildRunRecord): DelegateTaskOutputType {
  return DelegateTaskOutput.parse({
    childId: record.id,
    status: record.status,
    ...(record.summary !== undefined ? { summary: record.summary } : {}),
    ...(record.usage !== undefined ? { usage: record.usage } : {}),
    ...(record.error !== undefined ? { error: record.error } : {})
  })
}

export function delegateTaskOutputFromError(error: unknown): DelegateTaskOutputType {
  if (error instanceof MultiAgentRuntimeError) {
    return DelegateTaskOutput.parse({
      status: error.code === 'child_aborted' ? 'aborted' : 'failed',
      error: error.toJSON()
    })
  }
  return DelegateTaskOutput.parse({
    status: 'failed',
    error: {
      code: 'child_failed',
      message: error instanceof Error ? error.message : String(error)
    }
  })
}

export async function runDelegateTask(
  runtime: MultiAgentRuntime,
  request: DelegateTaskRunRequestType,
  options: { signal?: AbortSignal } = {}
): Promise<DelegateTaskOutputType> {
  try {
    const parsed = DelegateTaskRunRequest.parse(request)
    const input = parseDelegateTaskInput({
      prompt: parsed.prompt,
      label: parsed.label,
      workspace: parsed.workspace,
      model: parsed.model
    })
    const record = await runtime.runChild({
      ...input,
      parentThreadId: parsed.parentThreadId,
      parentTurnId: parsed.parentTurnId,
      signal: options.signal
    })
    return delegateTaskOutputFromRecord(record)
  } catch (error) {
    return delegateTaskOutputFromError(error)
  }
}
