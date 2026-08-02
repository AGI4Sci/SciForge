import type {
  AgentRuntimeCapabilities,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail
} from '../../../shared/agent-runtime-contract'
import {
  createAgentRuntimeCapabilityMatrix,
  createDefaultAgentRuntimeCapabilities
} from '../../../shared/agent-runtime-contract'
import type { AgentRuntimeAdapter } from '../agent-runtime/adapter'
import type {
  ClaudeCodeRuntimeFailure,
  ClaudeCodeRuntimeService
} from './claude-code-service'
import {
  COMPUTER_USE_MCP_TOOL_NAME,
  configuredComputerUseCapability,
  GUI_COMPUTER_USE_MCP_SERVER_NAME,
  unavailableComputerUseCapability
} from '../../computer-use-mcp-config'
import {
  normalizeAgentCapabilitySettings,
  type AgentSubagentSettingsV1,
  type AppSettingsV1
} from '../../../shared/app-settings'

export function createClaudeCodeAgentRuntimeAdapter(
  service: ClaudeCodeRuntimeService
): AgentRuntimeAdapter {
  return {
    id: 'claude',
    transport: 'cli_process',
    subagents: {
      spawn: (_context, input) => service.spawnSubagent(input),
      inspect: (_context, input) => service.inspectSubagent(input),
      message: (_context, input) => service.messageSubagent(input),
      cancel: (_context, input) => service.cancelSubagent(input)
    },

    async connect() {
      const result = await service.connect()
      if (!result.ok) throw claudeFailure(result)
    },

    async capabilities(context) {
      const computerUseConfigured = isClaudeComputerUseConfigured(service, context.settings)
      return claudeCapabilities(
        computerUseConfigured,
        normalizeAgentCapabilitySettings(context.settings.agentCapabilities).subagents
      )
    },

    async listThreads(_context, input): Promise<AgentRuntimeThread[]> {
      const result = await service.listThreads({
        limit: input.limit,
        search: input.search,
        includeArchived: input.includeArchived,
        archivedOnly: input.archivedOnly
      })
      if (!result.ok) throw claudeFailure(result)
      return result.threads
    },

    async startThread(_context, input): Promise<AgentRuntimeThread> {
      const result = await service.startThread({
        threadId: input.threadId,
        workspace: input.workspace,
        title: input.title
      })
      if (!result.ok) throw claudeFailure(result)
      return result.thread
    },

    async readThread(_context, input): Promise<AgentRuntimeThreadDetail> {
      const result = await service.readThread(input.threadId)
      if (!result.ok) throw claudeFailure(result)
      return result.detail
    },

    async startTurn(context, input) {
      const result = await service.startTurn({
        threadId: input.threadId,
        text: input.text,
        displayText: input.displayText,
        workspace: input.workspace,
        reasoningEffort: input.reasoningEffort,
        ownedVisualToolsAvailable:
          context.turnGovernanceSnapshot?.ownedVisualToolsAvailable === true,
        nativeVisualProofChainPending:
          context.turnGovernanceSnapshot?.nativeVisualProofChainPending === true
      })
      if (!result.ok) throw claudeFailure(result)
      return {
        threadId: result.threadId,
        turnId: result.turnId,
        userMessageItemId: result.userMessageItemId
      }
    },

    async interruptTurn(_context, input) {
      const result = await service.interruptTurn(input.threadId, input.turnId)
      if (!result.ok) throw claudeFailure(result)
    },

    async steerTurn(_context, input) {
      const result = await service.steerTurn({
        threadId: input.threadId,
        turnId: input.turnId,
        text: input.text
      })
      if (!result.ok) throw claudeFailure(result)
    },

    async renameThread(_context, input) {
      const result = await service.renameThread(input.threadId, input.title)
      if (!result.ok) throw claudeFailure(result)
    },

    async deleteThread(_context, input) {
      const result = await service.deleteThread(input.threadId)
      if (!result.ok) throw claudeFailure(result)
    },

    async *subscribeEvents(_context, input) {
      yield* service.subscribeEvents(input.threadId, input.sinceSeq ?? 0, input.signal)
    },

    async publishSyntheticEvent(_context, event) {
      return service.publishSyntheticEvent(event)
    },

    async updateTurnGovernanceSnapshot(_context, input) {
      service.updateTurnGovernanceSnapshot(input)
    },

    async usage(_context, input) {
      return service.usage(input)
    },

    async auxiliary(_context, input) {
      switch (input.operation) {
        case 'getRuntimeInfo': {
          const computerUseConfigured = isClaudeComputerUseConfigured(service, _context.settings)
          return claudeRuntimeInfo(
            await service.runtimeInfo(),
            computerUseConfigured,
            normalizeAgentCapabilitySettings(_context.settings.agentCapabilities).subagents
          )
        }
        case 'getToolDiagnostics': {
          const computerUseConfigured = isClaudeComputerUseConfigured(service, _context.settings)
          return {
            providers: [],
            mcpServers: computerUseConfigured
              ? [{
                  id: GUI_COMPUTER_USE_MCP_SERVER_NAME,
                  status: 'configured',
                  toolCount: 1,
                  tools: [COMPUTER_USE_MCP_TOOL_NAME]
                }]
              : [],
            webProviders: [],
            attachments: { count: 0 },
            skills: {
              enabled: false,
              roots: [],
              skills: []
            }
          }
        }
        case 'listSkills':
          return []
        case 'listMemories':
          return []
        case 'updateMemory':
        case 'deleteMemory':
          throw new Error('Claude Code runtime does not support memory operations.')
        case 'listThreadChildren': {
          const payload = recordValue(input.payload)
          const threadId = stringValue(payload.threadId)
          if (!threadId) throw new Error('listThreadChildren requires payload.threadId.')
          return service.listThreadChildren({
            threadId,
            parentTurnId: stringValue(payload.turnId) || stringValue(payload.parentTurnId) || undefined,
            activeOnly: payload.activeOnly === true,
            cursor: stringValue(payload.cursor) || undefined,
            limit: numberValue(payload.limit)
          })
        }
        case 'readChildTranscript': {
          const payload = recordValue(input.payload)
          const parentThreadId = stringValue(payload.parentThreadId) || stringValue(payload.threadId)
          const childId = stringValue(payload.childId)
          if (!parentThreadId) throw new Error('readChildTranscript requires payload.parentThreadId.')
          if (!childId) throw new Error('readChildTranscript requires payload.childId.')
          return service.readChildTranscript({
            parentThreadId,
            parentTurnId: stringValue(payload.parentTurnId) || stringValue(payload.turnId) || undefined,
            childId,
            transcriptRef: payload.transcriptRef,
            cursor: stringValue(payload.cursor) || undefined,
            limit: numberValue(payload.limit)
          })
        }
        case 'archiveThread': {
          const payload = recordValue(input.payload)
          const threadId = stringValue(payload.threadId)
          if (!threadId) throw new Error('archiveThread requires payload.threadId.')
          const result = await service.archiveThread(threadId, payload.archived === true)
          if (!result.ok) throw claudeFailure(result)
          return undefined
        }
        default:
          throw new Error(`Claude Code AgentRuntimeAdapter does not support ${input.operation}.`)
      }
    }
  }
}

