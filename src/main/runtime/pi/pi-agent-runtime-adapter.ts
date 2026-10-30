import type {
  AgentRuntimeCapabilities,
  AgentRuntimeDiscoveryResult
} from '../../../shared/agent-runtime-contract'
import {
  createAgentRuntimeCapabilityMatrix,
  createDefaultAgentRuntimeCapabilities
} from '../../../shared/agent-runtime-contract'
import { getPiRuntimeSettings } from '../../../shared/app-settings'
import type { AgentRuntimeToolSurface } from '../agent-runtime/agent-tool-surface'
import type {
  AgentRuntimeAdapter,
  AgentRuntimeAdapterContext
} from '../agent-runtime/adapter'
import { probePiRuntime, resolvePiProbeInvocation } from './pi-runtime-probe'
import { PiRuntimeService } from './pi-runtime-service'

/**
 * Pi runtime adapter — detection, conversation, and host-tool bridge stages.
 *
 * Implemented: probe, connect, startThread, startTurn (streaming text,
 * terminal states, host tool events), interruptTurn, readThreadStatus,
 * readThreadPage, listThreads, renameThread, deleteThread (session close),
 * subscribeEvents, and restart resume: with a storageRoot, threads persist
 * and respawn with `--session` (sessionId strictly verified; mismatch fails
 * loudly).
 *
 * Tool bridge (only when constructed with the canonical Host toolSurface):
 * pi launches with the host extension and an exact `--tools` whitelist; every
 * turn runs under one exact Host tool lease on the thread's session endpoint
 * (bound only after the Host durability ack, revoked at terminal/interrupt).
 * Pi-native approvals stay disabled; capability approvals are mediated by the
 * existing Host approval UI inside the broker call path, so the adapter-level
 * approval protocol remains honestly 'unsupported'.
 *
 * Honestly NOT implemented (rejects with the stable `runtime_unsupported`
 * code): steerTurn, resumeSession by arbitrary id, forkThread, compactThread,
 * subagents, usage queries, tool artifacts. File-modifying and
 * command-executing pi built-ins stay disabled at launch.
 */
export function createPiAgentRuntimeAdapter(options: { storageRoot?: string; toolSurface?: AgentRuntimeToolSurface } = {}): AgentRuntimeAdapter {
  let service: PiRuntimeService | undefined
  let serviceKey = ''

  const resolveExecutable = async (context: AgentRuntimeAdapterContext): Promise<string> => {
    const settings = getPiRuntimeSettings(context.settings)
    const candidate = settings.executablePath || settings.command || 'pi'
    const resolved = await resolvePiProbeInvocation(candidate, process.env)
    if ('available' in resolved) {
      throw Object.assign(new Error(resolved.failure?.code ?? 'runtime_not_found'), {
        code: resolved.failure?.code ?? 'runtime_not_found'
      })
    }
    return resolved.executablePath
  }

  const serviceFor = async (context: AgentRuntimeAdapterContext): Promise<PiRuntimeService> => {
    const executablePath = await resolveExecutable(context)
    const key = executablePath
    if (!service || serviceKey !== key) {
      await service?.close()
      service = new PiRuntimeService({
        executablePath,
        storageRoot: options.storageRoot,
        toolSurface: options.toolSurface
      })
      serviceKey = key
    }
    return service
  }

  const unsupported = async (): Promise<never> => {
    throw Object.assign(new Error('runtime_unsupported'), { code: 'runtime_unsupported' })
  }

  return {
    id: 'pi',
    transport: 'jsonl_stdio',

    probe: async (context, input): Promise<AgentRuntimeDiscoveryResult> => {
      const settings = getPiRuntimeSettings(context.settings)
      const candidate = input?.command?.trim() || settings.executablePath || settings.command
      return probePiRuntime(candidate)
    },

    connect: async (context) => {
      const result = await probePiRuntime(
        getPiRuntimeSettings(context.settings).executablePath ||
        getPiRuntimeSettings(context.settings).command
      )
      if (!result.available) {
        throw Object.assign(new Error(result.failure?.code ?? 'runtime_probe_failed'), {
          code: result.failure?.code ?? 'runtime_probe_failed'
        })
      }
    },

    capabilities: async (): Promise<AgentRuntimeCapabilities> => {
      // Tool calling is only claimed when the adapter was constructed with
      // the canonical Host tool surface; the probe-verified bridge (host
      // extension + exact --tools whitelist + per-turn lease) is what backs
      // the claim. MCP availability here means the host-provided endpoint,
      // never user mcp.json servers.
      const toolCalling = Boolean(options.toolSurface)
      const defaults = createDefaultAgentRuntimeCapabilities({ runtimeId: 'pi', transport: 'jsonl_stdio' })
      return {
        ...defaults,
        matrix: createAgentRuntimeCapabilityMatrix({
          // Verified on the wire against pi 1.4.0: --session resume restores
          // the same sessionId AND the model context (codeword recall), and
          // survives a force-killed process. See pi-runtime-service.ts header.
          nativeHistory: true,
          nativeResume: true,
          eventReplay: true,
          usage: true,
          reasons: {
            steer: 'unverified'
          }
        }),
        events: { live: true, replayable: true, sequenced: true, delivery: 'async_iterable' },
        controls: {
          interrupt: true,
          steer: false,
          // Pi-native approvals are disabled (--no-approve); Host capability
          // approvals run inside the broker call path, not via resolveApproval.
          approval: 'unsupported',
          userInput: 'unsupported',
          compact: 'unsupported',
          fork: false,
          review: false,
          goals: false,
          todos: false,
          resumeSession: false
        },
        tools: {
          ...defaults.tools,
          toolCalling,
          mcp: { ...defaults.tools.mcp, available: toolCalling }
        },
        model: {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: toolCalling
        }
      }
    },

    listThreads: async (context) => (await serviceFor(context)).listThreads(),

    startThread: async (context, input) =>
      (await serviceFor(context)).startThread({
        threadId: input.threadId,
        title: input.title,
        workspace: input.workspace,
        model: input.model
      }),

    readThreadStatus: async (context, input) => (await serviceFor(context)).readThreadStatus(input.threadId),

    readThreadPage: async (context, input) => (await serviceFor(context)).readThreadPage(input.threadId),

    readToolArtifact: unsupported,

    startTurn: async (context, input) =>
      (await serviceFor(context)).startTurn(
        input.threadId,
        { text: input.text, displayText: input.displayText, allowedTools: input.allowedTools },
        context.onTurnAccepted
      ),

    interruptTurn: async (context, input) => (await serviceFor(context)).interruptTurn(input.threadId, input.turnId),

    steerTurn: unsupported,

    renameThread: async (context, input) => (await serviceFor(context)).renameThread(input.threadId, input.title),

    deleteThread: async (context, input) => (await serviceFor(context)).deleteThread(input.threadId),

    subscribeEvents: async function* (context, input) {
      const service = await serviceFor(context)
      for await (const event of service.subscribeEvents(input.threadId, input.sinceSeq ?? 0, input.signal)) {
        if (input.signal?.aborted) return
        yield event
      }
    },

    usage: unsupported,

    close: async () => {
      await service?.close()
      service = undefined
      serviceKey = ''
    }
  }
}

/** Renderer fallback before the first successful probe: nothing is claimed. */
export function piDetectionStageCapabilities(): AgentRuntimeCapabilities {
  return createDefaultAgentRuntimeCapabilities({ runtimeId: 'pi', transport: 'jsonl_stdio' })
}
