import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { CapabilityJsonValue } from '../../shared/capability-broker'
import type {
  EvalCase,
  EvalFinalStateArtifact,
  EvalFinalStateLineage,
  EvalFinalStateEvidence,
  EvalFinalStateOutputLocator,
  EvalInvocation,
  EvalTrace
} from './schema'

export type WorkspaceFinalStateInspection = Readonly<{
  finalState?: CapabilityJsonValue
  taskSuccess?: boolean
  evidence: readonly string[]
  verifiedActions: readonly string[]
  unsupported: readonly string[]
}>

/**
 * Checks declared files and explicit JSON-field lineage in the case workspace.
 * It never infers success from a tool message or from a filename alone.
 */
export async function inspectWorkspaceFinalState(
  evalCase: EvalCase,
  workspaceDirectory: string,
  oracle: Partial<EvalFinalStateEvidence> = {},
  trace: Pick<EvalTrace, 'invocations'> = { invocations: [] }
): Promise<WorkspaceFinalStateInspection> {
  const expected = evalCase.expectedFinalState
  const hasWorkspaceChecks = (expected?.artifacts?.length ?? 0) > 0 || (expected?.dataLineage?.length ?? 0) > 0
  if (oracle.finalState === undefined && !hasWorkspaceChecks) {
    return {
      evidence: [...(oracle.evidence ?? [])],
      verifiedActions: [...(oracle.verifiedActions ?? [])],
      unsupported: []
    }
  }
  const baseState = isRecord(oracle.finalState) ? oracle.finalState : {}
  const evidence = [...(oracle.evidence ?? [])]
  const verifiedActions = new Set(oracle.verifiedActions ?? [])
  const unsupported: string[] = []
  const artifactState: Record<string, CapabilityJsonValue> = {}
  let checksPassed = true

  for (const artifact of expected?.artifacts ?? []) {
    const artifactResult = await inspectArtifact(workspaceDirectory, artifact, trace.invocations)
    artifactState[artifactLabel(artifact)] = artifactResult.state
    evidence.push(artifactResult.message)
    if (artifactResult.unsupported) unsupported.push(artifactResult.message)
    else {
      checksPassed = checksPassed && artifactResult.passed
      if (artifactResult.passed && artifactResult.verifiedActionId) verifiedActions.add(artifactResult.verifiedActionId)
    }
  }

  const lineageState: Record<string, CapabilityJsonValue> = {}
  for (const lineage of expected?.dataLineage ?? []) {
    const lineageResult = await inspectLineage(workspaceDirectory, lineage, trace.invocations)
    const key = `${lineageLabel(lineage, 'source')} → ${lineageLabel(lineage, 'target')}`
    lineageState[key] = lineageResult.state
    evidence.push(lineageResult.message)
    if (lineageResult.unsupported) unsupported.push(lineageResult.message)
    else {
      checksPassed = checksPassed && lineageResult.passed
      if (lineageResult.passed) {
        for (const actionId of lineageResult.verifiedActionIds) verifiedActions.add(actionId)
      }
    }
  }

  const finalState: Record<string, CapabilityJsonValue> = {
    ...baseState,
    ...(Object.keys(artifactState).length > 0 ? { artifacts: artifactState } : {}),
    ...(Object.keys(lineageState).length > 0 ? { dataLineage: lineageState } : {})
  }
  const inspectedTaskSuccess = oracle.taskSuccess !== undefined
    ? oracle.taskSuccess
    : unsupported.length > 0
      ? undefined
      : checksPassed
  return {
    finalState,
    ...(inspectedTaskSuccess !== undefined ? { taskSuccess: inspectedTaskSuccess } : {}),
    evidence,
    verifiedActions: [...verifiedActions],
    unsupported
  }
}

