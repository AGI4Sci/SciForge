import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { Window } from 'happy-dom'
import React, { act } from 'react'

// Exercise the shipped panel/controller and transport contracts without UI mocks.
test('chat/file UI requests fresh acceptance and code/run UI preserves source drafts through publication', async () => {
  const window = new Window()
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'MouseEvent', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : (window as unknown as Record<string, unknown>)[key] })
  const { createRoot } = await import('react-dom/client')
  const container = window.document.createElement('div')
  window.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  try {
    const bundle = await build({
      absWorkingDir: new URL('..', import.meta.url).pathname,
      entryPoints: ['src/ui/FiguresPanel.tsx'], bundle: true, write: false,
      platform: 'browser', format: 'esm', jsx: 'automatic', packages: 'external',
      loader: { '.css': 'empty' }, metafile: true
    })
    const bundleInputs = Object.keys(bundle.metafile!.inputs)
    assert.ok(!bundleInputs.some(path => /figure-store\/(index|code-runs)\.ts$/.test(path)), 'store implementations must not enter the browser bundle')
    assert.ok(!bundleInputs.some(path => /review-ui\/|VisualReviewSurface/.test(path)), 'graphical review controls must not enter the browser bundle')
    assert.doesNotMatch(bundle.outputFiles![0].text, /VisualReviewSurface|visual-review-toolbar|标注工具栏/, 'bundle must not retain a graphical annotation toolbar')
    const source = bundle.outputFiles![0].text
      .replaceAll('from "react/jsx-runtime"', `from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))}`)
      .replaceAll('from "react"', `from ${JSON.stringify(import.meta.resolve('react'))}`)
    const { FiguresPanel } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
    type File = { path: string; content: string }
    type Saved = { codeRevisionId: string; parentCodeRevisionId: string | null; entrypoint: string; files: File[]; parameters: unknown; inputPaths?: string[] }
    const calls: Array<{ action: string; input: Record<string, unknown> }> = []
    type CodeRecord = Saved & { schemaVersion: number; language: string; createdAt: string; sourceFiles: File[]; inputs: Array<{ originalPath: string }>; requestHash: string }
    const codes = new Map<string, CodeRecord>()
    function codeRecord(input: Saved): CodeRecord {
      return { ...input, schemaVersion: 1, language: 'python', createdAt: '2026-11-05T00:00:00Z', sourceFiles: input.files,
        files: [], inputs: (input.inputPaths ?? (input.parentCodeRevisionId ? codes.get(input.parentCodeRevisionId)?.inputs.map(item => item.originalPath) : []) ?? []).map(originalPath => ({ originalPath })), requestHash: 'hash' }
    }
    const original = codeRecord({ codeRevisionId: 'existing-code', parentCodeRevisionId: null, entrypoint: 'main.py', files: [{ path: 'main.py', content: 'print("existing")\n' }], parameters: {}, inputPaths: ['data.csv'] })
    codes.set(original.codeRevisionId, original)
    const image = { sha256: 'a'.repeat(64), byteLength: 10 }
    let documentRevision = 7
    let latestRun: Record<string, unknown> | null = null
    const documents = new Set(['doc-a'])
    const client = {
      list: async () => [...documents].map(documentId => ({ documentId })),
      read: async (documentId: string) => ({ documentId, documentRevision, originalRevisionId: 'image-a', currentRevisionId: 'image-a', annotations: [], revisions: [
        { status: 'current', metadata: { revisionId: 'image-a', image, originalFilename: 'original.png' } },
        ...(documentRevision > 7 ? [{ status: 'candidate', metadata: { revisionId: 'candidate', image, originalFilename: 'candidate.png' } }] : [])
      ] }),
      image: async () => ({ src: 'data:image/png;base64,', width: 10, height: 10 }),
      saveAnnotations: async () => { throw new Error('Publication must not implicitly save an annotation draft') }
    }
    let failHistory = false
    const call = async (action: string, input: Record<string, unknown>) => {
      calls.push({ action, input })
      switch (action) {
        case 'listCodes': return { items: input.cursor ? [{ ...original, codeRevisionId: 'older-code' }] : [...codes.values()], nextCursor: input.cursor ? null : 'existing-code', errors: [] }
        case 'listRuns': if (failHistory) throw new Error('History unavailable'); return { items: latestRun ? [latestRun] : [], nextCursor: null, errors: [] }
        case 'listPendingRuns': return failHistory ? [{ runId: 'interrupted', codeRevisionId: 'existing-code', startedAt: '2026-11-05T00:00:00Z', recoverable: true }] : []
        case 'readCode': { const code = codes.get(String(input.codeRevisionId)); assert.ok(code); return code }
        case 'saveCode': { const code = codeRecord(input as Saved); codes.set(code.codeRevisionId, code); return code }
        case 'executePython':
          latestRun = { schemaVersion: 1, ...input, status: 'completed', exitCode: 0, stdout: 'saved PNG', stderr: '', stdoutTruncated: false, stderrTruncated: false, environment: { python: '3.12' },
            outputs: [{ path: `runs/${input.runId}/outputs/_environment/requirements.txt`, ...image }, { path: `runs/${input.runId}/outputs/figure.png`, ...image }, { path: `runs/${input.runId}/outputs/stats.csv`, ...image }], code: { path: `codes/${input.codeRevisionId}/code.json`, ...image }, startedAt: '2026-11-05T00:00:00Z', finishedAt: '2026-11-05T00:00:01Z' }
          return latestRun
        case 'readRun': assert.equal(input.runId, latestRun?.runId); return latestRun
        case 'publishRun': documents.add(String(input.documentId)); documentRevision++; return { documentId: input.documentId, documentRevision, status: 'completed' }
        default: throw new Error(`Unexpected UI action: ${action}`)
      }
    }
    const button = (text: string) => {
      const found = [...container.querySelectorAll('button')].find(item => item.textContent === text)
      assert.ok(found, `Missing button: ${text}`)
      return found
    }
    const click = async (text: string) => { const target = button(text); assert.equal(target.disabled, false, text); await act(async () => { target.click() }) }
    const field = (label: string) => {
      const found = [...container.querySelectorAll('label')].find(item => item.firstChild?.textContent === label)
      assert.ok(found, `Missing label: ${label}`)
      const control = found.querySelector('input,select,textarea')!
      assert.ok(control)
      return control
    }
    const changeControl = async (control: NonNullable<ReturnType<typeof container.querySelector>>, value: string) => {
      await act(async () => {
        // Bypass React's value tracker just as native keyboard input does.
        const prototype = control.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : control.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value)
        control.dispatchEvent(new window.Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
      })
    }
    const change = async (label: string, value: string) => changeControl(field(label), value)
    const changeAria = async (label: string, value: string) => {
      const control = container.querySelector(`[aria-label="${label}"]`)
      assert.ok(control, label)
      await changeControl(control, value)
    }
    const toggle = async (text: string) => {
      const label = [...container.querySelectorAll('label')].find(item => item.textContent?.includes(text))
      assert.ok(label, text)
      await act(async () => { label.querySelector('input')!.click() })
    }
    const requests: Array<Record<string, unknown>> = []
    await act(async () => { root.render(React.createElement(FiguresPanel, { client, codeRunsCall: call, onSendRequest: async (input: Record<string, unknown>) => { requests.push(input) } })) })
    await click('新建')
    assert.equal(button('从数据开始').getAttribute('aria-pressed'), 'true')
    assert.equal(button('开始绘图').disabled, true)
    await changeAria('新建数据文件', 'data.csv')
    await changeAria('新建绘图要求', 'Plot the frozen data')
    await click('开始绘图')
    assert.deepEqual(requests[0], { mode: 'data', text: 'Plot the frozen data', filePath: 'data.csv' })
    await click('已有数据和代码')
    await changeAria('新建绘图要求', 'Use my code and data')
    assert.equal(button('开始绘图').disabled, true, 'code mode requires source code')
    await changeAria('已有代码文件', 'scripts/main.py')
    assert.equal(button('开始绘图').disabled, false, 'the comparison image is optional')
    await click('开始绘图')
    assert.deepEqual(requests[1], { mode: 'code', text: 'Use my code and data', filePath: 'data.csv', codePath: 'scripts/main.py' })
    await changeAria('已有图片文件', 'figures/provided.png')
    await changeAria('新建绘图要求', 'Keep the supplied image for comparison')
    await click('开始绘图')
    assert.deepEqual(requests[2], { mode: 'code', text: 'Keep the supplied image for comparison', filePath: 'data.csv', codePath: 'scripts/main.py', imagePath: 'figures/provided.png' })
    await click('代码与运行')
    assert.ok(calls.some(item => item.action === 'listPendingRuns'))
    await click('更多代码版本')
    assert.ok(calls.some(item => item.action === 'listCodes' && item.input.cursor === 'existing-code' && item.input.limit === 20))
    assert.equal(button('执行已冻结 Python').disabled, true)
    await change('版本', 'existing-code')
    assert.equal(button('载入版本').disabled, true, 'unsaved sample requires explicit discard before loading')
    await toggle('允许载入版本时放弃当前未保存代码')
    await click('载入版本')
    assert.equal((field('Python 源码') as unknown as HTMLTextAreaElement).value, 'print("existing")\n')
    await change('Python 源码', 'print("edited child")\n')
    assert.equal(button('执行已冻结 Python').disabled, true, 'edited source cannot execute as its old frozen version')
    await click('刷新列表')
    assert.equal((field('Python 源码') as unknown as HTMLTextAreaElement).value, 'print("edited child")\n', 'list refresh retains source draft')
    await click('保存并冻结代码')
    const saved = calls.find(item => item.action === 'saveCode')!.input
    assert.equal(saved.parentCodeRevisionId, 'existing-code')
    assert.equal(Object.hasOwn(saved, 'inputPaths'), false, 'child edits inherit frozen inputs by default')
    assert.deepEqual(codes.get(String(saved.codeRevisionId))!.inputs, [{ originalPath: 'data.csv' }])
    assert.equal((field('工作区输入路径 JSON') as unknown as HTMLTextAreaElement).disabled, true)
    assert.notEqual(saved.codeRevisionId, 'existing-code')
    assert.deepEqual(saved.files, [{ path: 'main.py', content: 'print("edited child")\n' }])
    assert.equal(calls.some(item => item.action === 'executePython'), false, 'freeze and execute are separate operations')
    await click('执行已冻结 Python')
    assert.equal(calls.find(item => item.action === 'executePython')!.input.codeRevisionId, saved.codeRevisionId)
    assert.match(container.textContent!, /saved PNG/)
    await click('读取运行')
    await change('输出文件', `runs/${latestRun!.runId}/outputs/stats.csv`)
    assert.equal(button('发布为新图件文档').disabled, true, 'analysis CSV cannot be published as figure')
    await change('输出文件', `runs/${latestRun!.runId}/outputs/figure.png`)
    await toggle('发布为现有文档的候选图')
    assert.equal(button('发布为候选图').disabled, true)
    await change('目标文档', 'doc-a')
    assert.equal(button('发布为候选图').disabled, true, 'selecting a document is not selecting its baseline')
    await click('读取并选定当前基线')
    await click('发布为候选图')
    const published = calls.find(item => item.action === 'publishRun')!.input
    assert.equal(published.documentId, 'doc-a')
    assert.equal(published.expectedDocumentRevision, 7)
    assert.equal(published.baselineRevisionId, 'image-a')
    assert.equal(published.baselineHash, image.sha256)
    assert.equal(published.runId, latestRun!.runId)
    assert.match(String(published.outputPath), /outputs\/figure\.png$/)
    assert.match(container.textContent!, /candidate.png/, 'publication refresh loads the new candidate')
    await toggle('发布为现有文档的候选图')
    await click('发布为新图件文档')
    const newPublication = calls.filter(item => item.action === 'publishRun').at(-1)!.input
    assert.notEqual(newPublication.documentId, 'doc-a')
    assert.equal(newPublication.expectedDocumentRevision, 0)
    assert.equal(newPublication.baselineRevisionId, undefined)
    assert.equal(calls.some(item => item.action === 'acceptCandidate'), false, 'publishing never bypasses formal acceptance')
    await toggle('重新读取工作区数据（默认继承父版本冻结输入）')
    assert.equal((field('工作区输入路径 JSON') as unknown as HTMLTextAreaElement).disabled, false)
    assert.equal(button('执行已冻结 Python').disabled, true, 'refreshing inputs requires a new frozen revision')
    await change('工作区输入路径 JSON', '["new-data.csv"]')
    await click('保存并冻结代码')
    const refreshed = calls.filter(item => item.action === 'saveCode').at(-1)!.input
    assert.equal(refreshed.parentCodeRevisionId, saved.codeRevisionId)
    assert.deepEqual(refreshed.inputPaths, ['new-data.csv'])
    assert.equal(button('执行已冻结 Python').disabled, false)
    assert.equal(container.querySelectorAll('[role="alert"]').length, 0)
    failHistory = true
    await click('刷新列表')
    assert.match(container.textContent!, /History unavailable/)
    assert.equal(button('完成中断记录 interrupted').disabled, false, 'pending recovery remains usable when terminal history fails')
  } finally {
    await act(async () => { root.unmount() })
    await window.happyDOM.close()
    for (const key of globals) { const descriptor = previous.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key) }
  }
})
