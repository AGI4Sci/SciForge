import { translateWorkspace as cw } from './workspace-i18n.js'

/**
 * Cloud activity and notification summaries are authored in English by the
 * Coordinator. The workspace renders them verbatim, which leaves English
 * sentences inside an otherwise Chinese timeline. Translate the known lifecycle
 * sentences here; anything unrecognized passes through unchanged so no
 * information is lost.
 */
const LIFECYCLE_SUMMARIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Worker confirmed a Delivery candidate;? its review is in progress\.?$/iu, '成员已确认交付候选，正在审核。'],
  [/^Worker approved the Delivery candidate;? immutable sealing follows\.?$/iu, '成员已批准交付候选，正在封存。'],
  [/^Worker sealed an immutable Delivery manifest;? it awaits the Coordinator decision\.?$/iu, '交付已封存，等待协调者决定。'],
  [/^Coordinator adopted the sealed Delivery\.?$/iu, '协调者已采纳该交付。'],
  [/^Coordinator requested a revision;? the Worker continues in the same private Session\.?$/iu, '协调者要求返修，成员在同一会话中继续。'],
  [/^Coordinator returned the Delivery to the Worker\.?$/iu, '协调者已把交付退回成员。'],
  [/^A Worker started the Task\.?$/iu, '成员已开始任务。'],
  [/^A Worker paused the Task\.?$/iu, '成员已暂停任务。'],
  [/^The Task was completed\.?$/iu, '任务已完成。']
]

export function localizeActivityText(value: string): string {
  const text = value ?? ''
  for (const [pattern, message] of LIFECYCLE_SUMMARIES) {
    if (pattern.test(text)) return cw(message)
  }
  return text
}
