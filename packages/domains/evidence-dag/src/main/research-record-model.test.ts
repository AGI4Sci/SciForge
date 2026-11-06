import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import type { DomainMainAgentExecutionRequest } from '@sciforge/domain-sdk/agent-execution'
import { z } from 'zod'
import { researchRecordClassificationSchema, researchRecordPhaseSynthesisSchema } from '../research-record-contract.js'
import { reasonAboutResearchRecord, researchRecordGenerationSchema, researchRecordCompactClassificationSchema } from './research-record-model.js'

const input = () => ({ instruction: '仅分析来源', data: { evidence: [] }, model: 'gpt-6.1-terra',
  runtimeId: 'codex', sourceThreadId: 'main', workspaceRoot: '/project', signal: new AbortController().signal })
const context = (run: (request: DomainMainAgentExecutionRequest) => Promise<unknown>) => ({
  agentExecution: { run }, modelAccess: { textReasoner: () => { throw new Error('Do not use separate API credentials') } }
}) as unknown as DomainMainRuntimeLifecycleContext

test('routes chosen fast model through a fresh hidden native Agent Session with no tools and source provenance', async () => {
  const result = await reasonAboutResearchRecord(context(async request => {
    assert.equal(request.runtimeId, 'codex')
    assert.equal(request.model, 'gpt-6.1-terra')
    assert.equal(request.threadId, undefined)
    assert.equal(request.interaction, 'background')
    assert.equal(request.contextProfile, 'minimal')
    assert.equal(request.reasoningEffort, 'none')
    assert.deepEqual(request.allowedTools, [])
    assert.deepEqual(request.metadata, { producer: 'evidence-dag.research-record', purpose: 'organize', sourceThreadId: 'main' })
    return { runtimeId: 'codex', threadId: 'side', turnId: 'turn', state: 'completed', text: '来源不足。' }
  }), input())
  assert.equal(result.execution.threadId, 'side')
  assert.equal(result.text, '来源不足。')
})

test('empty model inherits selected runtime configuration; cancellation reaches its execution signal', async () => {
  const controller = new AbortController()
  await reasonAboutResearchRecord(context(async request => {
    assert.equal(request.model, undefined)
    assert.equal(request.signal?.aborted, false)
    controller.abort()
    assert.equal(request.signal?.aborted, true)
    return { runtimeId: 'claude', threadId: 'side', turnId: 'turn', state: 'cancelled', text: '' }
  }), { ...input(), runtimeId: 'claude', model: '', signal: controller.signal }).then(
    () => assert.fail('A cancelled answer must not be accepted'),
    error => assert.match(error.message, /cancelled/)
  )
})

test('native execution errors remain failures without an HTTP fallback or accepting partial answers', async () => {
  await assert.rejects(reasonAboutResearchRecord(context(async () => ({
    runtimeId: 'codex', threadId: 'side', turnId: 'turn', state: 'failed', text: 'partial',
    failure: { code: 'model_capacity', message: 'private upstream body', retryable: true }
  })), input()), error => {
    assert.match((error as Error).message, /model_capacity/)
    assert.doesNotMatch((error as Error).message, /private upstream body/)
    return true
  })
  await assert.rejects(reasonAboutResearchRecord({} as DomainMainRuntimeLifecycleContext, input()), /Agent 接入当前不可用/)
})

test('serialized input has an explicit character ceiling before any native model call', async () => {
  let calls = 0
  await assert.rejects(reasonAboutResearchRecord(context(async () => { calls++; return {} }), {
    ...input(), data: { oversized: 'x'.repeat(24000) }
  }), /24000/)
  assert.equal(calls, 0)
})

test('native round and phase output schemas use anyOf and require every object property', () => {
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const schema = value as Record<string, unknown>
    assert.equal('oneOf' in schema, false, 'native structured output rejects oneOf')
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false)
      assert.deepEqual([...(schema.required as string[])].sort(), Object.keys(schema.properties as object).sort())
    }
    for (const child of Object.values(schema)) {
      if (Array.isArray(child)) child.forEach(inspect)
      else inspect(child)
    }
  }
  for (const contract of [researchRecordClassificationSchema, researchRecordPhaseSynthesisSchema]) {
    const json = z.toJSONSchema(contract)
    assert.match(JSON.stringify(json), /"anyOf"/)
    inspect(json)
  }
})

