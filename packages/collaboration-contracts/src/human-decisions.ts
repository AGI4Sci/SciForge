import type { HumanAnswer, HumanNeeded } from './entities.js'

/** Derive decision grounding only from the bound authoritative request and answer. */
export function humanAnswerDecisionText(
  answer: Pick<HumanAnswer,'humanRequestId'|'answer'|'selectedOptionId'|'decision'>,
  request: Pick<HumanNeeded,'humanRequestId'|'prompt'|'interaction'|'confirmableAction'>
): string {
  if(answer.humanRequestId!==request.humanRequestId)throw new Error('Human answer and request do not match.')
  if(request.interaction.kind==='clarification'){
    if(answer.selectedOptionId!==null||answer.decision!==null)throw new Error('Clarification cannot carry a choice or approval.')
    return answer.answer
  }
  const excerpt=(text:string,limit:number)=>text.length<=limit?text:`${text.slice(0,limit-1)}…`
  const parts=[`Question: ${excerpt(request.prompt,8000)}`]
  if(request.interaction.kind==='choice'){
    const option=request.interaction.options.find(item=>item.id===answer.selectedOptionId)
    if(!option||answer.decision!==null)throw new Error('Human answer must identify one declared choice.')
    parts.push(`Selected option: ${option.label} (${option.id})`)
  }else if(request.interaction.kind==='approval'){
    if(!request.confirmableAction||answer.selectedOptionId!==null||(answer.decision!=='approve'&&answer.decision!=='reject'))throw new Error('Human approval answer is incomplete.')
    parts.push(`Action: ${request.confirmableAction.safeSummary}`,`Decision: ${answer.decision}`)
  }
  const prefix=parts.join('\n\n')+'\n\nAnswer: '
  return prefix+excerpt(answer.answer,32000-prefix.length)
}