async function inspectArtifact(
  workspaceDirectory: string,
  expected: EvalFinalStateArtifact,
  invocations: readonly EvalInvocation[]
): Promise<Readonly<{
  passed: boolean
  unsupported: boolean
  state: CapabilityJsonValue
  message: string
  verifiedActionId?: string
}>> {
  const declaredPath = expected.path ?? outputPath(expected.pathFromOutput, invocations)
  const label = artifactLabel(expected)
  if (!declaredPath) {
    return {
      passed: false,
      unsupported: true,
      state: { status: 'unsupported' },
      message: `Artifact ${label}: output path was not available in the observed structured Action output.`
    }
  }
  const target = safeWorkspacePath(workspaceDirectory, declaredPath)
  let fileStats
  try {
    fileStats = await stat(target)
  } catch (error) {
    const exists = false
    const passed = expected.exists === exists
    return {
      passed,
      unsupported: false,
      state: { exists, error: errorCode(error) },
      message: `Artifact ${label}: ${exists ? 'exists' : 'missing'} (expected ${expected.exists ? 'present' : 'absent'}).`
    }
  }
  const isFile = fileStats.isFile()
  const existsPasses = expected.exists && isFile
  const sizePasses = expected.minBytes === undefined || fileStats.size >= expected.minBytes
  let formatPasses = true
  let jsonPathValue: CapabilityJsonValue | undefined
  if (expected.format && isFile) {
    const content = await readFile(target, 'utf8')
    formatPasses = expected.format === 'text' || parseArtifactContent(content, expected.format) !== undefined
    if (expected.jsonPath && (expected.format === 'json' || expected.format === 'jsonl')) {
      const parsed = parseArtifactContent(content, expected.format)
      jsonPathValue = parsed === undefined ? undefined : jsonPath(parsed, expected.jsonPath)
      formatPasses = formatPasses && jsonPathValue !== undefined
    }
  }
  const passed = existsPasses && sizePasses && formatPasses
  return {
      passed,
      unsupported: false,
      state: {
      exists: isFile,
      bytes: fileStats.size,
      ...(expected.format ? { formatValid: formatPasses } : {}),
      ...(jsonPathValue !== undefined ? { [expected.jsonPath ?? 'value']: jsonPathValue } : {})
    },
    message: `Artifact ${label}: ${passed ? 'verified' : 'verification failed'} (bytes=${fileStats.size}).`,
    ...(passed && expected.pathFromOutput ? { verifiedActionId: expected.pathFromOutput.actionId } : {})
  }
}

async function inspectLineage(
  workspaceDirectory: string,
  expected: EvalFinalStateLineage,
  invocations: readonly EvalInvocation[]
): Promise<Readonly<{
  passed: boolean
  unsupported: boolean
  state: CapabilityJsonValue
  message: string
  verifiedActionIds: readonly string[]
}>> {
  const sourceLabel = lineageLabel(expected, 'source')
  const targetLabel = lineageLabel(expected, 'target')
  if (!expected.sourceJsonPath && !expected.sourceFromOutput ||
      !expected.targetJsonPath && !expected.targetFromOutput) {
    return {
      passed: false,
      unsupported: true,
      state: { status: 'unsupported' },
      message: `Data lineage ${sourceLabel} → ${targetLabel}: explicit source/target JSON paths are required.`,
      verifiedActionIds: []
    }
  }
  try {
    const sourceValue = await lineageValue(workspaceDirectory, expected.sourcePath, expected.sourceFromOutput,
      expected.sourceJsonPath, invocations)
    const targetValue = await lineageValue(workspaceDirectory, expected.targetPath, expected.targetFromOutput,
      expected.targetJsonPath, invocations)
    const dynamicOutputUnavailable = (
      (expected.sourceFromOutput !== undefined && sourceValue === undefined) ||
      (expected.targetFromOutput !== undefined && targetValue === undefined)
    )
    if (dynamicOutputUnavailable) {
      return {
        passed: false,
        unsupported: true,
        state: { status: 'unsupported' },
        message: `Data lineage ${sourceLabel} → ${targetLabel}: source or target value was not available in observed structured Action output.`,
        verifiedActionIds: []
      }
    }
    const passed = sourceValue !== undefined && deepEqual(sourceValue, targetValue)
    return {
      passed,
      unsupported: false,
      state: { status: passed ? 'verified' : 'mismatch', sourceValue: sourceValue ?? null, targetValue: targetValue ?? null },
      message: `Data lineage ${sourceLabel} → ${targetLabel}: ${passed ? 'verified' : 'mismatch'}.`,
      verifiedActionIds: passed ? [
        ...(expected.sourceFromOutput ? [expected.sourceFromOutput.actionId] : []),
        ...(expected.targetFromOutput ? [expected.targetFromOutput.actionId] : [])
      ] : []
    }
  } catch (error) {
    return {
      passed: false,
      unsupported: false,
      state: { status: 'error', error: errorCode(error) },
      message: `Data lineage ${sourceLabel} → ${targetLabel}: ${errorMessage(error)}.`,
      verifiedActionIds: []
    }
  }
}

