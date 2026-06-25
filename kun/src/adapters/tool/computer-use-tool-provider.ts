import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

/**
 * Computer-Use tool provider.
 *
 * Exposes a single `computer_use` tool that lets the main agent (DeepSeek)
 * drive the user's real desktop (click / type / scroll) by handing a
 * natural-language instruction to the standalone Computer-Use plugin
 * (`computer-use-plugin/`, default http://127.0.0.1:3900). The plugin runs
 * the AgentS2_5 loop (qwen planner + GUI-Owl grounder + local executor) and
 * returns a ServiceResult trace — it never claims the task is done; the host
 * agent decides.
 *
 * Boundary (Servic_Module_Template.md): the tool talks to the plugin over
 * HTTP and returns the structured trace/status, never a final answer.
 *
 * Safety: the tool uses `policy: 'on-request'`, so every call is gated by the
 * Kun approval prompt before any real mouse/keyboard action runs. Only after
 * the user approves does Kun forward `execute:true & approve:true` to the
 * plugin (which must also be started with `CUA_ALLOW_EXECUTE=true`).
 *
 * Env-gated and fail-closed: when `SCIFORGE_CUA_SERVICE_URL` is unset the
 * provider advertises nothing, so existing behaviour is preserved.
 */

const DEFAULT_TIMEOUT_MS = 600_000 // generous: the desktop loop can be many steps

export type ComputerUseToolConfig = {
  /** Base URL of the running Computer-Use plugin, e.g. http://127.0.0.1:3900 */
  serviceUrl?: string
  /** Per-request safety timeout (ms). The real step/retry budget lives in the plugin. */
  timeoutMs?: number
}

function resolveConfig(config?: ComputerUseToolConfig): Required<ComputerUseToolConfig> | undefined {
  const serviceUrl = (config?.serviceUrl ?? process.env.SCIFORGE_CUA_SERVICE_URL ?? '').trim()
  if (!serviceUrl) return undefined
  const envTimeout = Number(process.env.SCIFORGE_CUA_SERVICE_TIMEOUT_MS)
  const timeoutMs =
    config?.timeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS)
  return { serviceUrl: serviceUrl.replace(/\/+$/, ''), timeoutMs }
}

type ComputerUseRunStep = {
  step?: number
  plan?: string
  action?: string
  coords?: number[] | null
  executed?: boolean
}

type ComputerUseRunData = {
  status?: string
  executed?: boolean
  platform?: string
  screen?: number[]
  steps?: ComputerUseRunStep[]
  stepCount?: number
}

export function buildComputerUseToolProviders(
  config?: ComputerUseToolConfig
): CapabilityToolProvider[] {
  const resolved = resolveConfig(config)
  if (!resolved) return []

  return [
    {
      id: 'computer-use',
      kind: 'gui',
      enabled: true,
      available: true,
      tools: [
        LocalToolHost.defineTool({
          name: 'computer_use',
          description:
            'Control the user\'s real desktop to accomplish a GUI task (click, type, scroll, ' +
            'open apps). Give one clear natural-language instruction describing the goal, e.g. ' +
            '"open Notepad and type the meeting agenda" or "in the open browser, click the ' +
            'Download button". Returns a step-by-step trace of what was planned and done — it ' +
            'does NOT guarantee the task succeeded, so verify the result. Each call asks the ' +
            'user for approval before touching the mouse/keyboard.',
          inputSchema: {
            type: 'object',
            properties: {
              instruction: {
                type: 'string',
                description: 'The desktop task in natural language.'
              }
            },
            required: ['instruction'],
            additionalProperties: false
          },
          // Side effects on the real desktop -> always ask the user first.
          policy: 'on-request',
          execute: async (args, context) => {
            const instruction = typeof args.instruction === 'string' ? args.instruction.trim() : ''
            if (!instruction) {
              return { output: { error: 'instruction is required' }, isError: true }
            }

            // The user already approved this call via the Kun approval gate
            // (policy: on-request), so we forward execute+approve. The plugin
            // is the final gate (CUA_ALLOW_EXECUTE) and owns retry/robustness.
            // Stable id so we can tell the plugin to STOP this exact run on abort.
            const requestId =
              globalThis.crypto?.randomUUID?.() ??
              `cua-${Date.now()}-${Math.random().toString(36).slice(2)}`
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), resolved.timeoutMs)
            const onAbort = (): void => {
              controller.abort()
              // Aborting the fetch only drops our HTTP connection; the plugin's
              // run loop keeps driving the desktop. POST cancel so it actually
              // stops the mouse/keyboard between steps. Fire-and-forget.
              void fetch(`${resolved.serviceUrl}/computer-use/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId })
              }).catch(() => {})
            }
            context.abortSignal.addEventListener('abort', onAbort)

            try {
              const response = await fetch(`${resolved.serviceUrl}/computer-use/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instruction, execute: true, approve: true, requestId }),
                signal: controller.signal
              })

              const payload = (await response.json().catch(() => null)) as
                | { ok?: boolean; data?: ComputerUseRunData; summary?: string; error?: { code?: string; message?: string; blockedReason?: string } }
                | null

              if (!payload) {
                return {
                  output: { error: `computer-use service returned non-JSON (HTTP ${response.status})` },
                  isError: true
                }
              }

              if (!payload.ok) {
                const err = payload.error ?? {}
                return {
                  output: {
                    error: err.message ?? `computer-use failed (HTTP ${response.status})`,
                    code: err.code,
                    ...(err.blockedReason ? { blockedReason: err.blockedReason } : {})
                  },
                  isError: true
                }
              }

              const data = payload.data ?? {}
              const steps = (data.steps ?? []).map((s) => ({
                step: s.step,
                plan: s.plan,
                action: s.action,
                coords: s.coords ?? null,
                executed: Boolean(s.executed)
              }))

              return {
                output: {
                  status: data.status, // descriptive, NOT a completion claim
                  executed: Boolean(data.executed),
                  platform: data.platform,
                  screen: data.screen,
                  stepCount: data.stepCount ?? steps.length,
                  steps,
                  summary: payload.summary
                }
              }
            } catch (error) {
              const aborted = controller.signal.aborted
              return {
                output: {
                  error: aborted
                    ? 'computer-use call timed out or was cancelled'
                    : `computer-use call failed: ${error instanceof Error ? error.message : String(error)}`,
                  retryable: true
                },
                isError: true
              }
            } finally {
              clearTimeout(timeout)
              context.abortSignal.removeEventListener('abort', onAbort)
            }
          }
        })
      ]
    }
  ]
}
