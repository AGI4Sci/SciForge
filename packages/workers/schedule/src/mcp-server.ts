import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'

import {
  SCHEDULE_MCP_SERVER_NAME,
  SCHEDULE_MCP_SERVER_VERSION,
  SCHEDULE_STATUS_RESOURCE_URI,
  SCHEDULE_TASK_RESOURCE_URI_TEMPLATE,
  SCHEDULE_TASKS_RESOURCE_URI,
  SCHEDULE_TOOL_SIDE_EFFECTS,
  ScheduleWorkerError,
  scheduleCreateToolInputSchema,
  scheduleDeleteToolInputSchema,
  scheduleDetectFromTextToolInputSchema,
  scheduleErrorPayloadFromUnknown,
  scheduleListToolInputSchema,
  scheduleRunToolInputSchema,
  scheduleStatusToolInputSchema,
  scheduleTaskResourceUri,
  scheduleUpdateToolInputSchema,
  type ScheduleErrorPayload,
  type ScheduleRunResult,
  type ScheduleTaskFromTextResult,
  type ScheduledTask
} from './contract.js'
import {
  createScheduleService,
  isScheduleDryRunResult,
  type ScheduleDryRunResult,
  type ScheduleListResult,
  type ScheduleService
} from './service.js'

type McpTextToolResult = CallToolResult & {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: true
}

export type StartScheduleMcpServerOptions = {
  transport?: Transport
}

export function createScheduleMcpServer(
  service: ScheduleService = createScheduleService()
): McpServer {
  const server = new McpServer(
    { name: SCHEDULE_MCP_SERVER_NAME, version: SCHEDULE_MCP_SERVER_VERSION },
    { capabilities: { logging: {} } }
  )

  server.registerTool('gui_schedule_list', {
    description: 'List scheduled tasks managed by the currently running SciForge app.',
    inputSchema: scheduleListToolInputSchema,
    annotations: toolAnnotations('gui_schedule_list', 'List schedule tasks', true)
  }, async (args, extra) => {
    try {
      const result = await service.list(args, { signal: extra.signal })
      return textAndStructured(renderListTasks(result), {
        ok: true,
        effect: SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_list.effect,
        tasks: result.tasks,
        count: result.count
      })
    } catch (error) {
      return toolError(error, 'Failed to list scheduled tasks.')
    }
  })

  server.registerTool('gui_schedule_create', {
    description: 'Create a scheduled task in SciForge. Supports one-time (`at`), daily, or interval schedules.',
    inputSchema: scheduleCreateToolInputSchema,
    annotations: toolAnnotations('gui_schedule_create', 'Create schedule task', false)
  }, async (args, extra) => {
    try {
      const task = await service.create(args, { signal: extra.signal })
      if (isScheduleDryRunResult(task)) return dryRunToolResult(task)
      return textAndStructured(`Scheduled task created: ${task.title || task.id}`, {
        ok: true,
        effect: SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_create.effect,
        task
      })
    } catch (error) {
      return toolError(error, 'Failed to create scheduled task.')
    }
  })

  server.registerTool('gui_schedule_update', {
    description: 'Update an existing SciForge scheduled task.',
    inputSchema: scheduleUpdateToolInputSchema,
    annotations: toolAnnotations('gui_schedule_update', 'Update schedule task', false)
  }, async (args, extra) => {
    try {
      const task = await service.update(args, { signal: extra.signal })
      if (isScheduleDryRunResult(task)) return dryRunToolResult(task)
      return textAndStructured(`Scheduled task updated: ${task.title || task.id}`, {
        ok: true,
        effect: SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_update.effect,
        task
      })
    } catch (error) {
      return toolError(error, 'Failed to update scheduled task.')
    }
  })

  server.registerTool('gui_schedule_delete', {
    description: 'Delete a scheduled task from SciForge. Use dry_run first or pass the required confirmation value.',
    inputSchema: scheduleDeleteToolInputSchema,
    annotations: toolAnnotations('gui_schedule_delete', 'Delete schedule task', true)
  }, async (args, extra) => {
    try {
      const result = await service.delete(args, { signal: extra.signal })
      if (isScheduleDryRunResult(result)) return dryRunToolResult(result)
      return textAndStructured(`Scheduled task deleted: ${result.taskId}`, {
        ok: true,
        effect: SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_delete.effect,
        ...result
      })
    } catch (error) {
      return toolError(error, 'Failed to delete scheduled task.')
    }
  })

  server.registerTool('gui_schedule_status', {
    description: 'Read SciForge schedule runtime status.',
    inputSchema: scheduleStatusToolInputSchema,
    annotations: toolAnnotations('gui_schedule_status', 'Read schedule status', true)
  }, async (args, extra) => {
    try {
      const status = await service.status(args, { signal: extra.signal })
      return textAndStructured(renderStatus(status), {
        ok: true,
        effect: SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_status.effect,
        status
      })
    } catch (error) {
      return toolError(error, 'Failed to read schedule status.')
    }
  })

  server.registerTool('gui_schedule_run', {
    description: 'Run an existing SciForge scheduled task immediately through the main process schedule runtime. Use dry_run first or pass the required confirmation value.',
    inputSchema: scheduleRunToolInputSchema,
    annotations: toolAnnotations('gui_schedule_run', 'Run schedule task', false)
  }, async (args, extra) => {
    try {
      const result = await service.run(args, { signal: extra.signal })
      if (isScheduleDryRunResult(result)) return dryRunToolResult(result)
      if (!result.ok) {
        return scheduleToolError({
          code: 'schedule_task_failed',
          reason: result.message,
          retryable: false,
          suggestion: 'Read schedule://tasks or schedule://task/{id} to inspect the task before retrying.'
        }, { result })
      }
      return textAndStructured(renderRunResult(result), {
        ok: true,
        effect: SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_run.effect,
        result
      })
    } catch (error) {
      return toolError(error, 'Failed to run scheduled task.')
    }
  })

  server.registerTool('gui_schedule_detect_from_text', {
    description: 'Detect schedule intent from natural language and create a scheduled task when the main process detector confirms one.',
    inputSchema: scheduleDetectFromTextToolInputSchema,
    annotations: toolAnnotations('gui_schedule_detect_from_text', 'Detect schedule from text', false)
  }, async (args, extra) => {
    try {
      const result = await service.detectFromText(args, { signal: extra.signal })
      if (isScheduleDryRunResult(result)) return dryRunToolResult(result)
      if (result.kind === 'error') {
        return scheduleToolError({
          code: 'detect_failed',
          reason: result.message,
          retryable: false,
          suggestion: 'Rewrite the request with an explicit time and task instruction.'
        }, { result })
      }
      return textAndStructured(renderDetectResult(result), {
        ok: true,
        effect: SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_detect_from_text.effect,
        result
      })
    } catch (error) {
      return toolError(error, 'Failed to detect schedule intent from text.')
    }
  })

  registerScheduleResources(server, service)
  return server
}