async function lineageValue(
  workspaceDirectory: string,
  path: string | undefined,
  locator: EvalFinalStateOutputLocator | undefined,
  jsonPathValue: string | undefined,
  invocations: readonly EvalInvocation[]
): Promise<CapabilityJsonValue | undefined> {
  if (locator) {
    const output = outputValue(locator, invocations)
    return jsonPathValue ? jsonPath(output, jsonPathValue) : output
  }
  if (!path || !jsonPathValue) return undefined
  const document = parseJsonFile(await readFile(safeWorkspacePath(workspaceDirectory, path), 'utf8'))
  return jsonPath(document, jsonPathValue)
}

function artifactLabel(expected: EvalFinalStateArtifact): string {
  return expected.path ?? outputLocatorLabel(expected.pathFromOutput)
}

function lineageLabel(expected: EvalFinalStateLineage, side: 'source' | 'target'): string {
  const path = side === 'source' ? expected.sourcePath : expected.targetPath
  const locator = side === 'source' ? expected.sourceFromOutput : expected.targetFromOutput
  return path ?? outputLocatorLabel(locator)
}

function outputPath(
  locator: EvalFinalStateOutputLocator | undefined,
  invocations: readonly EvalInvocation[]
): string | undefined {
  const value = locator ? outputValue(locator, invocations) : undefined
  return typeof value === 'string' && value.trim() ? value : undefined
}

function outputValue(
  locator: EvalFinalStateOutputLocator,
  invocations: readonly EvalInvocation[]
): CapabilityJsonValue | undefined {
  const invocation = [...invocations].reverse().find((candidate) => (
    candidate.actionId === locator.actionId && candidate.output !== undefined
  ))
  return invocation ? jsonPath(invocation.output, locator.jsonPath) : undefined
}

function outputLocatorLabel(locator: EvalFinalStateOutputLocator | undefined): string {
  return locator ? `${locator.actionId}.${locator.jsonPath}` : 'unknown'
}

function safeWorkspacePath(workspaceDirectory: string, path: string): string {
  const root = resolve(workspaceDirectory)
  const target = resolve(root, path)
  const targetRelative = relative(root, target)
  if (isAbsolute(targetRelative) || targetRelative === '..' || targetRelative.startsWith(`..${sep}`)) {
    throw new Error(`Workspace path escapes isolated workspace: ${path}`)
  }
  return target
}

function parseArtifactContent(content: string, format: 'json' | 'jsonl'): CapabilityJsonValue | undefined {
  try {
    if (format === 'json') return parseJsonFile(content)
    const lines = content.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
    return lines.map((line) => parseJsonFile(line))
  } catch {
    return undefined
  }
}

function parseJsonFile(content: string): CapabilityJsonValue {
  return JSON.parse(content) as CapabilityJsonValue
}

function jsonPath(value: unknown, path: string): CapabilityJsonValue | undefined {
  let current: unknown = value
  for (const part of path.split('.')) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return isJsonValue(current) ? current : undefined
}

function isRecord(value: unknown): value is Record<string, CapabilityJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is CapabilityJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
