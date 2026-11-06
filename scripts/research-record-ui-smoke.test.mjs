import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright-core'
import { ResearchRecordStore } from '../packages/domains/evidence-dag/src/main/research-record-store.ts'
import { recordHash } from '../packages/domains/evidence-dag/src/main/research-record-state.ts'
import { researchSourceDigest } from '../packages/domains/evidence-dag/src/main/research-record-ingestion.ts'
import { ResearchRecordRuntime } from '../packages/domains/evidence-dag/src/main/research-record.ts'
import { createEvidenceDagCapabilityFactory } from '@sciforge/domain-evidence-dag/main'
import { CapabilityBroker } from '../src/main/capabilities/broker.ts'
import { CapabilityRegistry, defineCapability } from '../src/main/capabilities/registry.ts'
import { createAnchoredCommentsOperations } from '../plugins/anchored-comments/src/core/operations.ts'
import { randomUUID } from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2])
await mkdir(out, { recursive: false })
const userDataDir = path.join(out, 'profile'), workspaceRoot = path.join(out, 'workspace')
await mkdir(userDataDir); await mkdir(workspaceRoot)
const scope = { runtimeId: 'codex', threadId: 'native-record-main', workspaceRoot }
const runtime = new ResearchRecordRuntime({ userDataDir, pollMs: 100 })
const annotations = createAnchoredCommentsOperations({ env: {} })
const annotationCalls = []
const modelTurns = []
const failModel = process.argv.includes('--model-failure')
let modelCalls = 0
const agentExecution = { run: async (input) => {
  modelCalls++
  assert.equal(input.runtimeId, 'codex')
  assert.equal(input.interaction, 'background')
  assert.deepEqual(input.allowedTools, [])
  if (failModel) throw new Error('合成旁路整理失败；原始来源保留。')
  const data = JSON.parse(input.prompt.split('<research-record-data>\n')[1].split('\n</research-record-data>')[0])
  const phase = input.metadata?.purpose === 'phase-synthesis'
  const sourceIds = phase
    ? [...new Set(data.changedRounds.flatMap(round => round.entries.flatMap(entry => entry.sourceIds)))]
    : data.evidence.filter(item => !/"id"\s*:\s*"context-tail"/.test(item.raw.excerpt)).map(item => item.id)
  const statePatch = sourceIds.length ? [
    { op: 'add', kind: 'goal', text: phase ? '阶段目标是核对独立基线并保留反例。' : '核对本轮独立基线。', sourceIds },
    { op: 'add', kind: 'negative', text: '本次运行失败；未证明跨队列优势。', sourceIds },
    { op: 'add', kind: 'open', text: '仍需独立样本复核。', sourceIds },
    ...(!phase ? [
      { op: 'add', kind: 'open', text: '仍需检查重复运行。', sourceIds },
      { op: 'add', kind: 'negative', text: '当前缺少迁移条件的支持。', sourceIds }
    ] : [])
  ] : []
  const output = JSON.stringify(phase ? { statePatch } : { phasePath: ['机制验证', '匹配对照'], title: '复核独立基线', statePatch,
    steps: sourceIds.length ? [{ title: '独立基线核对', summary: '保留失败来源', sourceIds }] : [] })
  const turnId = `side-turn-${modelTurns.length}`
  modelTurns.push({ id: turnId, status: 'completed', artifacts: [], messages: [
    { itemId: `${turnId}-user`, kind: 'user-message', text: input.prompt }, { itemId: `${turnId}-final`, kind: 'assistant-final', text: output }
  ] })
  return { runtimeId: 'codex', threadId: 'side-thread', turnId, state: 'completed', text: output }
} }
const artifacts = [
  { id: 'user', kind: 'user_message', text: '核对独立基线，保留失败和反例。', createdAt: '2025-12-20T12:00:00.000Z' },
  { id: 'bash', kind: 'tool', toolKind: 'command_execution', status: 'failed', summary: '运行匹配基线', detail: 'python matched_baseline.py\nexit=1', meta: { skillName: 'baseline-review', command: 'python matched_baseline.py', shell: '/bin/bash', cwd: '/synthetic/science', exitCode: 1 }, createdAt: '2026-01-10T12:00:00.000Z' },
  { id: 'context-tail', kind: 'user_message', text: '附加上下文仍待归类。'.repeat(600), createdAt: '2026-01-10T12:00:01.000Z' }
]
runtime.start({
  userDataDir, signal: new AbortController().signal,
  agentThreads: { list: async () => [{ ...scope, id: scope.threadId }], read: async input => input.threadId === 'side-thread'
    ? { ...scope, id: 'side-thread', watermark: String(modelTurns.length), artifacts: [], turns: modelTurns }
    : ({ ...scope, id: scope.threadId, watermark: '1', artifacts, turns: [{ id: 'turn-native', status: 'failed', messages: [], artifacts }] }) },
  agentExecution,
 log: () => undefined
}, true)
await runtime.scan()
const definitions = createEvidenceDagCapabilityFactory({ defineCapability, getRuntime: () => ({ records: runtime }) }).createDefinitions()
const broker = new CapabilityBroker(new CapabilityRegistry(definitions))
// Long history is loaded through the canonical durable Store and Runtime, never
// a renderer JSON replacement. The owner remains paused; browsing cannot run a model.
const pagingScope = { ...scope, threadId: 'pagination-main' }
const secondScope = { ...scope, threadId: 'pagination-second', workspaceRoot: path.join(out, 'second-workspace') }
await mkdir(secondScope.workspaceRoot)
const pagingRaw = Array.from({ length: 125 }, (_, i) => ({ id: `paging-source-${i}`, kind: 'tool', status: i === 0 ? 'failed' : 'completed', toolKind: 'command_execution', meta: { command: `echo exact-source-${i}`, exitCode: i === 0 ? 1 : 0 }, detail: `original-source-${i}` }))
const pagingState = { version: 2, workspaceRoot, revision: 7, paused: true, model: '', nodes: {}, messages: {}, receipts: {}, handoffs: {}, jobs: {}, phaseJobs: {}, history: [], failures: [], lastScanAt: null }
const makeNode = (id, parentId, kind, title = id) => ({ id, parentId, kind, title, summary: '', status: 'completed', origin: 'system', createdAt: '2026-01-01', updatedAt: '2026-01-01' })
pagingState.nodes.paging = makeNode('paging', 'root', 'phase', '分页研究范围')
for (let i = 0; i < 125; i++) {
  const round = `paging-round-${i}`, event = `paging-event-${i}`
  pagingState.nodes[round] = makeNode(round, 'paging', 'round')
  pagingState.nodes[event] = { ...makeNode(event, round, 'event', `远端来源 ${i}`), status: pagingRaw[i].status,
    source: { ...pagingScope, turnId: 'paging-turn', itemId: pagingRaw[i].id, digest: researchSourceDigest(pagingRaw[i]) } }
  pagingState.history.push({ at: '2026-01-01', nodeId: round, kind: 'source-test', value: { after: { title: round, summary: `历史变化 ${i}` }, sourceIds: [event] } })
  pagingState.jobs[round] = { fingerprint: '', sourceIds: [event], processedIds: [event], assignedIds: [event], fullExcerptIds: [event], truncatedIds: [], unavailableIds: [], changedIds: [], semanticPendingIds: [], attempts: 0, nextAt: 0 }
}
pagingState.nodes.paging.synthesis = { revision: 3, updatedAt: '2026-01-01', summaryLimited: false,
  entries: Array.from({ length: 125 }, (_, i) => ({ id: `paging-entry-${i}`, kind: i === 0 ? 'negative' : i === 1 ? 'open' : 'progress', text: i === 0 ? '最早负例仍须保留' : i === 1 ? '最早未决尚未解决' : `综合条目 ${i}`, sourceIds: [`paging-event-${i}`], status: 'active' })),
  coveredChildRevisions: Object.fromEntries(Array.from({ length: 125 }, (_, i) => [`paging-round-${i}`, i])),
  coveredChildMembership: Object.fromEntries(Array.from({ length: 125 }, (_, i) => [`paging-round-${i}`, `membership-${i}`])) }
