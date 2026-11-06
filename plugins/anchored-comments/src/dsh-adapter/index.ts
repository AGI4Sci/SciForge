/**
 * DSH entrypoint for Anchored Comments.
 *
 * `inject: ['tools', 'visualCapture']` registers tools and requires the generic
 * Host-authorized visual capture client. Missing service fails activation.
 * `apply(ctx, config)` registers tools with
 * `defineTool`. The plugin owns no timers and no sockets of its own: the store
 * is workspace-local and the feedback gateway is only reached through the
 * injected network port (the node binding here, a fixture binding in tests).
 */
import { Context } from '@deepseek-ai/cordis'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createAnchoredCommentsOperations } from '../core/operations.js'
import { createNodeNetworkPort } from '../ports/network.js'
import { createHostVisualCapturePort, type VisualCaptureClient } from '../ports/visual-capture.js'
import {
  registerAnchoredCommentsTools,
  type DshToolDefinition
} from './tools.js'

export const inject = ['tools', 'visualCapture']

/** Discovered through the same installed plugin generation as the eight tools. */
export function getRendererContributions() {
  return [{ id: 'anchored-comments.panel', kind: 'panel', resourceKinds: ['resource-text-selection'], title: '锚定批注 / Anchored Comments' }] as const
}

export function apply(ctx: Context & { tools: ToolRuntime; visualCapture: VisualCaptureClient }, _config?: unknown): void {
  if (!ctx.visualCapture || typeof ctx.visualCapture.invoke !== 'function') {
    throw new Error('Anchored Comments requires the authorized visualCapture Host service.')
  }
  const visualCapture = createHostVisualCapturePort(ctx.visualCapture)
  const operations = createAnchoredCommentsOperations({ network: createNodeNetworkPort(), visualCapture })
  // `tools.register()` returns the exact disposer. Keep them so a half-finished
  // activation can be rolled back and so disable/unload removes every tool.
  const disposers: Array<() => void> = []
  const disposeAll = (): void => {
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch {
        // Cleanup is best effort; the activation error stays authoritative.
      }
    }
    operations.dispose()
  }
  try {
    registerAnchoredCommentsTools(
      operations,
      (tool) => {
        const dispose = ctx.tools.register(tool as never)
        if (typeof dispose === 'function') disposers.push(dispose)
      },
      (definition: DshToolDefinition) => defineTool(definition as never),
      visualCapture
    )
  } catch (error) {
    disposeAll()
    throw error
  }
  ctx.effect(() => disposeAll)
}