function isClaudeComputerUseConfigured(
  service: ClaudeCodeRuntimeService,
  settings: AppSettingsV1
): boolean {
  return typeof service.isComputerUseMcpConfigured === 'function' &&
    service.isComputerUseMcpConfigured(settings)
}

function claudeRuntimeInfo(
  info: Record<string, unknown>,
  computerUseConfigured = false,
  subagents: AgentSubagentSettingsV1 = normalizeAgentCapabilitySettings(undefined).subagents
): Record<string, unknown> {
  const caps = claudeCapabilities(computerUseConfigured, subagents)
  return {
    host: 'claude-code',
    port: 0,
    dataDir: '',
    startedAt: new Date().toISOString(),
    ...info,
    capabilities: {
      contractVersion: 1,
      model: {
        id: caps.model.id ?? 'claude',
        inputModalities: caps.model.inputModalities,
        outputModalities: caps.model.outputModalities,
        supportsToolCalling: caps.model.supportsToolCalling,
        contextWindowTokens: caps.model.contextWindowTokens,
        messageParts: ['text']
      },
      cli: {
        serve: coreCapability({ available: true }),
        run: coreCapability({ available: true }),
        chat: coreCapability({ available: true }),
        exec: coreCapability({ available: true })
      },
      mcp: {
        ...coreCapability(caps.tools.mcp),
        configuredServers: computerUseConfigured ? 1 : 0,
        connectedServers: 0,
        toolCount: caps.tools.mcp.toolCount ?? 0,
        computerUse: {
          enabled: computerUseConfigured,
          available: computerUseConfigured
        },
        search: {
          enabled: false,
          mode: 'direct',
          active: false,
          indexedToolCount: 0,
          advertisedToolCount: 0
        }
      },
      web: {
        ...coreCapability(caps.tools.web),
        fetch: coreCapability(caps.tools.web.fetch),
        search: coreCapability(caps.tools.web.search)
      },
      skills: {
        ...coreCapability(caps.tools.skills),
        configuredRoots: 0,
        discoveredSkills: 0
      },
      subagents: {
        ...coreCapability(caps.tools.subagents),
        maxParallel: caps.tools.subagents.maxParallel ?? 0,
        maxChildren: caps.tools.subagents.maxChildren ?? 0,
        maxChildRuns: caps.tools.subagents.maxChildren ?? 0
      },
      attachments: {
        ...coreCapability(caps.storage.attachments),
        maxImageBytes: 0,
        maxImageDimension: 0,
        allowedMimeTypes: []
      },
      memory: {
        ...coreCapability(caps.storage.memory),
        scopes: [],
        maxInjectedRecords: 0
      }
    }
  }
}

