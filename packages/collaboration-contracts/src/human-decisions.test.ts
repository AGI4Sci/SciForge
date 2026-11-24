import {humanAnswerDecisionText} from './human-decisions.js'
import {describe,it,expect} from 'vitest'
import {humanDecisionInteractionSchema,humanNeededSchema} from './entities.js'
import {humanNeededDeferCommandSchema,humanAnswerCommandSchema} from './protocol.js'
import {humanNeededFixture,humanAnswerFixture,TEST_IDS} from './testing.js'

describe('one typed human decision request',()=>{
  it('requires unique explicit choices and a real recommendation',()=>{
    const interaction={kind:'choice',options:[{id:'a',label:'A'},{id:'b',label:'B'}],recommendedOptionId:'b'}
    expect(humanDecisionInteractionSchema.safeParse(interaction).success).toBe(true)
    expect(humanDecisionInteractionSchema.safeParse({...interaction,recommendedOptionId:'missing'}).success).toBe(false)
    expect(humanDecisionInteractionSchema.safeParse({...interaction,options:[{id:'a',label:'A'},{id:'a',label:'Again'}]}).success).toBe(false)
    expect(humanNeededSchema.safeParse({...humanNeededFixture,interaction}).success).toBe(true)
    expect(humanNeededSchema.safeParse({...humanNeededFixture,interaction:{kind:'approval'}}).success).toBe(false)
    const action={actionType:'workspace.write',safeSummary:'Write reviewed file',effect:'workspace-write',actionDigest:'a'.repeat(64)}
    expect(humanNeededSchema.safeParse({...humanNeededFixture,interaction,confirmableAction:action}).success).toBe(false)
    expect(humanNeededSchema.safeParse({...humanNeededFixture,interaction:{kind:'approval'},confirmableAction:action}).success).toBe(true)
  })
  it('binds defer and selection to one request revision without an executor payload',()=>{
    const command={protocolVersion:'1.0',requestId:TEST_IDS.requestId,idempotencyKey:'idem_defer_decision_1',type:'human.needed.defer',humanRequestId:TEST_IDS.humanRequestId,requestRevision:3,reason:'Waiting for evidence'}
    expect(humanNeededDeferCommandSchema.safeParse(command).success).toBe(true)
    expect(humanNeededDeferCommandSchema.safeParse({...command,reason:''}).success).toBe(false)
    expect(humanNeededDeferCommandSchema.safeParse({...command,execute:{command:'anything'}}).success).toBe(false)
    const {reason:_,...base}=command
    expect(humanAnswerCommandSchema.safeParse({...base,type:'human.answer',selectedOptionId:'a',answer:'Prefer this option'}).success).toBe(true)
  })
})

it('decision grounding preserves the authoritative question and choice meaning, not explanation guesses',()=>{
  const request={...humanNeededFixture,prompt:'Which method?',interaction:{kind:'choice' as const,options:[{id:'fast',label:'Fast method'},{id:'careful',label:'Careful method'}]}}
  const answer={...humanAnswerFixture,selectedOptionId:'careful',answer:'Explain why.'}
  expect(humanAnswerDecisionText(answer,request)).toBe('Question: Which method?\n\nSelected option: Careful method (careful)\n\nAnswer: Explain why.')
  expect(()=>humanAnswerDecisionText({...answer,selectedOptionId:'unknown'},request)).toThrow()
  expect(()=>humanAnswerDecisionText({...answer,humanRequestId:'hrq_other'},request)).toThrow()
  const long=humanAnswerDecisionText({...answer,answer:'x'.repeat(32000)},{...request,prompt:'p'.repeat(32000)})
  expect(long.length).toBe(32000)
  expect(long).toContain('Careful method (careful)')
  expect(long.endsWith('…')).toBe(true)
})

it('clarification grounding retains the original audited answer text',()=>{expect(humanAnswerDecisionText(humanAnswerFixture,humanNeededFixture)).toBe(humanAnswerFixture.answer)})
