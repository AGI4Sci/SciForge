// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchComposer } from './WorkbenchComposer'
import { createWorkbenchComposerInput } from './workbench-composer-input'
import { useChatStore } from '../../store/chat-store'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// happy-dom under the locked toolchain provides a partial localStorage without
// clear(); install a spec-shaped stub so storage-touching cases exercise their
// intended path.
let needsLocalStorageStub = false
try {
  needsLocalStorageStub = typeof globalThis.localStorage?.clear !== 'function'
} catch {
  needsLocalStorageStub = true
}
if (needsLocalStorageStub) {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return store.size },
      clear: () => { store.clear() },
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      key: (index: number) => [...store.keys()][index] ?? null,
      removeItem: (key: string) => { store.delete(key) },
      setItem: (key: string, value: string) => { store.set(key, String(value)) }
    }
  })
}

let root: Root | undefined
let container: HTMLDivElement

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  localStorage.clear()
  useChatStore.setState({ blocks: [], activeThreadId: null })
})

it('keeps real composer keystrokes local with a long history and sends the latest draft', async () => {
  const composerInput = createWorkbenchComposerInput()
  const shellRender = vi.fn()
  const historyRender = vi.fn()
  const previewRender = vi.fn()
  const send = vi.fn()
  useChatStore.setState({
    route: 'chat', workspaceRoot: '/workspace', activeThreadId: null,
    blocks: Array.from({ length: 4000 }, (_, index) => ({
      id: `message-${index}`, kind: 'user' as const, text: `History ${index}`
    }))
  })
  function History() { historyRender(); return <div>Long history</div> }
  function Preview() { previewRender(); return <div>Document preview</div> }
  function Workbench() {
    shellRender()
    const [state] = useState(() => composerInput)
    return <>
      <History /><Preview />
      <WorkbenchComposer
        composerInput={state} mode="agent" setMode={() => undefined}
        busy={false} runtimeReady hasActiveThread={false}
        composerModel="" composerPickList={[]} onComposerModelChange={() => undefined}
        queuedMessages={[]} onRemoveQueuedMessage={() => undefined}
        changeSummaryWorkspaceRoot="/workspace"
        onSend={() => { send(state.getState().input); state.getState().setInput('') }}
        onInterrupt={() => undefined}
      />
    </>
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<Workbench />))
  const textarea = container.querySelector('textarea')!
  expect(textarea).not.toBeNull()
  const rendersBeforeTyping = shellRender.mock.calls.length
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  let input = ''
  for (const character of '中文输入 testing latest draft') {
    input += character
    await act(async () => {
      setValue.call(textarea, input)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  expect(composerInput.getState().input).toBe(input)
  expect(textarea.value).toBe(input)
  expect(shellRender).toHaveBeenCalledTimes(rendersBeforeTyping)
  expect(historyRender).toHaveBeenCalledTimes(1)
  expect(previewRender).toHaveBeenCalledTimes(1)

  // Programmatic suggestions/history restoration use the same state, and send
  // must not close over the value from the workbench's previous render.
  await act(async () => composerInput.getState().setInput('最新的引导消息'))
  expect(textarea.value).toBe('最新的引导消息')
  await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(send).toHaveBeenCalledWith('最新的引导消息')
  expect(textarea.value).toBe('')
  expect(shellRender).toHaveBeenCalledTimes(rendersBeforeTyping)
})


it('scopes Up/Down input recall to the selected session and restores its own draft', async () => {
  const composerInput = createWorkbenchComposerInput()
  useChatStore.setState({ route: 'chat', workspaceRoot: '/same', activeThreadId: 'session-a', blocks: [] })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<WorkbenchComposer
    composerInput={composerInput} mode="agent" setMode={() => undefined}
    busy={false} runtimeReady hasActiveThread
    composerModel="" composerPickList={[]} onComposerModelChange={() => undefined}
    queuedMessages={[]} onRemoveQueuedMessage={() => undefined}
    changeSummaryWorkspaceRoot="/same"
    onSend={() => composerInput.getState().setInput('')}
    onInterrupt={() => undefined}
  />))
  const textarea = container.querySelector('textarea')!
  const key = async (value: string) => {
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })))
  }
  const send = async (value: string) => {
    await act(async () => composerInput.getState().setInput(value))
    await key('Enter')
  }
  await send('A first')
  await send('A second')
  await act(async () => useChatStore.setState({ activeThreadId: 'session-b', blocks: [] }))
  await key('ArrowUp')
  expect(textarea.value).toBe('')
  await send('B only')
  await act(async () => composerInput.getState().setInput('B draft'))
  textarea.setSelectionRange(0, 0)
  await key('ArrowUp')
  expect(textarea.value).toBe('B only')
  textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  await key('ArrowDown')
  expect(textarea.value).toBe('B draft')
  await act(async () => useChatStore.setState({ activeThreadId: 'session-a', blocks: [] }))
  await key('ArrowUp')
  expect(textarea.value).toBe('A second')
  await key('ArrowUp')
  expect(textarea.value).toBe('A first')
  await act(async () => useChatStore.setState({ activeThreadId: 'session-b', blocks: [] }))
  expect(textarea.value).toBe('B draft')
  textarea.setSelectionRange(0, 0)
  await key('ArrowUp')
  expect(textarea.value).toBe('B only')
})

