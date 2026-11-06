import { useEffect, useRef, useState } from 'react'
import type { CodeRevision, CodeRun, CodeRevisionSummary, CodeRunSummary, HistoryPage } from '../figure-store/code-runs.js'
import type { FigureOperationResult } from '../figure-store/index.js'
import type { FiguresClient } from './FiguresPanel.js'
import './CodeRunsPanel.css'

export type CodeRunsTransport = <T = unknown>(action: string, input: unknown) => Promise<T>
type SourceFile = { path: string; content: string }
type CodeSource = CodeRevision & { sourceFiles: SourceFile[] }
export interface CodeRunSelection { runId: string; codeRevisionId: string; requestId: string }
export interface CodeRunsPanelProps {
  call: CodeRunsTransport
  client: Pick<FiguresClient, 'list' | 'read'>
  onPublished?: (result: FigureOperationResult) => Promise<void> | void
  selection?: CodeRunSelection
}

const sample = `import json
import os
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

parameters = json.loads(os.environ.get("SCIENTIFIC_FIGURES_PARAMETERS_JSON", "{}"))
input_dir = Path(os.environ["SCIENTIFIC_FIGURES_INPUT_DIR"])
output_dir = Path(os.environ["SCIENTIFIC_FIGURES_OUTPUT_DIR"])
# Read snapshotted inputs using input_dir / "relative/path.csv".
x = parameters.get("x", [0, 1, 2, 3])
y = parameters.get("y", [0, 1, 4, 9])
fig, ax = plt.subplots()
ax.plot(x, y, marker="o")
ax.set(xlabel="x", ylabel="y", title=parameters.get("title", "Python figure"))
fig.tight_layout()
fig.savefig(output_dir / "figure.png", dpi=160)
plt.close(fig)
print("Saved figure.png")
`
const describe = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)
const pretty = (value: unknown) => JSON.stringify(value, null, 2)
const signature = (entrypoint: string, source: string, additional: string, parameters: string, inputs: string) => JSON.stringify([entrypoint, source, additional, parameters, inputs])

function filesFromDraft(entrypoint: string, source: string, additional: string): SourceFile[] {
  const extra: unknown = JSON.parse(additional)
  if (!Array.isArray(extra) || extra.some(file => !file || typeof file !== 'object' || typeof file.path !== 'string' || typeof file.content !== 'string')) throw new Error('附加文件必须为 [{"path":"helper.py","content":"..."}] JSON 数组。')
  const files = [{ path: entrypoint, content: source }, ...extra as SourceFile[]]
  if (!entrypoint.endsWith('.py')) throw new Error('入口文件必须为 .py 文件。')
  if (files.some(file => !file.path || /^(?:[/\\]|[A-Za-z]:)/.test(file.path) || file.path.includes('\\') || file.path.split('/').some(part => !part || part === '.' || part === '..'))) throw new Error('源文件路径必须为安全的相对路径。')
  if (new Set(files.map(file => file.path)).size !== files.length) throw new Error('源文件路径不可重复。')
  return files
}

/** Exact line comparison, retaining unchanged line numbers without a diff dependency. */
function sourceDiff(before: SourceFile[], after: SourceFile[]): string {
  const old = new Map(before.map(file => [file.path, file.content]))
  const next = new Map(after.map(file => [file.path, file.content]))
  const sections: string[] = []
  for (const path of new Set([...old.keys(), ...next.keys()])) {
    if (old.get(path) === next.get(path)) continue
    const a = old.get(path)?.split('\n') ?? [], b = next.get(path)?.split('\n') ?? []
    let start = 0, endA = a.length, endB = b.length
    while (start < endA && start < endB && a[start] === b[start]) start++
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
    sections.push(`--- ${old.has(path) ? path : '/dev/null'}\n+++ ${next.has(path) ? path : '/dev/null'}\n@@ ${start + 1} @@\n${[...a.slice(start, endA).map(line => `- ${line}`), ...b.slice(start, endB).map(line => `+ ${line}`)].join('\n')}`)
  }
  return sections.join('\n\n') || '源文件完全相同。'
}

