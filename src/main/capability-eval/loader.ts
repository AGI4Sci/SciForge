import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isTraceEvent, type TraceEvent } from '@sciforge/full-trace'
import { evalCaseSchema, type EvalCase } from './schema'

export class EvalCaseLoadError extends Error {
  readonly source: string
  readonly lineNumber?: number

  constructor(message: string, source: string, lineNumber?: number, cause?: unknown) {
    super(message, { cause })
    this.name = 'EvalCaseLoadError'
    this.source = source
    this.lineNumber = lineNumber
  }
}

export async function loadEvalCasesFromJsonl(filePath: string): Promise<EvalCase[]> {
  const source = resolve(filePath)
  let content: string
  try {
    content = await readFile(source, 'utf8')
  } catch (error) {
    throw new EvalCaseLoadError(`Unable to read eval case file ${source}.`, source, undefined, error)
  }
  return parseEvalCasesJsonl(content, source)
}

export function parseEvalCasesJsonl(content: string, source = '<inline>'): EvalCase[] {
  const cases: EvalCase[] = []
  const ids = new Set<string>()
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    let raw: unknown
    try {
      raw = JSON.parse(trimmed)
    } catch (error) {
      throw new EvalCaseLoadError(
        `Invalid JSONL at ${source}:${lineNumber}.`,
        source,
        lineNumber,
        error
      )
    }
    const parsed = evalCaseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new EvalCaseLoadError(
        `Invalid eval case at ${source}:${lineNumber}: ${parsed.error.message}`,
        source,
        lineNumber,
        parsed.error
      )
    }
    if (ids.has(parsed.data.id)) {
      throw new EvalCaseLoadError(
        `Duplicate eval case id "${parsed.data.id}" at ${source}:${lineNumber}.`,
        source,
        lineNumber
      )
    }
    ids.add(parsed.data.id)
    cases.push(parsed.data)
  }
  if (cases.length === 0) {
    throw new EvalCaseLoadError(`Eval case file ${source} does not contain any cases.`, source)
  }
  return cases
}

export async function loadTraceEventsFromJsonl(
  filePath: string,
  options: Readonly<{ allowEmpty?: boolean }> = {}
): Promise<TraceEvent[]> {
  const source = resolve(filePath)
  let content: string
  try {
    content = await readFile(source, 'utf8')
  } catch (error) {
    throw new EvalCaseLoadError(`Unable to read trace file ${source}.`, source, undefined, error)
  }
  return parseTraceEventsJsonl(content, source, options)
}

/** Parses the full-trace export format and skips its single metadata header. */
export function parseTraceEventsJsonl(
  content: string,
  source = '<inline-trace>',
  options: Readonly<{ allowEmpty?: boolean }> = {}
): TraceEvent[] {
  const events: TraceEvent[] = []
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: unknown
    try {
      raw = JSON.parse(trimmed)
    } catch (error) {
      throw new EvalCaseLoadError(`Invalid trace JSONL at ${source}:${lineNumber}.`, source, lineNumber, error)
    }
    if (!isTraceEvent(raw)) continue
    events.push(raw)
  }
  if (events.length === 0 && !options.allowEmpty) {
    throw new EvalCaseLoadError(`Trace file ${source} does not contain any valid trace events.`, source)
  }
  return events
}