it('explicit Session navigation focuses the standard composer even when returning to the same thread', async () => {
  const composerInput = createWorkbenchComposerInput()
  useChatStore.setState({ route: 'chat', activeThreadId: 'task-thread', blocks: [] })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const render = (focusRequestId: number) => root!.render(<WorkbenchComposer
    composerInput={composerInput} changeSummaryWorkspaceRoot="/workspace" focusRequestId={focusRequestId}
    mode="agent" setMode={() => undefined} busy runtimeReady hasActiveThread
    composerModel="" composerPickList={[]} onComposerModelChange={() => undefined}
    queuedMessages={[]} onRemoveQueuedMessage={() => undefined}
    onSend={() => undefined} onInterrupt={() => undefined}
    onPickAttachments={() => undefined} attachmentUploadEnabled
  />)
  await act(async () => { render(0) })
  const externalInput = document.createElement('input')
  container.append(externalInput)
  externalInput.focus()
  expect(document.activeElement).toBe(externalInput)
  await act(async () => { render(1) })
  expect(document.activeElement).toBe(container.querySelector('textarea'))
})

it('offers a historical failed-input reexecution while the runnable queue is empty and still sends new requirements', async () => {
  const composerInput = createWorkbenchComposerInput()
  useChatStore.setState({ route: 'chat', activeThreadId: 'task-thread', blocks: [] })
  const reexecute = vi.fn()
  const send = vi.fn()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<WorkbenchComposer
    composerInput={composerInput} changeSummaryWorkspaceRoot="/workspace" mode="agent" setMode={() => undefined}
    busy={false} runtimeReady hasActiveThread composerModel="" composerPickList={[]}
    onComposerModelChange={() => undefined} queuedMessages={[]} onRemoveQueuedMessage={() => undefined}
    sessionFailure={{ receipt: { clientDirectiveId: 'historical-failure', revision: 4, payloadDigest: 'a'.repeat(64),
      mode: 'direct', delivery: 'delivered', execution: 'failed', turnId: 'failed-turn' } }}
    onReexecuteQueuedMessage={reexecute}
    onSend={() => send(composerInput.getState().input)} onInterrupt={() => undefined}
  />))
  const button = container.querySelector<HTMLButtonElement>('[data-testid="session-input-reexecute"]')
  expect(button).not.toBeNull()
  await act(async () => button!.click())
  expect(reexecute).toHaveBeenCalledWith('historical-failure')
  const textarea = container.querySelector('textarea')!
  expect(textarea.disabled).toBe(false)
  await act(async () => composerInput.getState().setInput('请直接按新要求继续'))
  await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(send).toHaveBeenCalledWith('请直接按新要求继续')
})