export async function startScheduleMcpServer(
  service: ScheduleService = createScheduleService(),
  options: StartScheduleMcpServerOptions = {}
): Promise<void> {
  const server = createScheduleMcpServer(service)
  const transport = options.transport ?? new StdioServerTransport()
  await server.connect(transport)
}

function registerScheduleResources(server: McpServer, service: ScheduleService): void {
  server.registerResource('schedule_tasks', SCHEDULE_TASKS_RESOURCE_URI, {
    title: 'SciForge scheduled tasks',
    description: 'All scheduled tasks managed by the running SciForge app.',
    mimeType: 'application/json'
  }, async (_uri, extra) => {
    try {
      const result = await service.list({}, { signal: extra.signal })
      return jsonResource(SCHEDULE_TASKS_RESOURCE_URI, {
        ok: true,
        tasks: result.tasks,
        count: result.count
      })
    } catch (error) {
      return jsonErrorResource(SCHEDULE_TASKS_RESOURCE_URI, error, 'Failed to read schedule tasks.')
    }
  })

  server.registerResource('schedule_status', SCHEDULE_STATUS_RESOURCE_URI, {
    title: 'SciForge schedule status',
    description: 'Current schedule runtime status from the running SciForge app.',
    mimeType: 'application/json'
  }, async (_uri, extra) => {
    try {
      const status = await service.status({}, { signal: extra.signal })
      return jsonResource(SCHEDULE_STATUS_RESOURCE_URI, {
        ok: true,
        status
      })
    } catch (error) {
      return jsonErrorResource(SCHEDULE_STATUS_RESOURCE_URI, error, 'Failed to read schedule status.')
    }
  })

  server.registerResource('schedule_task', new ResourceTemplate(SCHEDULE_TASK_RESOURCE_URI_TEMPLATE, {
    list: async (extra) => {
      const result = await service.list({}, { signal: extra.signal })
      return {
        resources: result.tasks.map((task) => ({
          uri: scheduleTaskResourceUri(task.id),
          name: `schedule_task_${task.id}`,
          title: task.title || task.id,
          description: `Scheduled task ${task.id}`,
          mimeType: 'application/json'
        }))
      }
    },
    complete: {
      id: async (value) => {
        const result = await service.list({})
        return result.tasks
          .map((task) => task.id)
          .filter((id) => id.startsWith(value))
          .slice(0, 50)
      }
    }
  }), {
    title: 'SciForge scheduled task',
    description: 'A single scheduled task by id.',
    mimeType: 'application/json'
  }, async (uri, variables, extra) => {
    const id = decodeUriTemplateVariable(String(variables.id ?? ''))
    try {
      const task = await service.getTask(id, { signal: extra.signal })
      return jsonResource(uri.toString(), {
        ok: true,
        task
      })
    } catch (error) {
      return jsonErrorResource(uri.toString(), error, `Failed to read scheduled task ${id}.`)
    }
  })
}