test('generation offers resolve only for existing active questions and enumerates supplied evidence', () => {
  for (const phase of [false, true]) {
    const empty = JSON.stringify(researchRecordGenerationSchema(phase, ['source-a'], []))
    assert.doesNotMatch(empty, /"resolve"|"entryId"/)
    assert.match(empty, /"enum":\["source-a"\]/)
    const existing = JSON.stringify(researchRecordGenerationSchema(phase, ['source-a', 'source-b'], ['open-a']))
    assert.match(existing, /"anyOf"/)
    assert.match(existing, /"enum":\["open-a"\]/)
    assert.doesNotMatch(existing, /"oneOf"/)
  }
})

test('generation bounds disjoint step assignments by unique source count and separates citation reuse', () => {
  const schema = researchRecordGenerationSchema(false, ['source-a', 'source-b', 'source-c', 'source-a'], [])
  const properties = schema.properties as Record<string, { maxItems?: number; description?: string; items?: {
    properties?: Record<string, { maxItems?: number; description?: string; items?: { enum?: string[] } }>
  } }>
  assert.equal(properties.steps.maxItems, 3)
  assert.equal(properties.steps.items?.properties?.sourceIds.maxItems, 3)
  assert.deepEqual(properties.steps.items?.properties?.sourceIds.items?.enum, ['source-a', 'source-b', 'source-c'])
  assert.match(properties.steps.items?.properties?.sourceIds.description ?? '', /整个steps.*跨步骤和步骤内部/)
  assert.match(properties.statePatch.description ?? '', /不同变更可引用同一真实来源/)
  const large = researchRecordGenerationSchema(false, Array.from({ length: 60 }, (_, index) => `source-${index}`), [])
  const largeProperties = large.properties as typeof properties
  assert.equal(largeProperties.steps.maxItems, 4)
  assert.equal(largeProperties.steps.items?.properties?.sourceIds.maxItems, 48)
})

test('organization prompt distinguishes unique source placement from reusable state citations', async () => {
  for (const purpose of ['organize', 'phase-synthesis'] as const) {
    await reasonAboutResearchRecord(context(async request => {
      if (purpose === 'organize') {
        assert.match(request.prompt, /所有steps\[\*\]\.sourceIds展开后，每个来源ID最多出现一次/)
        assert.match(request.prompt, /statePatch是证据引用，允许不同变更复用同一来源/)
        assert.match(request.prompt, /无法分类的来源可省略/)
      } else assert.doesNotMatch(request.prompt, /steps是来源的互不重叠分组/)
      return { runtimeId: 'codex', threadId: 'side', turnId: 'turn', state: 'completed', text: '{}' }
    }), { ...input(), purpose })
  }
})


test('compact generation bounds new groups and descriptions without narrowing retained source contracts', async () => {
  const schema = researchRecordGenerationSchema(false, Array.from({ length: 40 }, (_, i) => 'source-'+i), [])
  const properties = schema.properties as Record<string, { maxItems?: number; maxLength?: number; items?: { properties?: Record<string, { maxLength?: number }> } }>
  assert.equal(properties.phasePath.maxItems, 3)
  assert.equal(properties.title.maxLength, 80)
  assert.equal(properties.steps.maxItems, 4)
  assert.equal(properties.steps.items?.properties?.summary.maxLength, 160)
  await reasonAboutResearchRecord(context(async request => {
    assert.match(request.prompt, /不按工具调用逐条建步骤/)
    assert.match(request.prompt, /不同实验与失败不得因压缩混为同一成功/)
    assert.match(request.prompt, /负例、未决及其来源必须保留/)
    return { runtimeId: 'codex', threadId: 'side', turnId: 'turn', state: 'completed', text: '{}' }
  }), input())
})


test('new receipt validation rejects excessive splitting while historical records remain readable', () => {
  const receipt = { phasePath: ['比较'], title: '复核对照', statePatch: [{ op: 'add', kind: 'negative', text: '条件B失败', sourceIds: ['s'] }],
    steps: Array.from({ length: 5 }, (_, i) => ({ title: '动作'+i, summary: '记录结果', sourceIds: ['s'+i] })) }
  assert.equal(researchRecordClassificationSchema.safeParse(receipt).success, true)
  assert.equal(researchRecordCompactClassificationSchema.safeParse(receipt).success, false)
  assert.equal(researchRecordCompactClassificationSchema.safeParse({ ...receipt, steps: receipt.steps.slice(0, 4) }).success, true)
  assert.equal(researchRecordCompactClassificationSchema.safeParse({ ...receipt, steps: [], phasePath: ['a','b','c','d'] }).success, false)
  assert.equal(researchRecordCompactClassificationSchema.safeParse({ ...receipt, steps: [], title: 'x'.repeat(81) }).success, false)
})
