import type { HostServiceClient } from './host-service-provider.js'
// The trusted runner loads this plain-JavaScript entrypoint directly in Node.
// @ts-expect-error The public TypeScript signatures are declared below.
import { createNativeExecutionClients as createClients, getNativeExecutionCommandRegistry as getRegistry } from './native-execution-client.mjs'

export const NATIVE_EXECUTION_SERVICE_ID = 'nativeExecution' as const
export const NATIVE_EXECUTION_PROVIDES = ['workingDirectory', 'sandboxPolicy', 'sandbox', 'subprocess', 'approval', 'commands'] as const
export type NativeExecutionPolicy = Readonly<{
  mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  workspaceRoot: string
  sessionId?: string
}>
export type NativeExecutionContext = Readonly<{ workspaceRoot: string; policy: NativeExecutionPolicy }>
export type NativeExecutionOutput = Readonly<{ text: string; lossy: boolean }>
export type NativeExecutionResult = Readonly<{
  exitCode: number | null
  signal?: string | null
  stdout: NativeExecutionOutput
  stderr: NativeExecutionOutput
}>
export type NativeExecutionSpawn = Readonly<{
  argv: readonly string[]
  cwd: string
  env: Readonly<Record<string, string>>
  stdio: Readonly<{
    stdin: Readonly<{ data: string }>
    stdout: Readonly<{ maxBytes: number }>
    stderr: Readonly<{ maxBytes: number }>
  }>
  graceMs: number
}>
/** Wire inputs contain no principal or agent: the Host binds the live invocation. */
export type NativeExecutionOperations = {
  'context.resolve': { input: Record<string, never>; output: NativeExecutionContext }
  'process.confine': { input: { argv: readonly string[]; policy: NativeExecutionPolicy }; output: { argv: [string]; enforcement: string } }
  'process.spawn': { input: NativeExecutionSpawn; output: { processId: string } }
  'process.wait': { input: { processId: string }; output: NativeExecutionResult }
  'process.stop': { input: { processId: string }; output: NativeExecutionResult }
  'approval.request': { input: { reason: string }; output: NativeExecutionApproval }
}
export type NativeExecutionApproval = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
export type NativeExecutionAgent = Readonly<{ session: Readonly<{ id: string }> }>
export type NativeExecutionProcessHandle = Readonly<{
  done: Promise<{ exitCode: number | null; signal: string | null }>
  collected: Readonly<{ stdout: { readFrom(offset: number): NativeExecutionOutput }; stderr: { readFrom(offset: number): NativeExecutionOutput } }>
  terminate(): Promise<void>
  waitForExit(): Promise<void>
}>
export type NativeExecutionCommandInvocation = Readonly<{ agent: NativeExecutionAgent; rawInput: string; signal: AbortSignal }>
export type NativeExecutionCommandResult = Readonly<{ kind: 'success' | 'error'; text: string }>
export type NativeExecutionCommand = Readonly<{
  name: string; description: string; input: Readonly<{ hint: string }>; recordInput: boolean
  handler(invocation: NativeExecutionCommandInvocation): Promise<NativeExecutionCommandResult>
}>
export type NativeExecutionCommandRegistry = Readonly<{
  register(definition: NativeExecutionCommand): () => void
  invoke(name: string, invocation: NativeExecutionCommandInvocation): Promise<NativeExecutionCommandResult>
}>
export type NativeExecutionClients = Readonly<{
  workingDirectory: { ensure(agent: NativeExecutionAgent, signal: AbortSignal): Promise<string> }
  sandboxPolicy: { resolve(request: { session: unknown }): NativeExecutionPolicy }
  sandbox: { confine(argv: readonly string[], policy: NativeExecutionPolicy, signal: AbortSignal): Promise<{ argv: [string]; enforcement: string }> }
  subprocess: { spawn(request: NativeExecutionSpawn & { signal: AbortSignal }): NativeExecutionProcessHandle }
  approval: { request(request: { agent?: unknown; toolName?: unknown; callId?: unknown; reason: string; signal: AbortSignal }): Promise<NativeExecutionApproval> }
  commands: NativeExecutionCommandRegistry
}>
export type NativeExecutionClientFactory = (bridge: HostServiceClient & { readonly invocationId?: string; readonly invocationToken?: object }, config?: Readonly<Record<string, unknown>>) => NativeExecutionClients
export const createNativeExecutionClients: NativeExecutionClientFactory = createClients
export const getNativeExecutionCommandRegistry: (clients: NativeExecutionClients) => NativeExecutionCommandRegistry = getRegistry
