import { z } from 'zod'

/**
 * Renderer contribution contract for the Broker bridge (BUG-025).
 *
 * P2-style plugins contribute UI panels/tabs. This SDK layer exposes read-only
 * status (discoverable list) and a HOST-CONTROLLED open command. It never
 * pretends to be a plain business Tool: contracts carry `renderer` /
 * `ui-contribution` tags, and the open command is system-audience-only.
 */

export const RENDERER_TAGS = ['renderer', 'ui-contribution'] as const

export type RendererContributionContract = Readonly<{
  kind: 'status' | 'open'
  capabilityId: string
  category: 'renderer'
  title: string
  description: string
  effect: 'read' | 'compute'
  approval: 'none' | 'system'
  audiences: readonly ('agent' | 'system')[]
  tags: readonly string[]
  version: string
  hostControlled: boolean
  inputSchema: z.ZodType
  outputSchema: z.ZodType
}>

export class RendererContributionAdapter {
  readonly #namespace: string
  readonly #version: string

  constructor(options: Readonly<{ namespace: string; version?: string }>) {
    this.#namespace = options.namespace
    this.#version = options.version ?? '0.1.0'
  }

  /** Read-only status contract: agent-visible summary of the panel/tab. */
  contracts(): readonly RendererContributionContract[] {
    return Object.freeze([
      Object.freeze({
        kind: 'status',
        capabilityId: `${this.#namespace}.status`,
        category: 'renderer',
        title: 'renderer: status',
        description: 'Read-only status of the UI panel/tab contributions (no side effects).',
        effect: 'read',
        approval: 'none',
        audiences: Object.freeze(['agent', 'system']),
        tags: Object.freeze([...RENDERER_TAGS]),
        version: this.#version,
        hostControlled: false,
        inputSchema: z.object({}).strict(),
        outputSchema: z.unknown(),
      }) as RendererContributionContract,
      Object.freeze({
        kind: 'open',
        capabilityId: `${this.#namespace}.open`,
        category: 'renderer',
        title: 'renderer: open',
        description: 'Host-controlled command to open a UI panel/tab contribution. Only a system audience may invoke it.',
        effect: 'compute',
        approval: 'system',
        audiences: Object.freeze(['system']),
        tags: Object.freeze([...RENDERER_TAGS, 'host-controlled']),
        version: this.#version,
        hostControlled: true,
        inputSchema: z.object({ id: z.string().trim().min(1).max(192) }).strict(),
        outputSchema: z.unknown(),
      }) as RendererContributionContract,
    ])
  }
}

/** Host-controlled gate: the renderer open command is system-audience-only. */
export function requireHostAuthorizedRenderer(audience: string | undefined): void {
  if (audience !== 'system') {
    throw new Error('Renderer open is host-controlled and only a system audience may invoke it.')
  }
}