type ScheduleToolName = keyof typeof SCHEDULE_TOOL_SIDE_EFFECTS

function toolAnnotations(name: ScheduleToolName, title: string, idempotentHint: boolean): {
  title: string
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: false
} {
  const contract = SCHEDULE_TOOL_SIDE_EFFECTS[name]
  return {
    title,
    readOnlyHint: contract.effect === 'read-only',
    destructiveHint: contract.effect === 'destructive',
    idempotentHint,
    openWorldHint: false
  }
}

function textAndStructured(
  text: string,
  structuredContent: Record<string, unknown>
): McpTextToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent
  }
}

function dryRunToolResult(result: ScheduleDryRunResult): McpTextToolResult {
  return textAndStructured(renderDryRunResult(result), {
    ok: true,
    dryRun: true,
    action: result.action,
    effect: result.effect,
    preview: result.preview,
    ...(result.confirmation ? { confirmation: result.confirmation } : {})
  })
}

function toolError(error: unknown, fallbackReason: string): McpTextToolResult {
  return scheduleToolError(scheduleErrorPayloadFromUnknown(error, {
    reason: fallbackReason,
    retryable: error instanceof ScheduleWorkerError ? error.retryable : false,
    suggestion: 'Check the schedule worker request and the running SciForge app.'
  }))
}

function scheduleToolError(
  payload: ScheduleErrorPayload,
  extra: Record<string, unknown> = {}
): McpTextToolResult {
  const details = payload.confirmationRequired
    ? { confirmationRequired: payload.confirmationRequired }
    : {}
  return {
    content: [{ type: 'text', text: `${payload.code}: ${payload.reason}` }],
    isError: true,
    structuredContent: {
      ok: false,
      code: payload.code,
      reason: payload.reason,
      retryable: payload.retryable,
      suggestion: payload.suggestion,
      error: payload,
      ...details,
      ...extra
    }
  }
}

function jsonResource(uri: string, value: Record<string, unknown>): ReadResourceResult {
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(value, null, 2)
    }]
  }
}

function jsonErrorResource(uri: string, error: unknown, fallbackReason: string): ReadResourceResult {
  const payload = scheduleErrorPayloadFromUnknown(error, {
    reason: fallbackReason,
    retryable: error instanceof ScheduleWorkerError ? error.retryable : false,
    suggestion: 'Check the schedule worker request and the running SciForge app.'
  })
  return jsonResource(uri, {
    ok: false,
    code: payload.code,
    reason: payload.reason,
    retryable: payload.retryable,
    suggestion: payload.suggestion,
    ...(payload.confirmationRequired ? { confirmationRequired: payload.confirmationRequired } : {}),
    error: payload
  })
}

function renderListTasks(result: ScheduleListResult): string {
  return result.count > 0
    ? `Found ${result.count} scheduled task(s).`
    : 'No scheduled tasks are configured.'
}

function renderStatus(status: {
  internalServerRunning: boolean
  internalUrl: string
  runningTaskIds: string[]
  powerSaveBlockerActive: boolean
}): string {
  return [
    `Schedule internal server is ${status.internalServerRunning ? 'running' : 'stopped'}.`,
    `Running task(s): ${status.runningTaskIds.length}.`,
    `Power save blocker: ${status.powerSaveBlockerActive ? 'active' : 'inactive'}.`
  ].join(' ')
}

function renderRunResult(result: Extract<ScheduleRunResult, { ok: true }>): string {
  return result.message?.trim() || `Scheduled task started in thread ${result.threadId}.`
}

function renderDetectResult(result: Exclude<ScheduleTaskFromTextResult, { kind: 'error' }>): string {
  if (result.kind === 'noop') return 'No schedule intent was detected.'
  return `Scheduled task detected and created: ${result.title || result.taskId}.`
}

function renderDryRunResult(result: ScheduleDryRunResult): string {
  const confirmation = result.confirmation
    ? ` Confirmation required for execution: ${result.confirmation.value}.`
    : ''
  return `Dry run: ${result.preview.summary}${confirmation}`
}

function decodeUriTemplateVariable(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export type { ScheduledTask }