function claudeCapabilities(
  computerUseConfigured = false,
  subagents: AgentSubagentSettingsV1 = normalizeAgentCapabilitySettings(undefined).subagents
): AgentRuntimeCapabilities {
  const unavailable = { available: false, reason: 'unsupported' }
  const computerUseReason = 'Claude Code computer-use MCP server is not configured yet.'
  const caps = createDefaultAgentRuntimeCapabilities({
    runtimeId: 'claude',
    transport: 'cli_process'
  })
  return {
    ...caps,
    matrix: createAgentRuntimeCapabilityMatrix({
      nativeHistory: true,
      nativeCompact: false,
      nativeResume: true,
      steer: false,
      fork: false,
      handoffImport: false,
      usage: false,
      eventReplay: true,
      reasons: {
        nativeCompact: 'Claude Code compaction is not exposed through this adapter.',
        steer: 'Claude Code does not support safe mid-turn steering through this adapter.',
        fork: 'Claude Code fork is not exposed through this adapter.',
        handoffImport: 'Handoff import is provided by AgentRuntimeHost when a context ledger is configured.',
        usage: 'Claude Code usage aggregation is not exposed through this adapter.'
      }
    }),
    events: {
      live: true,
      replayable: true,
      sequenced: true,
      delivery: 'ipc'
    },
    threadMaterialization: 'after_first_user_message',
    latency: {
      phaseEvents: true,
      firstTokenMetric: true,
      turnDurationMetric: true
    },
    reasoning: {
      available: true,
      streaming: true,
      visibility: 'summary',
      source: 'model'
    },
    model: {
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true
    },
    tools: {
      toolCalling: true,
      commandExecution: { available: true },
      fileChange: { available: true },
      mcp: computerUseConfigured
        ? {
            available: true,
            degraded: true,
            reason: 'Claude Code MCP diagnostics are not exposed through this service yet.',
            toolCount: 1
          }
        : { available: false, reason: 'Claude Code MCP diagnostics are not exposed through this service yet.' },
      web: { available: false, reason: 'Claude Code web capabilities are not exposed through this service yet.' },
      research: { available: false, reason: 'Claude Code research search is not exposed through this service yet.' },
      computerUse: computerUseConfigured
        ? configuredComputerUseCapability()
        : unavailableComputerUseCapability(computerUseReason),
      skills: { available: false, reason: 'Claude Code skills are not exposed through this service yet.' },
      subagents: subagents.enabled
        ? {
            available: true,
            maxParallel: subagents.maxParallel,
            maxChildren: subagents.maxChildRuns
          }
        : {
            available: false,
            reason: 'Subagents are disabled by shared agentCapabilities settings.',
            maxParallel: subagents.maxParallel,
            maxChildren: subagents.maxChildRuns
          },
      diagnostics: { available: false, reason: 'Claude Code tool diagnostics are not exposed through this service yet.' }
    },
    controls: {
      interrupt: true,
      steer: false,
      approval: 'unsupported',
      userInput: 'unsupported',
      compact: 'unsupported',
      fork: false,
      review: false,
      goals: false,
      todos: false,
      resumeSession: false
    },
    storage: {
      guiOwnedThreads: true,
      backendThreadIdStable: false,
      usage: false,
      attachments: unavailable,
      memory: unavailable
    }
  }
}

function claudeFailure(result: ClaudeCodeRuntimeFailure): Error {
  const error = new Error(result.message)
  ;(error as Error & { code?: string; recoverable?: boolean }).code = result.code
  ;(error as Error & { code?: string; recoverable?: boolean }).recoverable = result.recoverable
  return error
}

function coreCapability(state: { available?: boolean; reason?: string; degraded?: boolean } | undefined): Record<string, unknown> {
  const available = state?.available === true
  return {
    status: available ? 'available' : 'unavailable',
    enabled: available,
    available,
    ...(state?.reason ? { reason: state.reason } : {}),
    ...(state?.degraded ? { degraded: state.degraded } : {})
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined
}
