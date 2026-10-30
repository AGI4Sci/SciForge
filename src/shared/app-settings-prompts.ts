import type { AppSettingsV1 } from './app-settings-types'

export const SCHEDULE_CURRENT_USER_REQUEST_HEADING = '[Current scheduled task]'
export const SCHEDULE_MANAGED_INSTRUCTIONS_HEADING = '[Schedule managed instructions]'

export function buildScheduleRuntimePrompt(
  settings: Pick<AppSettingsV1, 'schedule'>,
  prompt: string
): string {
  const schedule = settings.schedule
  const instructions: string[] = []
  if (schedule.skills.defaultNames.length > 0) {
    instructions.push(`Schedule skill policy: prefer these configured skills when relevant: ${schedule.skills.defaultNames.join(', ')}.`)
  }
  if (schedule.skills.extraDirs.length > 0) {
    instructions.push(`Additional local skill directories configured in the GUI: ${schedule.skills.extraDirs.join(', ')}.`)
  }
  const prefix = schedule.promptPrefix.trim()
  if (prefix) instructions.push(prefix)
  if (instructions.length === 0) return prompt
  return `${SCHEDULE_MANAGED_INSTRUCTIONS_HEADING}\n\n${instructions.join('\n\n')}\n\n---\n${SCHEDULE_CURRENT_USER_REQUEST_HEADING}\n${prompt}`
}

export const CODE_MANAGED_INSTRUCTIONS_HEADING = '[Code managed instructions]'
export const CODE_CURRENT_USER_REQUEST_HEADING = '[Current user request]'

export function buildCodeRuntimePrompt(
  settings: Pick<AppSettingsV1, 'codePromptPrefix'>,
  prompt: string
): string {
  const prefix = (settings.codePromptPrefix ?? '').trim()
  if (!prefix) return prompt
  return `${CODE_MANAGED_INSTRUCTIONS_HEADING}\n\n${prefix}\n\n---\n${CODE_CURRENT_USER_REQUEST_HEADING}\n${prompt}`
}