export function CodeRunsPanel({ call, client, onPublished, selection }: CodeRunsPanelProps): React.JSX.Element {
  const [codes, setCodes] = useState<CodeRevisionSummary[]>([])
  const [runs, setRuns] = useState<CodeRunSummary[]>([])
  const [pendingRuns, setPendingRuns] = useState<Array<{ runId: string; codeRevisionId: string; startedAt: string; recoverable?: boolean }>>([])
  const [codeCursor, setCodeCursor] = useState<string | null>(null)
  const [runCursor, setRunCursor] = useState<string | null>(null)
  const [historyErrors, setHistoryErrors] = useState<string[]>([])
  const [codeId, setCodeId] = useState('')
  const [code, setCode] = useState<CodeSource | null>(null)
  const [parent, setParent] = useState<CodeSource | null>(null)
  const [entrypoint, setEntrypoint] = useState('main.py')
  const [source, setSource] = useState(sample)
  const [additional, setAdditional] = useState('[]')
  const [parameters, setParameters] = useState('{}')
  const [inputs, setInputs] = useState('[]')
  const [refreshInputs, setRefreshInputs] = useState(false)
  const [savedSignature, setSavedSignature] = useState('')
  const [runId, setRunId] = useState('')
  const [run, setRun] = useState<CodeRun | null>(null)
  const [outputPath, setOutputPath] = useState('')
  const [documents, setDocuments] = useState<Array<{ documentId: string }>>([])
  const [documentId, setDocumentId] = useState('')
  const [asCandidate, setAsCandidate] = useState(false)
  const [baseline, setBaseline] = useState<{ documentId: string; documentRevision: number; revisionId: string; hash: string } | null>(null)
  const [discard, setDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)
  const locked = useRef(false)
  const runHeading = useRef<HTMLHeadingElement>(null)
  const appliedSelection = useRef('')
  const draftSignature = signature(entrypoint, source, additional, parameters, inputs)
  const dirty = savedSignature !== draftSignature || refreshInputs

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const loadHistory = async (kind: 'codes' | 'runs', cursor?: string) => {
    const page = await call<HistoryPage<CodeRevisionSummary> | HistoryPage<CodeRunSummary>>(kind === 'codes' ? 'listCodes' : 'listRuns', { limit: 20, ...(cursor ? { cursor } : {}) })
    if (!mounted.current) return
    if (kind === 'codes') { setCodes(previous => cursor ? [...previous, ...page.items as CodeRevisionSummary[]] : page.items as CodeRevisionSummary[]); setCodeCursor(page.nextCursor) }
    else { setRuns(previous => cursor ? [...previous, ...page.items as CodeRunSummary[]] : page.items as CodeRunSummary[]); setRunCursor(page.nextCursor) }
    if (page.errors.length) setHistoryErrors(previous => [...previous, ...page.errors.map(item => `${item.id}: ${item.error}`)])
  }
  const refreshLists = async () => {
    setHistoryErrors([])
    // Recovery discovery must survive an unavailable/corrupt history or document list.
    const results = await Promise.allSettled([
      loadHistory('codes'), loadHistory('runs'),
      client.list().then(next => { if (mounted.current) setDocuments(next) }),
      call<typeof pendingRuns>('listPendingRuns', {}).then(next => { if (mounted.current) setPendingRuns(next) }),
    ])
    if (mounted.current) setHistoryErrors(previous => [...previous, ...results.filter(result => result.status === 'rejected').map(result => describe((result as PromiseRejectedResult).reason))])
  }
  const act = async (action: () => Promise<void>) => {
    if (locked.current) return
    locked.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (reason) { if (mounted.current) setError(describe(reason)) }
    finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  useEffect(() => { void act(refreshLists) }, [call, client])

  const loadCode = async (id: string) => {
    const next = await call<CodeSource>('readCode', { codeRevisionId: id })
    const previous = next.parentCodeRevisionId ? await call<CodeSource>('readCode', { codeRevisionId: next.parentCodeRevisionId }) : null
    const main = next.sourceFiles.find(file => file.path === next.entrypoint)
    if (!main) throw new Error('代码版本缺少入口文件。')
    if (!mounted.current) return
    const other = pretty(next.sourceFiles.filter(file => file.path !== next.entrypoint))
    const params = pretty(next.parameters), paths = pretty(next.inputs.map(input => input.originalPath))
    setCode(next); setCodeId(id); setParent(previous); setEntrypoint(next.entrypoint); setSource(main.content)
    setAdditional(other); setParameters(params); setInputs(paths); setRefreshInputs(false)
    setSavedSignature(signature(next.entrypoint, main.content, other, params, paths)); setDiscard(false)
  }
  const loadRun = async (id: string) => {
    const next = await call<CodeRun>('readRun', { runId: id })
    if (mounted.current) { setRun(next); setRunId(id); setOutputPath(next.outputs.find(output => /\.png$/i.test(output.path))?.path ?? ''); setBaseline(null) }
  }
  useEffect(() => {
    if (!selection || locked.current || appliedSelection.current === selection.requestId) return
    appliedSelection.current = selection.requestId
    // A provenance jump selects the run only; an unsaved code draft remains intact.
    void act(async () => { await loadRun(selection.runId); runHeading.current?.scrollIntoView({ block: 'nearest' }); runHeading.current?.focus() })
  }, [selection?.requestId, busy])

  const saveCode = async () => {
    const files = filesFromDraft(entrypoint.trim(), source, additional)
    const inputPaths: unknown = JSON.parse(inputs)
    if (!Array.isArray(inputPaths) || inputPaths.some(path => typeof path !== 'string')) throw new Error('输入路径必须为字符串 JSON 数组。')
    const result = await call<CodeRevision>('saveCode', { codeRevisionId: crypto.randomUUID(), parentCodeRevisionId: code?.codeRevisionId ?? null, entrypoint: entrypoint.trim(), files, parameters: JSON.parse(parameters), ...(!code || refreshInputs ? { inputPaths } : {}) })
    await loadCode(result.codeRevisionId)
    await refreshLists()
    setNotice('代码与输入已冻结保存；尚未执行。')
  }
  const publish = async () => {
    if (!run || !/\.png$/i.test(outputPath) || run.status !== 'completed') throw new Error('请选择成功运行的输出文件。')
    if (asCandidate && (!baseline || baseline.documentId !== documentId)) throw new Error('请读取并确认目标文档的明确基线。')
    const result = await call<FigureOperationResult>('publishRun', {
      documentId: asCandidate ? documentId : crypto.randomUUID(), operationId: crypto.randomUUID(),
      expectedDocumentRevision: asCandidate ? baseline!.documentRevision : 0, runId: run.runId, outputPath,
      ...(asCandidate ? { baselineRevisionId: baseline!.revisionId, baselineHash: baseline!.hash } : {})
    })
    setBaseline(null)
    await refreshLists()
    await onPublished?.(result)
    setNotice(asCandidate ? '输出已发布为候选图；接受仍需活跃会话中的正式审批。' : '输出已发布为新的图件文档。')
  }
  let diff = ''
  try { diff = sourceDiff(code ? (dirty ? code.sourceFiles : parent?.sourceFiles ?? []) : [], filesFromDraft(entrypoint, source, additional)) }
  catch (reason) { diff = describe(reason) }

  return <section className="code-runs-panel" aria-label="Python 代码与运行">
    <header><h2>Python 代码与运行</h2><button type="button" disabled={busy} onClick={() => void act(refreshLists)}>刷新列表</button></header>
    {error && <div className="code-runs-error" role="alert">{error}</div>}
    {historyErrors.length > 0 && <details><summary>部分历史记录不可用（其他记录及恢复入口仍可使用）</summary><pre>{historyErrors.join('\n')}</pre></details>}
    {notice && <p role="status">{notice}</p>}
    {busy && <p role="status">正在处理；Python 执行完成后返回运行记录……</p>}
    <fieldset disabled={busy}>
      <legend>1. 编辑代码</legend>
      <div className="code-runs-row"><label>版本<select value={codeId} onChange={event => setCodeId(event.target.value)}><option value="">选择版本</option>{codes.map(item => <option key={item.codeRevisionId} value={item.codeRevisionId}>{item.codeRevisionId} · {item.createdAt}</option>)}</select></label>{codeCursor && <button type="button" onClick={() => void act(() => loadHistory('codes', codeCursor))}>更多代码版本</button>}<button type="button" disabled={!codeId || (dirty && !discard)} onClick={() => void act(() => loadCode(codeId))}>载入版本</button></div>
      {dirty && <label className="code-runs-check"><input type="checkbox" checked={discard} onChange={event => setDiscard(event.target.checked)} />允许载入版本时放弃当前未保存代码</label>}
      <p>{dirty ? '修改后先保存，再运行。' : '已保存，可以运行。'}</p>
      {code && <details><summary>版本与输入快照</summary><pre>{pretty({ codeRevisionId: code.codeRevisionId, parentCodeRevisionId: code.parentCodeRevisionId, createdAt: code.createdAt, files: code.files, inputs: code.inputs })}</pre></details>}
      <details><summary>高级设置：参数、输入与文件</summary><label>入口文件<input value={entrypoint} onChange={event => setEntrypoint(event.target.value)} placeholder="main.py" /></label>

      <details><summary>附加源文件 JSON</summary><label>文件数组<textarea value={additional} onChange={event => setAdditional(event.target.value)} spellCheck={false} /></label></details>
      <div className="code-runs-grid"><label>参数 JSON<textarea value={parameters} onChange={event => setParameters(event.target.value)} spellCheck={false} /></label>{code && <label className="code-runs-check"><input type="checkbox" checked={refreshInputs} onChange={event => setRefreshInputs(event.target.checked)} />重新读取工作区数据（默认继承父版本冻结输入）</label>}<label>工作区输入路径 JSON<textarea disabled={Boolean(code && !refreshInputs)} value={inputs} onChange={event => setInputs(event.target.value)} spellCheck={false} /></label></div>
      <p>代码通过 SCIENTIFIC_FIGURES_PARAMETERS_JSON 读取 JSON 参数，通过 SCIENTIFIC_FIGURES_INPUT_DIR 读取冻结输入；将 PNG、CSV、TSV、JSON 或 TXT 结果写入 SCIENTIFIC_FIGURES_OUTPUT_DIR，成功后会保存。运行仅向本次暂存目录写入；DSH 文件写入沙箱不限制全局读取或网络访问，请执行可信代码。</p></details>
      <label>Python 源码<textarea className="code-runs-source" value={source} onChange={event => setSource(event.target.value)} spellCheck={false} /></label>
      <details><summary>{dirty && code ? '与已载入版本比较（精确源码）' : '与父版本比较（精确源码）'}</summary><pre className="code-runs-diff">{diff}</pre>{!dirty && parent && <pre>{pretty({ parentParameters: parent.parameters, parameters: code?.parameters, parentInputs: parent.inputs, inputs: code?.inputs })}</pre>}</details>
      <div className="code-runs-row"><button type="button" disabled={!dirty} onClick={() => void act(saveCode)}>保存并冻结代码</button><button type="button" disabled={!code || dirty} onClick={() => void act(async () => {
        const next = await call<CodeRun>('executePython', { runId: crypto.randomUUID(), codeRevisionId: code!.codeRevisionId })
        if (mounted.current) { setRun(next); setRunId(next.runId); setOutputPath(next.outputs.find(output => /\.png$/i.test(output.path))?.path ?? ''); setBaseline(null) }
        await refreshLists()
      })}>执行已冻结 Python</button></div>
    </fieldset>
    <fieldset disabled={busy}>
      <legend>2. 查看结果并发布</legend>
      {pendingRuns.length > 0 && <details><summary>尚未结束或中断的运行（{pendingRuns.length}）</summary><p>只有已保存进程结果的运行可完成记录；其余需先检查进程与暂存目录，不自动重跑或清理。</p><pre>{pretty(pendingRuns)}</pre>{pendingRuns.filter(item => item.recoverable).map(item => <button type="button" key={item.runId} onClick={() => void act(async () => { await call('executePython', { runId: item.runId, codeRevisionId: item.codeRevisionId }); await loadRun(item.runId); await refreshLists() })}>完成中断记录 {item.runId}</button>)}</details>}
      <h3 ref={runHeading} tabIndex={-1}>运行详情</h3>
      <div className="code-runs-row"><label>运行<select value={runId} onChange={event => setRunId(event.target.value)}><option value="">选择运行</option>{runs.map(item => <option key={item.runId} value={item.runId}>{item.runId} · {item.status} · {item.codeRevisionId}</option>)}</select></label>{runCursor && <button type="button" onClick={() => void act(() => loadHistory('runs', runCursor))}>更多运行记录</button>}<button type="button" disabled={!runId} onClick={() => void act(() => loadRun(runId))}>读取运行</button></div>
      {run && <>
        <dl><dt>运行 / 代码</dt><dd>{run.runId} / {run.codeRevisionId}</dd><dt>状态 / 退出码</dt><dd>{run.status} / {run.exitCode ?? '—'}</dd><dt>执行时间</dt><dd>{run.startedAt} → {run.finishedAt}</dd></dl>
        <button type="button" disabled={dirty && !discard} onClick={() => void act(() => loadCode(run.codeRevisionId))}>载入此运行的代码</button>
        {run.error && <p className="code-runs-error">{run.error}</p>}
        <details><summary>标准输出{run.stdoutTruncated ? '（已截断）' : ''}</summary><pre>{run.stdout || '（空）'}</pre></details>
        <details><summary>标准错误{run.stderrTruncated ? '（已截断）' : ''}</summary><pre>{run.stderr || '（空）'}</pre></details>
        <details><summary>运行环境与完整性</summary><pre>{pretty({ environment: run.environment, code: run.code, outputs: run.outputs })}</pre></details>
        <label>输出文件<select value={outputPath} onChange={event => setOutputPath(event.target.value)}><option value="">选择输出</option>{run.outputs.map(output => <option key={output.path} value={output.path}>{output.path} · {output.byteLength} bytes</option>)}</select></label>
        {run.outputs.find(output => output.path === outputPath) && <p className="code-runs-hash">SHA-256: {run.outputs.find(output => output.path === outputPath)!.sha256}</p>}
        <p>所有输出文件均按路径、摘要和字节数保存。CSV/JSON 等分析文件可用作下一版本的显式输入；只有 PNG 可以发布为图件。_environment 中保存依赖版本、环境清单和重建说明，不会自动安装依赖。</p>
         <label className="code-runs-check"><input type="checkbox" checked={asCandidate} onChange={event => { setAsCandidate(event.target.checked); setBaseline(null) }} />发布为现有文档的候选图</label>
        {asCandidate && <>
          <label>目标文档<select value={documentId} onChange={event => { setDocumentId(event.target.value); setBaseline(null) }}><option value="">选择文档</option>{documents.map(item => <option key={item.documentId} value={item.documentId}>{item.documentId}</option>)}</select></label>
          <button type="button" disabled={!documentId} onClick={() => void act(async () => {
            const target = await client.read(documentId)
            const current = target.revisions.find(item => item.metadata.revisionId === target.currentRevisionId)?.metadata
            if (!current) throw new Error('目标文档缺少当前图件版本。')
            setBaseline({ documentId: target.documentId, documentRevision: target.documentRevision, revisionId: current.revisionId, hash: current.image.sha256 })
          })}>读取并选定当前基线</button>
          {baseline && <p className="code-runs-hash">明确基线：{baseline.revisionId} · 文档修订 {baseline.documentRevision}<br />SHA-256: {baseline.hash}</p>}
        </>}
        <button type="button" disabled={run.status !== 'completed' || !/\.png$/i.test(outputPath) || (asCandidate && !baseline)} onClick={() => void act(publish)}>{asCandidate ? '发布为候选图' : '发布为新图件文档'}</button>
        <p>发布候选后，回到“图件”比较并申请接受。</p>
      </>}
    </fieldset>
  </section>
}
