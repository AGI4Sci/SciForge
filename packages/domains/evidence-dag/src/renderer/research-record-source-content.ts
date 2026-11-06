/** Deterministic display projection of the returned source. Never fills absent facts. */
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function argumentsRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return record(value)
  try { return record(JSON.parse(value)) } catch { return {} }
}
function string(...values: unknown[]): string | undefined { return values.find(value => typeof value === 'string') as string | undefined }
function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)
}
export function researchRecordSourceFacts(raw: unknown) {
  const item = record(raw), meta = record(item.meta)
  const args = argumentsRecord(item.arguments ?? meta.arguments)
  const result = record(item.result), output = record(item.output)
  const command = string(item.command, meta.command, args.command, args.cmd)
  const exitCode = [item.exitCode, item.exit_code, meta.exitCode, meta.exit_code, result.exitCode, result.exit_code, output.exitCode, output.exit_code].find(value => typeof value === 'number' && Number.isInteger(value)) as number | undefined
  return {
    command, exitCode,
    status: string(item.status, meta.status),
    shell: string(item.shell, meta.shell, args.shell),
    workdir: string(item.cwd, item.workdir, meta.cwd, meta.workdir, args.cwd, args.workdir),
    truncated: [item, meta, result, output].some(value => value.truncated === true || value.outputTruncated === true),
    invalidArguments: typeof (item.arguments ?? meta.arguments) === 'string' && (() => { try { JSON.parse((item.arguments ?? meta.arguments) as string); return false } catch { return true } })()
  }
}
export function researchRecordSourceContent(raw: unknown): { label: string; text: string }[] {
  const item = record(raw), meta = record(item.meta), result = record(item.result), output = record(item.output)
  const facts = researchRecordSourceFacts(raw)
  const entries = [
    { label: '消息', text: text(item.text ?? item.message ?? item.prompt) },
    { label: '命令', text: facts.command ?? '' },
    { label: '执行说明', text: text(item.summary) },
    { label: '标准输出 stdout', text: text(item.stdout ?? meta.stdout ?? result.stdout ?? output.stdout) },
    { label: '标准错误 stderr', text: text(item.stderr ?? meta.stderr ?? result.stderr ?? output.stderr) },
    { label: '结果', text: text(item.detail ?? item.aggregatedOutput ?? item.output ?? item.result ?? meta.output) }
  ]
  return entries.filter(entry => entry.text.length > 0)
}
// ANSI formatting is removed only from the labelled readable output, never from raw/copy data.
const ansi = new RegExp(String.fromCharCode(27) + '(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\x07\\x1b]*(?:\\x07|' + String.fromCharCode(27) + '\\\\))', 'g')
export function readableRecordOutput(value: string): string { return value.replace(ansi, '') }
export const SOURCE_TEXT_PAGE = 6000
export function sourceTextPage(value: string, requestedPage: number) {
  const pages = Math.max(1, Math.ceil(value.length / SOURCE_TEXT_PAGE))
  const page = Math.max(0, Math.min(pages - 1, requestedPage))
  return { text: value.slice(page * SOURCE_TEXT_PAGE, (page + 1) * SOURCE_TEXT_PAGE), page, pages }
}
