import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Window } from 'happy-dom'

test('built panel includes its Host workspace when refreshing through the capability protocol', async () => {
  const window = new Window()
  const messages: Array<{ type: string; input?: unknown }> = []
  window.document.body.innerHTML = '<div id="root"></div>'
  window.parent.postMessage = ((message: { type: string; input?: unknown }) => { messages.push(message) }) as typeof window.postMessage
  try {
    window.eval(await readFile(new URL('../dist/ui/main.js', import.meta.url), 'utf8'))
    window.eval(`window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: ${JSON.stringify({
      type: 'host.init', workspaceRoot: '/workspace/panel', sessionId: 'session', runtimeId: 'codex',
      capabilityIds: ['anchored-comments.list', 'anchored-comments.upsert']
    })} }))`)
    const refresh = [...window.document.querySelectorAll('button')].find(button => button.textContent === '刷新已有批注')!
    assert.equal(refresh.disabled, false)
    refresh.click()
    assert.deepEqual(JSON.parse(JSON.stringify(messages.find(message => message.type === 'capability.invoke')?.input)),
      { purpose: 'research', includeResolved: true, workspaceRoot: '/workspace/panel' })
  } finally {
    window.eval("window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { type: 'dispose' } }))")
    await window.happyDOM.close()
  }
})
