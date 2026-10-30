import { z } from 'zod'

/**
 * Managed Runtime contribution contract for the Broker bridge (BUG-025).
 *
 * P3-style plugins run a LOCAL in-memory MCP fixture. This SDK layer builds
 * Broker-visible discover contracts for the fixture operations WITHOUT
 * pretending to be a real remote MCP server and WITHOUT entering the external
 * `runtimeMcpToolGateway`. Contracts keep the native provider family but carry
 * `managed-runtime` / `managed-mcp` / `local-fixture` tags so the Agent can
 * find them by tags/text and knows they are local managed fixtures.
 */

export const MANAGED_RUNTIME_TAGS = ['managed-runtime', 'managed-mcp', 'local-fixture'] as const

export type ManagedRuntimeContract = Readonly<{
  operation: string
  capabilityId: string
  category: 'managed-runtime'
  title: string
  description: string
  effect: 'read' | 'compute'
  approval: 'none'
  audiences: readonly ('agent' | 'system')[]
  tags: readonly string[]
  version: string
  inputSchema: z.ZodType
  outputSchema: z.ZodType
}>

export type ManagedRuntimeOperationConfig = Readonly<{
  effect?: 'read' | 'compute'
  approval?: 'none' | 'system'
  audiences?: readonly ('agent' | 'system')[]
  inputSchema?: z.ZodType
  outputSchema?: z.ZodType
  title?: string
  description?: string
}>

export class ManagedRuntimeAdapter {
  readonly #namespace: string
  readonly #version: string
  readonly #config: Readonly<Record<string, ManagedRuntimeOperationConfig>>

  constructor(options: Readonly<{
    namespace: string
    version?: string
    /** Per-operation overrides so a plugin does not force every op to read/none/unknown. */
    operations?: Readonly<Record<string, ManagedRuntimeOperationConfig>>
  }>) {
    this.#namespace = options.namespace
    this.#version = options.version ?? '0.1.0'
    this.#config = options.operations ?? {}
  }

  /** Build contracts ONLY for operations explicitly declared by the adapter (fail-closed otherwise). */
  contracts(operations: readonly string[]): readonly ManagedRuntimeContract[] {
    return Object.freeze(operations
      .map((operation) => ({ operation, config: this.#config[operation] }))
      .filter((entry): entry is { operation: string; config: ManagedRuntimeOperationConfig } => entry.config !== undefined)
      .map(({ operation, config }) => Object.freeze({
        operation,
        capabilityId: `${this.#namespace}.${operation}`,
        category: 'managed-runtime',
        title: config.title ?? `${this.#namespace} ${operation}`,
        description: config.description ?? `Managed runtime operation ${operation}.`,
        // fail-closed defaults: unknown/undeclared ops are invisible; declared ops without explicit
        // read+none approval require system approval and are not freely invokable by agents.
        effect: config.effect ?? 'compute',
        approval: config.approval ?? 'system',
        audiences: Object.freeze(config.audiences ?? ['system']),
        tags: Object.freeze([...MANAGED_RUNTIME_TAGS]),
        version: this.#version,
        inputSchema: config.inputSchema ?? z.unknown(),
        outputSchema: config.outputSchema ?? z.unknown(),
      }) as ManagedRuntimeContract))
  }
}