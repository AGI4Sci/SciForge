import { getI18n } from 'react-i18next'
import { translateWorkspace } from './workspace-i18n.js'
/** Dates shown together in task activity, delivery provenance and snapshots use the viewer's timezone. */
/** Full local timestamp for a hover title; the visible label stays compact. */
export function formatAbsoluteTime(value: string): string {
  if (!value) return ''
  return new Date(value).toLocaleString(getI18n()?.resolvedLanguage ?? 'zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  })
}

export function formatWorkspaceTime(value: string): string {
  if (!value) return translateWorkspace('时间待同步')
  return new Date(value).toLocaleString(getI18n()?.resolvedLanguage ?? 'zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