pagingState.messages.paging = Array.from({ length: 45 }, (_, i) => ({ id: `paging-message-${i}`, role: 'user', text: `历史讨论原文 ${i}`, sourceIds: ['paging-event-0'], createdAt: '2026-01-01', status: 'complete', requestId: `message-${i}`, scopeDigest: 'synthetic', limited: false }))
const pagingUserData = path.join(out, 'paging-profile')
await mkdir(pagingUserData)
new ResearchRecordStore(path.join(pagingUserData, 'evidence-dag', `research-record-${recordHash(workspaceRoot)}.json`), workspaceRoot).commit(pagingState)
new ResearchRecordStore(path.join(pagingUserData, 'evidence-dag', `research-record-${recordHash(secondScope.workspaceRoot)}.json`), secondScope.workspaceRoot).commit({ ...pagingState, workspaceRoot: secondScope.workspaceRoot, nodes: { second: makeNode('second', 'root', 'phase', '第二工作区独有记录') }, messages: {}, jobs: {}, history: [] })
const pagingRuntime = new ResearchRecordRuntime({ userDataDir: pagingUserData, pollMs: 60000 })
pagingRuntime.start({ log: () => undefined, agentThreads: { list: async () => [], readMetadata: async input => ({ ...input, id: input.threadId, workspaceRoot: input.threadId === secondScope.threadId ? secondScope.workspaceRoot : workspaceRoot }), read: async () => ({ ...pagingScope, id: pagingScope.threadId, artifacts: pagingRaw, turns: [{ id: 'paging-turn', artifacts: pagingRaw, messages: [] }] }) } }, true)
const pagingBroker = new CapabilityBroker(new CapabilityRegistry(createEvidenceDagCapabilityFactory({ defineCapability, getRuntime: () => ({ records: pagingRuntime }) }).createDefinitions()))
let pagingDenied = false, holdPaging = false, releasePaging
const pagingInputs = []
const sourceFixtures = {
  failed: { kind: 'tool', toolKind: 'command_execution', status: 'failed', summary: '执行说明不可冒充命令', meta: { command: 'Write-Output "你好"\r\nGet-Content .\\missing.txt\r\n', shell: 'pwsh', cwd: 'F:\\science', exitCode: 7 }, detail: '\u001b[31mERROR missing file\u001b[0m\n' + 'bounded-output '.repeat(3500) + 'TAIL_SENTINEL', truncated: true },
  running: { status: 'running', command: 'python experiment.py --stage 2', detail: 'Running synthetic fixture' },
  completed: { status: 'completed', command: 'python experiment.py --stage 1', meta: { exitCode: 0 }, detail: 'Synthetic fixture completed; not scientific verification' },
  cancelled: { status: 'cancelled', arguments: JSON.stringify({ cmd: 'printf "start\\n"\nsleep 90\n', shell: '/bin/bash', workdir: '/science' }), stderr: 'cancelled by user' },
  unknown: { status: 'completed', summary: 'echo THIS_IS_A_SUMMARY', arguments: '{broken', detail: 'No command bytes recorded' }
}
const sourcePage = `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ResearchRecordSource} from '/packages/domains/evidence-dag/src/renderer/ResearchRecordSource.tsx';
import {createResearchRecordPresentation} from '/packages/domains/evidence-dag/src/renderer/research-record-presentation.ts';
import {researchRecordReadingStyles} from '/packages/domains/evidence-dag/src/renderer/research-record-reading.ts';
import '/src/renderer/src/index.css';
document.documentElement.dataset.theme = 'light';
const fixtures = ${JSON.stringify(sourceFixtures)};
const presentation = createResearchRecordPresentation();
window.sourceOpens = []; window.sourceFixtureBytes = JSON.stringify(fixtures);
function Fixture() {
 const [name,setName] = useState('failed'), [availability,setAvailability] = useState('current'), [mounted,setMounted] = useState(true);
 const view = {node:{id:name,status:fixtures[name].status,source:{runtimeId:'codex',threadId:'fixture',turnId:'turn-source',itemId:name,digest:'a'.repeat(64),workspaceRoot:'/synthetic'}},raw:availability==='unavailable'?undefined:fixtures[name],sourceStatus:availability};
 return React.createElement('main',{className:'sf-research-reading mx-auto min-w-0 max-w-lg p-3 text-ds-ink bg-ds-main'},
 React.createElement('style',null,researchRecordReadingStyles),
 React.createElement('nav',{className:'flex flex-wrap gap-2'},...Object.keys(fixtures).map(value=>React.createElement('button',{key:value,onClick:()=>setName(value)},value)),...['current','changed','unavailable'].map(value=>React.createElement('button',{key:value,onClick:()=>setAvailability(value)},value)),React.createElement('button',{onClick:()=>setMounted(!mounted)},'remount')),
 mounted && React.createElement(ResearchRecordSource,{view,busy:false,presentation,onOpen:value=>window.sourceOpens.push(value.node.source)}));
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
</script></body></html>`
const server = await createServer({ root, cacheDir: path.join(out, 'vite-cache'), configFile: false, plugins: [react(), {
  name: 'native-record-test-transport', configureServer(server) {
    server.middlewares.use('/__source-review', async (_request, response) => { response.setHeader('content-type', 'text/html'); response.end(await server.transformIndexHtml('/__source-review', sourcePage)) })
    server.middlewares.use('/__annotation-ui', async (request, response) => {
      const name = request.url?.split('?')[0]?.slice(1)
      if (!['index.html', 'main.js', 'main.css'].includes(name)) { response.statusCode = 404; response.end(); return }
      response.setHeader('access-control-allow-origin', '*')
      response.setHeader('content-type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html')
      response.end(await readFile(path.join(root, 'plugins/anchored-comments/dist/ui', name)))
    })
    server.middlewares.use('/__annotation', async (request, response) => {
      response.setHeader('content-type', 'application/json')
      try {
        let body = ''; for await (const chunk of request) body += chunk
        const { action, input } = JSON.parse(body)
        assert.ok(['anchored-comments.list', 'anchored-comments.upsert'].includes(action))
        annotationCalls.push(action)
        response.end(JSON.stringify(await annotations.invoke(action, input, workspaceRoot)))
      } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ message: error.message })) }
    })
    server.middlewares.use('/__record', async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/scope') { response.end(JSON.stringify(scope)); return }
      if (request.url === '/pagination-scope') { response.end(JSON.stringify({ scope: pagingScope, secondScope })); return }
      try {
        let body = ''; for await (const chunk of request) body += chunk
        const { action, input } = JSON.parse(body)
        const paging = [pagingScope.threadId, secondScope.threadId].includes(input.threadId)
        if (paging) {
          pagingInputs.push({ action, input })
          if (pagingDenied) throw new Error('合成权限拒绝：当前工作区不可读。')
          if (holdPaging && input.threadId === pagingScope.threadId) { holdPaging = false; await new Promise(resolve => { releasePaging = resolve }) }
        }
        const result = await (paging ? pagingBroker : broker).invoke({ audience: 'ui', callerId: 'record-ui-smoke', workspaceId: paging ? input.workspaceRoot : workspaceRoot }, {
          actionId: action, invocationId: randomUUID(), input
        })
        response.end(JSON.stringify(result.output))
      } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: error.message })) }
    })
  }
}], optimizeDeps: { entries: ['scripts/e2e/research-record.html'] }, server: { host: '127.0.0.1', port: 0, watch: null, hmr: false }, logLevel: 'warn' })
await server.listen()
const browser = await chromium.launch({ executablePath: process.argv.find(value => value.startsWith('--chromium='))?.slice('--chromium='.length), headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [] })
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } })
page.setDefaultTimeout(20000)
const errors = [], checks = []
page.on('pageerror', error => errors.push(error.message))
try {
  if (!process.argv.includes('--source-only') && !process.argv.includes('--pagination-only')) {
    await page.goto(`${server.resolvedUrls.local[0]}scripts/e2e/research-record.html`, { waitUntil: 'networkidle', timeout: 90000 })
    const views = page.getByRole('navigation', { name: '研究视图' })
    await views.getByRole('button', { name: '精简列表', exact: true }).waitFor()
    assert.equal(await views.getByRole('button', { name: '精简列表' }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('region', { name: '紧凑审计列表' }).waitFor()
    assert.match(await page.getByRole('region', { name: '紧凑审计列表' }).innerText(), /非耗时/)
    assert.equal(await page.locator('[data-record-kind="event"]').count(), 0)
    assert.equal(await page.locator('[data-record-id] [data-record-id]').count(), 0, 'record children are never nested in mounted children')
    await page.screenshot({ path: path.join(out, 'compact-overview.png') })
    checks.push('default compact overview shows bounded single rows and page positions without recursive descendant DOM')
    const beforeRead = modelCalls, facts = JSON.stringify(artifacts)
    await views.getByRole('button', { name: '审查变化', exact: true }).click()
    await page.getByText(/浏览基线 #/).waitFor()
    assert.match(await page.getByRole('region', { name: '研究回看' }).innerText(), /不构成正式审阅/)
    assert.equal(await page.locator('[data-record-id]').count(), 0)
    await page.getByRole('button', { name: '待关注', exact: true }).click()
    if (!failModel) {
      await page.getByText('本次运行失败；未证明跨队列优势。', { exact: true }).first().waitFor()
      await page.getByRole('button', { name: /查看依据/ }).first().click()
      await page.getByRole('region', { name: '记录详情' }).waitFor()
      await page.getByRole('button', { name: '关闭记录详情' }).click()
    }
    checks.push('changes use the canonical review baseline and attention/source navigation; reading is not formal approval')
    await views.getByRole('button', { name: '精简列表', exact: true }).click()
    await page.getByRole('button', { name: '定位当前轮次', exact: true }).click()
    await page.getByRole('navigation', { name: '研究阶段路径' }).getByText(failModel ? /^研究轮次/ : '复核独立基线', { exact: !failModel }).waitFor()
    assert.equal(await views.getByRole('button', { name: '局部过程' }).getAttribute('aria-pressed'), 'true')
    // Traverse direct members one scope at a time, with stable ancestry and no recursion.
    for (let depth = 0; depth < 5 && !await page.getByRole('button', { name: /^原始行为/ }).count(); depth++) {
      await page.locator('[data-record-id]').first().getByRole('button', { name: /^进入 / }).click()
    }
    await page.getByRole('button', { name: /^原始行为/ }).click()
    await page.locator('[data-record-kind="event"]').first().waitFor()
    await page.locator('[data-record-kind="event"]').first().getByRole('button', { name: /^查看 / }).click()
    await page.getByRole('button', { name: '原始依据', exact: true }).click()
    await page.getByText('来源一致', { exact: true }).waitFor()
    await page.getByRole('button', { name: '聚焦此依据' }).click()
    await page.getByRole('region', { name: '原始依据', exact: true }).waitFor()
    await page.getByRole('button', { name: '返回之前范围' }).click()
    await page.locator('[data-record-kind="event"]').first().waitFor()
    assert.equal(await page.locator('[data-record-id] [data-record-id]').count(), 0)
    assert.equal(JSON.stringify(artifacts), facts)
    assert.equal(modelCalls, beforeRead)
    checks.push('current round, direct-member drill-down, raw disclosure, exact source focus and return preserve failures and original facts without model work')
    await page.getByRole('navigation', { name: '研究阶段路径' }).getByRole('button', { name: '整个课题', exact: true }).click()
    await views.getByRole('button', { name: '精简列表', exact: true }).click()
    await views.getByRole('button', { name: '局部过程', exact: true }).click()
    const chapter = page.locator('[data-record-id]').first()
    await chapter.waitFor()
    const title = await chapter.getAttribute('data-record-id')
    const toggle = chapter.locator('button[aria-expanded]').first()
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
    await page.getByRole('button', { name: '收起本层', exact: true }).click()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    await page.getByRole('button', { name: '恢复本层展开' }).click()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
    const sourceLabel = chapter.locator('button[aria-label^="展开内容"] span.select-text').first()
    await sourceLabel.evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element)
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await page.getByRole('region', { name: '研究选区操作' }).waitFor()
    await page.getByRole('button', { name: '讨论选区' }).click()
    await page.getByRole('complementary', { name: '公开侧聊接收器' }).waitFor()
    const request = (await page.evaluate(() => window.recordSideRequests)).at(-1)
    assert.equal(request.parentThreadId, scope.threadId)
    assert.match(request.context.text, /resource-text-selection/)
    assert.equal(request.question, undefined)
    await page.getByRole('button', { name: '编辑文档带回主会话' }).click()
    await page.getByRole('textbox', { name: 'sideChatHandoffDocument', exact: true }).fill('用户修订：失败与未决不能视为科学验证。')
    await page.getByRole('button', { name: 'sideChatHandoffSend', exact: true }).click()
    await page.waitForFunction(() => window.recordHandoffs.length === 1)
    assert.equal((await page.evaluate(() => window.recordHandoffs))[0].overrides.targetThreadId, scope.threadId)
    await page.getByRole('button', { name: '关闭接收器' }).click()
    checks.push('reversible group collapse retains stable member IDs; exact selection uses public side conversation and edited handoff')
  const beforeAnnotations = modelCalls
  await page.getByRole('button', { name: '添加批注', exact: true }).click()
  const owner = page.frameLocator('iframe[title="锚定批注插件"]')
  await owner.getByRole('status').filter({ hasText: '选区已带入' }).waitFor()
  const copiedSelection = await owner.getByLabel('选区定位 JSON', { exact: true }).inputValue()
  assert.equal(JSON.parse(copiedSelection).scope.threadId, scope.threadId)
  assert.equal(annotationCalls.length, 0, 'opening a selection must not save or read automatically')
  await owner.getByLabel('批注内容', { exact: true }).fill('仍需复核；此批注不代表批准。')
  await owner.getByRole('button', { name: '保存批注', exact: true }).click()
  await owner.getByRole('status').filter({ hasText: '批注已保存' }).waitFor()
  const saved = await annotations.invoke('anchored-comments.list', { includeResolved: true }, workspaceRoot)
  assert.equal(saved.threads.length, 1)
  assert.equal(saved.threads[0].anchor.canonical.selection.quote, JSON.parse(copiedSelection).quote)
  assert.equal(saved.threads[0].anchorResolution, 'needs_retargeting')
  await page.screenshot({ path: path.join(out, 'selection-annotation-owner.png') })
  await page.getByRole('button', { name: '切换批注插件', exact: true }).click()
  await page.getByRole('button', { name: '切换批注插件', exact: true }).click()
  await owner.getByRole('button', { name: '刷新已有批注', exact: true }).click()
  await owner.getByRole('region', { name: '已有批注' }).getByText('仍需复核；此批注不代表批准。', { exact: true }).waitFor()
  const initialSelection = JSON.parse(copiedSelection)
  const openSelection = value => page.evaluate(value => window.recordOpenResource({ sessionId: value.scope.threadId === 'wrong-session' ? 'native-record-main' : value.scope.threadId,
    resource: { resourceKind: 'resource-text-selection', resourceId: value.resourceId, context: value } }), value)
  const newer = { ...initialSelection, resourceId: 'next-selection', label: '新的选区', quote: '新的精确文字' }
  await owner.getByLabel('批注内容', { exact: true }).fill('未保存正文必须保留')
  await openSelection(newer)
  await owner.getByRole('button', { name: '保留当前草稿', exact: true }).click()
  assert.equal(await owner.getByLabel('批注内容', { exact: true }).inputValue(), '未保存正文必须保留')
  assert.equal(JSON.parse(await owner.getByLabel('选区定位 JSON', { exact: true }).inputValue()).resourceId, initialSelection.resourceId)
  await openSelection(newer)
  await owner.getByRole('button', { name: '放弃旧正文并替换选区', exact: true }).click()
  assert.equal(await owner.getByLabel('批注内容', { exact: true }).inputValue(), '')
  assert.equal(JSON.parse(await owner.getByLabel('选区定位 JSON', { exact: true }).inputValue()).quote, newer.quote)
  const writesBeforeInvalid = annotationCalls.filter(value => value === 'anchored-comments.upsert').length
  for (const patch of [{ threadId: 'wrong-session' }, { workspaceRoot: '/wrong-workspace' }, { runtimeId: 'wrong-runtime' }]) {
    await openSelection({ ...initialSelection, scope: { ...initialSelection.scope, ...patch } })
    await owner.getByRole('status').filter({ hasText: '选区上下文无效' }).waitFor()
    assert.equal(await owner.getByRole('button', { name: '保存批注', exact: true }).isDisabled(), true)
  }
  await openSelection({ ...initialSelection, approval: true })
  await owner.getByRole('status').filter({ hasText: '选区上下文无效' }).waitFor()
  await openSelection(initialSelection)
  await owner.getByRole('status').filter({ hasText: '选区已带入' }).waitFor()
  await owner.getByLabel('批注内容', { exact: true }).fill('停用必须清空此草稿')
  await page.evaluate(() => document.querySelector('iframe[title="锚定批注插件"]').contentWindow.postMessage({ type: 'dispose' }, '*'))
  await owner.getByRole('status').filter({ hasText: '插件已停用' }).waitFor()
  assert.equal(await owner.getByLabel('批注内容', { exact: true }).inputValue(), '')
  assert.equal(await owner.getByRole('button', { name: '保存批注', exact: true }).isDisabled(), true)
  await openSelection(initialSelection)
  await owner.getByRole('status').filter({ hasText: '选区已带入' }).waitFor()
  assert.equal(annotationCalls.filter(value => value === 'anchored-comments.upsert').length, writesBeforeInvalid)
  checks.push('same iframe selection updates protect unsaved text with explicit keep/replace; wrong workspace/runtime/session and malformed context fail closed; dispose clears draft without writes')
  await page.setViewportSize({ width: 320, height: 760 })
  assert.equal(await owner.locator('body').evaluate(element => element.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: path.join(out, 'annotation-owner-narrow.png') })
  await page.getByRole('button', { name: '切换批注插件', exact: true }).click()
  await page.evaluate(() => window.recordDropResourceRoute())
  await page.getByRole('button', { name: '添加批注', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '没有已安装且获准的批注入口' }).waitFor()
  await page.getByRole('button', { name: '取消选区', exact: true }).click()
  await page.setViewportSize({ width: 1000, height: 1000 })
  assert.equal(modelCalls, beforeAnnotations)
  checks.push('one click public openResource + production schema/registry + built plugin iframe prefills exact quote without clipboard; original upsert returns thread; remount list preserves unresolved source; synthetic Host provides runtime identity absent in current production Host')

    await page.getByRole('button', { name: '暂停面板读取' }).click()
    await page.waitForTimeout(500)
    const inactiveCalls = await page.evaluate(() => window.recordCalls.length)
    await page.waitForTimeout(4000)
    assert.equal(await page.evaluate(() => window.recordCalls.length), inactiveCalls)
    await page.getByRole('button', { name: '恢复面板读取' }).click()
    await page.waitForFunction(count => window.recordCalls.length > count, inactiveCalls)
    checks.push('inactive production surface pauses all record view/review reads and resumes on activation')
    await page.waitForTimeout(500)
    const reviewReads = await page.evaluate(() => window.recordCalls.filter(action => action === 'evidence-dag.record.review').length)
    await page.waitForTimeout(4000)
    assert.equal(await page.evaluate(() => window.recordCalls.filter(action => action === 'evidence-dag.record.review').length), reviewReads, 'same revision does not refetch dependent review data')
    checks.push('same revision polling does not refresh review projections')
    await page.getByRole('textbox', { name: '主会话草稿' }).fill('独立主会话草稿')
    await page.getByRole('button', { name: '全局打开', exact: true }).click()
    await page.getByRole('region', { name: '全局研究记录' }).waitFor()
    await page.getByRole('button', { name: '返回侧面', exact: true }).click()
    await page.locator(`[data-record-id="${title}"]`).waitFor()
    assert.equal(await page.getByRole('textbox', { name: '主会话草稿' }).inputValue(), '独立主会话草稿')
    while (await page.getByRole('button', { name: '放大研究文字' }).isEnabled()) await page.getByRole('button', { name: '放大研究文字' }).click()
    for (const width of [480, 320, 240]) {
      await page.setViewportSize({ width, height: 900 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: path.join(out, `compact-reading-${width}.png`) })
    }
    await page.setViewportSize({ width: 320, height: 453 })
    assert.ok(await page.getByLabel('阶段与推进过程', { exact: true }).evaluate(element => element.clientHeight) > 150, 'large reading chrome leaves usable content in a short viewport')
    await page.screenshot({ path: path.join(out, 'compact-short-320.png') })
    assert.equal(await page.getByRole('button', { name: '恢复默认研究字号' }).innerText(), '32')
    await page.getByRole('button', { name: '恢复默认研究字号' }).click()
    assert.equal(modelCalls, beforeAnnotations)
    checks.push('side/global remount keeps view, stable members and main draft; 32px reading reflows at 480/320/240 widths')
  }
  for (const count of (process.argv.includes('--pagination-only') ? [] : [1000, 10000, 100000])) {
    await page.goto(`${server.resolvedUrls.local[0]}scripts/e2e/research-record.html?scale=${count}`, { waitUntil: 'networkidle', timeout: 90000 })
    await page.locator('[data-scale-row]').first().waitFor()
    assert.equal(await page.locator('[data-scale-row]').count(), 20)
    await page.getByRole('navigation', { name: '合成成员显示窗口' }).getByRole('button', { name: '后一组' }).click()
    assert.equal(await page.locator('[data-scale-row]').count(), 20)
    assert.equal(await page.locator('[data-scale-row="original-0"]').count(), 0, 'previous rows are unmounted, not CSS hidden')
    await page.locator('[data-scale-row]').first().evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element)
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await page.getByRole('status').filter({ hasText: '保留活动选区' }).waitFor()
    assert.equal(await page.getByRole('navigation', { name: '合成成员显示窗口' }).getByRole('button', { name: '后一组' }).isDisabled(), true)
    await page.evaluate(() => { window.getSelection().removeAllRanges(); document.dispatchEvent(new Event('selectionchange')) })
    await page.getByRole('navigation', { name: '合成成员显示窗口' }).getByRole('button', { name: '前一组' }).click()
    assert.equal(await page.locator('[data-scale-row="original-0"]').count(), 1)
    await page.getByRole('button', { name: '阶段综合 大范围合成展示', exact: true }).click()
    assert.equal(await page.locator('[data-synthesis-entry]').count(), 12)
    await page.getByRole('navigation', { name: '综合条目显示窗口' }).getByRole('button', { name: '后一组' }).click()
    assert.equal(await page.locator('[data-synthesis-entry]').count(), 12)
    await page.locator('[data-synthesis-entry]').first().getByRole('button', { name: '来源 1', exact: true }).click()
    assert.equal(await page.evaluate(() => window.scaleSource), `original-${count - 13}`)
    await page.screenshot({ path: path.join(out, `scale-${count}.png`) })
    checks.push(`${count} synthetic members: 20 mounted rows, 12 mounted synthesis entries, previous DOM removed, active selection protected, original source IDs retained; renderer only`)
  }
  // Real owner/Broker server paging: >100 members, >48 summary/map rows, >20 messages.
  await page.goto(`${server.resolvedUrls.local[0]}scripts/e2e/research-record.html?pagination`, { waitUntil: 'networkidle', timeout: 90000 })
  await page.getByRole('button', { name: '进入 分页研究范围', exact: true }).click()
  await page.getByRole('navigation', { name: '研究阶段路径' }).getByText('分页研究范围', { exact: true }).waitFor()
  const membersPage = page.getByRole('navigation', { name: '范围成员服务端分页' })
  await membersPage.getByText(/1–100 \/ 125/).waitFor()
  await page.getByLabel('管理研究记录', { exact: true }).click()
  await page.getByText('编辑标题或摘要', { exact: true }).click()
  await page.getByRole('textbox', { name: '当前节点摘要', exact: true }).fill('分页保留的未保存草稿')
  await page.getByLabel('管理研究记录', { exact: true }).click()
  await page.locator('[data-record-id="paging-round-0"] .record-compact-title').evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); window.getSelection().removeAllRanges(); window.getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange')) })
  assert.equal(await membersPage.getByRole('button', { name: '下一页范围成员' }).isDisabled(), true)
  await page.getByRole('button', { name: '取消选区', exact: true }).click()
  await page.evaluate(() => { window.getSelection().removeAllRanges(); document.dispatchEvent(new Event('selectionchange')) })
  await membersPage.getByRole('button', { name: '下一页范围成员' }).click()
  await page.locator('[data-record-id="paging-round-100"]').waitFor()
  await page.getByLabel('管理研究记录', { exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前节点摘要', exact: true }).inputValue(), '分页保留的未保存草稿')
  await page.getByLabel('管理研究记录', { exact: true }).click()
  await page.locator('[data-record-id="paging-round-100"]').getByRole('button', { name: /^进入 / }).click()
  await page.getByRole('button', { name: '返回上一范围', exact: true }).click()
  await page.locator('[data-record-id="paging-round-100"]').waitFor()
  await membersPage.getByRole('button', { name: '上一页范围成员' }).click()
  await page.locator('[data-record-id="paging-round-0"]').waitFor()
  const pagingViews = page.getByRole('navigation', { name: '研究视图' })
  await pagingViews.getByRole('button', { name: '审查变化', exact: true }).click()
  await page.getByRole('button', { name: '修订记录', exact: true }).click()
  const reviewPage = page.getByRole('navigation', { name: '回看服务端分页' })
  await reviewPage.getByText(/1–20 \/ 125/).waitFor()
  await reviewPage.getByRole('button', { name: '下一页回看' }).click()
  await page.getByRole('button', { name: 'paging-round-104', exact: true }).waitFor()
  assert.equal(await page.locator('.record-review-item').count(), 20)
  await reviewPage.getByRole('button', { name: '上一页回看' }).click()
  await page.getByRole('button', { name: 'paging-round-124', exact: true }).waitFor()
  await pagingViews.getByRole('button', { name: '局部过程', exact: true }).click()
  await page.getByRole('button', { name: '阶段综合 分页研究范围', exact: true }).click()
  const synthesis = page.locator('[data-record-synthesis="paging"]')
  assert.match(await synthesis.innerText(), /含负例 1.*有未决问题 1/s)
  assert.equal(await synthesis.locator('[data-synthesis-entry]').count(), 12)
  for (const nextOffset of [48, 96]) {
    await synthesis.getByRole('button', { name: '下一页综合', exact: true }).click()
    await page.waitForFunction(offset => document.querySelector('[data-record-synthesis="paging"] [data-record-window]')?.getAttribute('data-record-window') === `synthesis:paging:${offset}`, nextOffset)
  }
  const group = synthesis.getByRole('navigation', { name: '综合条目显示窗口' })
  while (await group.getByRole('button', { name: '后一组' }).isEnabled()) await group.getByRole('button', { name: '后一组' }).click()
  await synthesis.getByText('最早负例仍须保留', { exact: true }).waitFor()
  await synthesis.getByText('最早未决尚未解决', { exact: true }).waitFor()
  await synthesis.getByText(/本页覆盖映射/).click()
  const mappings = synthesis.getByRole('navigation', { name: '本页覆盖映射显示窗口' })
  while (await mappings.getByRole('button', { name: '后一组' }).isEnabled()) await mappings.getByRole('button', { name: '后一组' }).click()
  await synthesis.locator('[data-coverage-member="paging-round-28"]').waitFor()
  await mappings.getByRole('button', { name: '前一组' }).click()
  await mappings.getByRole('button', { name: '前一组' }).click()
  await synthesis.locator('[data-coverage-member="paging-round-0"]').waitFor()
  await page.getByText('此前节点讨论（45）', { exact: true }).click()
  const messagesPage = page.getByRole('navigation', { name: '讨论服务端分页' })
  for (const offset of [20, 40]) {
    await messagesPage.getByRole('button', { name: '下一页讨论' }).click()
    await page.waitForFunction(offset => document.querySelector(`[data-record-window="messages:paging:${offset}"]`), offset)
  }
  await page.getByRole('button', { name: /^你的讨论 ·/ }).first().click()
  await page.getByText('历史讨论原文 0', { exact: true }).waitFor()
  const search = page.getByRole('form', { name: '本范围搜索' })
  await search.getByRole('textbox', { name: '本范围搜索文字' }).fill('paging-event-0')
  await search.getByRole('button', { name: '搜索本范围', exact: true }).click()
  await page.locator('[data-record-id="paging-event-0"]').waitFor()
  assert.match(await page.getByRole('navigation', { name: '搜索结果路径' }).innerText(), /paging-round-0/)
  await page.locator('[data-record-id="paging-event-0"]').getByRole('button', { name: /^查看 / }).click()
  const source = page.getByRole('region', { name: '记录详情' })
  await source.getByRole('button', { name: '原始依据', exact: true }).click()
  await source.getByText('来源一致', { exact: true }).waitFor()
  assert.equal(await source.locator('[data-source-text="命令"]').textContent(), 'echo exact-source-0')
  await source.getByRole('button', { name: '查看原始过程', exact: true }).click()
  assert.equal((await page.evaluate(() => window.recordOpenedSessions)).at(-1).itemId, 'paging-source-0')
  await page.getByRole('button', { name: '关闭记录详情', exact: true }).click()
  await search.getByRole('textbox').fill('ABSENT_SENTINEL')
  await search.getByRole('button', { name: '搜索本范围', exact: true }).click()
  await page.getByText('本范围无匹配；未加载不表示没有记录。', { exact: true }).waitFor()
  await search.getByRole('button', { name: '清除搜索', exact: true }).click()
  await membersPage.getByText(/1–100 \/ 125/).waitFor()
  await membersPage.getByRole('button', { name: '下一页范围成员' }).click()
  await page.locator('[data-record-id="paging-round-100"]').waitFor()
  const revision = (await pagingRuntime.view({ ...pagingScope, nodeId: 'paging' })).revision
  await pagingRuntime.edit({ ...pagingScope, requestId: randomUUID(), expectedRevision: revision, change: { kind: 'fields', nodeId: 'paging', summary: '新修订用于陈旧游标验证' } })
  await page.getByRole('alert').filter({ hasText: /范围或修订已变化/ }).waitFor()
  assert.equal(await page.locator('[data-record-id="paging-round-100"]').count(), 1)
  assert.equal(await membersPage.getByRole('button', { name: '下一页范围成员' }).isDisabled(), true)
  await page.getByRole('button', { name: '刷新研究记录', exact: true }).click()
  await page.locator('[data-record-id="paging-round-0"]').waitFor()
  pagingDenied = true
  await page.getByRole('button', { name: '刷新研究记录', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: /合成权限拒绝/ }).waitFor()
  pagingDenied = false
  await page.getByRole('button', { name: '刷新研究记录', exact: true }).click()
  await page.waitForFunction(() => ![...document.querySelectorAll('[role="alert"]')].some(element => element.textContent.includes('合成权限拒绝')))
  holdPaging = true
  await page.getByRole('button', { name: '刷新研究记录', exact: true }).click()
  while (!releasePaging) await new Promise(resolve => setTimeout(resolve, 10))
  await page.getByRole('button', { name: '切换测试工作区', exact: true }).click()
  await page.getByRole('button', { name: '进入 第二工作区独有记录', exact: true }).waitFor()
  releasePaging()
  await page.waitForTimeout(250)
  assert.equal(await page.locator('[data-record-id="paging-round-0"]').count(), 0)
  await page.getByRole('button', { name: '切换测试工作区', exact: true }).click()
  await page.locator('[data-record-id="paging-round-0"]').waitFor()
  assert.ok(pagingInputs.some(row => row.input.cursor))
  assert.ok(pagingInputs.some(row => row.input.synthesisOffset === 96))
  assert.ok(pagingInputs.some(row => row.input.messageOffset === 40))
  await writeFile(path.join(out, 'paging-inputs.json'), JSON.stringify(pagingInputs, null, 2))
  await page.screenshot({ path: path.join(out, 'server-pagination.png') })
  checks.push('real Store/Runtime/Broker: 125 members, 125 synthesis and coverage maps, 45 discussions; early negative/open/message/source reachable, subtree search and ancestors, review owner cursor round-trip, active selection paging lock, stale cursor explicit refresh, permission refusal, workspace late response rejected; no model run')
  await page.goto(server.resolvedUrls.local[0] + '__source-review', { waitUntil: 'networkidle', timeout: 90000 })
  const sourcePanel = page.locator('[data-record-source]')
  await sourcePanel.getByRole('button', { name: '复制命令', exact: true }).waitFor()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const rawCommand = sourceFixtures.failed.meta.command
  assert.equal(await sourcePanel.locator('[data-source-text="命令"]').textContent(), rawCommand)
  await sourcePanel.getByRole('button', { name: '复制命令', exact: true }).click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), rawCommand)
  assert.match(await sourcePanel.innerText(), /失败.*退出码 7/s)
  assert.match(await sourcePanel.innerText(), /来源已截断/)
  assert.equal(await sourcePanel.locator('[data-source-text="结果"]').count(), 0)
  await sourcePanel.getByText('结果与输出（1 项）', { exact: true }).click()
  assert.ok((await sourcePanel.locator('[data-source-text="结果"]').textContent()).length <= 6000)
  assert.match(await sourcePanel.innerText(), /ERROR missing file/)
  assert.ok(!(await sourcePanel.innerText()).includes('TAIL_SENTINEL'))
  await sourcePanel.getByRole('button', { name: '下一段', exact: true }).click()
  const savedSourceSegment = await sourcePanel.locator('[data-source-text="结果"]').textContent()
  assert.ok(!savedSourceSegment.includes('ERROR missing file'))
  await page.getByRole('button', { name: 'remount', exact: true }).click()
  assert.equal(await sourcePanel.count(), 0)
  await page.getByRole('button', { name: 'remount', exact: true }).click()
  await sourcePanel.locator('[data-source-text="结果"]').waitFor()
  assert.equal(await sourcePanel.locator('[data-source-text="结果"]').textContent(), savedSourceSegment)
  const next = sourcePanel.getByRole('button', { name: '下一段', exact: true })
  while (await next.isEnabled()) await next.click()
  assert.match(await sourcePanel.locator('[data-source-text="结果"]').textContent(), /TAIL_SENTINEL/)
  for (const width of [480, 320, 240]) {
    await page.setViewportSize({ width, height: 760 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: path.join(out, 'source-' + width + '.png') })
  }
  const sourceColors = []
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({width:480,height:760})
    await page.evaluate(value => { document.documentElement.dataset.theme = value }, theme)
    for (const [name,tone] of [['failed','check'],['running','active'],['completed','done']]) {
      await page.getByRole('button',{name,exact:true}).click()
      assert.equal(await sourcePanel.locator('[data-source-status]').getAttribute('data-record-tone'),tone)
      sourceColors.push({theme,name,tone,color:await sourcePanel.locator('[data-source-status]').evaluate(element=>getComputedStyle(element).color)})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      await page.screenshot({path:path.join(out,`status-${theme}-${name}.png`)})
    }
  }
  assert.equal(new Set(sourceColors.filter(value=>value.theme==='light').map(value=>value.color)).size,3)
  await writeFile(path.join(out,'status-colors.json'),JSON.stringify(sourceColors,null,2))
  await page.evaluate(()=>{document.documentElement.dataset.theme='light'})
  await page.getByRole('button',{name:'failed',exact:true}).click()
  checks.push('failed, running and completed execution each keep explicit text and muted status color in light/dark at 480px')
  checks.push('PowerShell original command copies CRLF bytes; failed exit and truncation stay visible; output DOM bounded to 6000 chars; final segment reachable; disclosure survives remount; 480/320/240 effective widths without page overflow')
  await page.getByRole('button', { name: 'cancelled', exact: true }).click()
  assert.match(await sourcePanel.innerText(), /已取消.*退出码未记录/s)
  assert.match(await sourcePanel.locator('[data-source-text="命令"]').textContent(), /sleep 90/)
  await page.getByRole('button', { name: 'changed', exact: true }).click()
  assert.match(await sourcePanel.innerText(), /来源已变化；下方为当前内容/)
  await page.getByRole('button', { name: 'unavailable', exact: true }).click()
  assert.match(await sourcePanel.innerText(), /来源不可用/)
  assert.equal(await sourcePanel.locator('[data-source-text="命令"]').count(), 0)
  await sourcePanel.getByRole('button', { name: '查看原始过程', exact: true }).click()
  assert.equal((await page.evaluate(() => window.sourceOpens)).at(-1).itemId, 'cancelled')
  await page.getByRole('button', { name: 'current', exact: true }).click()
  await page.getByRole('button', { name: 'unknown', exact: true }).click()
  assert.match(await sourcePanel.innerText(), /参数 JSON 无法解析/)
  assert.equal(await sourcePanel.getByRole('button', { name: '复制命令', exact: true }).count(), 0)
  await sourcePanel.getByText('技术字段与原始 JSON', { exact: true }).click()
  assert.match(await sourcePanel.locator('[data-source-text="原始 JSON"]').textContent(), /echo THIS_IS_A_SUMMARY/)
  assert.equal(await page.evaluate(() => window.sourceFixtureBytes), JSON.stringify(sourceFixtures))
  checks.push('JSON-string bash arguments, cancellation with unknown exit, changed/unavailable source and exact raw jump retained; invalid JSON and summary never fabricated into command')
  assert.deepEqual(errors, [])
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ platform: process.platform, scope: 'production capability Broker, runtime, React and side/global contributions; synthetic session/model; explicit public Workbench side-chat receiver fixture', failModel, modelCalls, checks, errors }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, out }))
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => undefined)
  const clicks = await page.evaluate(() => window.recordTestClicks ?? []).catch(() => [])
  await writeFile(path.join(out, 'failure.json'), JSON.stringify({ platform: process.platform, checks, errors, clicks, failure: error.stack }, null, 2))
  throw error
} finally { annotations.dispose(); await browser.close(); await server.close(); await runtime.close(); await pagingRuntime.close() }
