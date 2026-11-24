import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuditReviewHistory } from './AuditReviewHistory'
import type { ResearchAuditEvidenceAuditQueryOutput } from '@sciforge/domain-sdk/research-audit'

type Decisions = NonNullable<ResearchAuditEvidenceAuditQueryOutput['reviewDecisions']>
function record(): Decisions['records'][number] {
  return { eventId:'internal-event', sequence:2, idempotencyKey:'internal-idempotency', type:'HumanReviewDecisionRecorded', persistent:true,
    occurredAt:'2026-11-10T04:00:00Z', threadId:'internal-thread', snapshotDigest:'sha256:'+ 'a'.repeat(64), reviewPacketId:'internal-packet',
    action:'request_evidence', actor:'caller-provided-name', rationale:'需要补充独立对照。', reviewReceipt:{
      scope:{kind:'review-packet',snapshotDigest:'sha256:'+ 'a'.repeat(64),reviewPacketId:'internal-packet',targetIds:['internal-target-a','internal-target-b'],assessmentIds:['internal-assessment']},
      identity:{status:'unverified',source:'caller-label',principal:null},timing:{status:'unknown',elapsedMs:null,activeMs:null},previousDecisionEventId:'internal-prior'
    } }
}
const render = (decisions?: Decisions) => renderToStaticMarkup(<AuditReviewHistory decisions={decisions} />)
test('unavailable or partial decisions are not represented as an empty complete history',()=>{
  assert.match(render(),/暂时无法读取/)
  assert.doesNotMatch(render({status:'unavailable',records:[],reasons:['internal-code']}),/尚无已记录|internal-code/)
  assert.match(render({status:'partial',records:[],reasons:[]}),/只能读取部分/)
  assert.doesNotMatch(render({status:'partial',records:[],reasons:[]}),/尚无已记录/)
  assert.match(render({status:'available',records:[],reasons:[]}),/此范围尚无已记录/)
})
test('actual decision stays read-only, scoped and distinct from a verified identity or historical cutoff',()=>{
  const item=record(), input: Decisions={status:'available',records:[item],reasons:[]}
  const original=JSON.stringify(input), html=render(input)
  assert.match(html,/请求补充材料/);assert.match(html,/需要补充独立对照/);assert.match(html,/当时的 2 项材料/)
  assert.match(html,/身份未核实/);assert.match(html,/后续判断/);assert.match(html,/材料形成后的判断/)
  assert.doesNotMatch(html,/internal-|caller-provided-name|sha256:|<button|<form|已通过/)
  assert.equal(JSON.stringify(input),original)
  assert.match(render({...input,asOf:'2026-11-10T04:01:00Z'}),/截至/)
})
test('remaining decision history is reachable, and untrusted reasons stay text',()=>{
  const records=Array.from({length:5},(_,index)=>({...record(),eventId:String(index),rationale:'<img src=x onerror=alert(1)>'}))
  const html=render({status:'partial',records,reasons:[]})
  assert.match(html,/其余 2 条意见/);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/)
})
