// Narrow Host-consumer semantic gate, not a repository-wide typecheck.
import ts from 'typescript'
import path from 'node:path'
const root = process.cwd()
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
const consumer = path.resolve('packages/workers/dsh-runtime/test/contract-typecheck.ts')
const host = ts.createCompilerHost({ ...parsed.options, noEmit: true })
const read = host.readFile.bind(host)
host.readFile = name => {
  const text = read(name)
  // Base branch lacks the third ID. Parent owns that one composition change.
  return name.endsWith('/src/shared/agent-runtime-contract.ts') && text?.includes("export type AgentRuntimeId = 'sciforge' | 'codex' | 'claude'\n")
    ? text.replace("export type AgentRuntimeId = 'sciforge' | 'codex' | 'claude'\n", "export type AgentRuntimeId = 'sciforge' | 'codex' | 'claude' | 'dsh'\n") : text
}
const program = ts.createProgram([consumer, path.resolve('packages/workers/dsh-runtime/src/yaml.d.ts')], { ...parsed.options, noEmit: true }, host)
const diagnostics = program.getSemanticDiagnostics(program.getSourceFile(consumer))
console.log('Narrow consumer with virtual dsh-ID addition only; no Host source writes.')
console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: x => x, getNewLine: () => '\n' }))
console.log('selected-consumer diagnostics', diagnostics.length)
process.exitCode = diagnostics.length ? 1 : 0
