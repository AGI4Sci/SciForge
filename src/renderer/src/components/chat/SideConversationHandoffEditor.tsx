import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
export type SideConversationHandoffDraft = { document: string; memory: string; instruction: string }
/** User review before the existing ordinary-input handoff; no persistence or execution here. */
export function SideConversationHandoffEditor({ value, error, busy, onChange, onCancel, onSend }: {
 value: SideConversationHandoffDraft; error: string; busy: boolean; onChange: (patch: Partial<SideConversationHandoffDraft>) => void; onCancel: () => void; onSend: () => void
}): ReactElement {
 const { t } = useTranslation('common')
 return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" aria-label={t('sideChatHandoffPreview')}>
      <p className="text-xs text-ds-muted">{t('sideChatHandoffDescription')}</p>
      <textarea className="min-h-48 flex-1 resize-y rounded-lg border border-ds-border bg-ds-main p-2 text-xs leading-5"
        aria-label={t('sideChatHandoffDocument')} value={value.document} onChange={e => onChange({ document: e.target.value })} />
      <label className="space-y-1 text-xs text-ds-muted">{t('sideChatMemoryReadRequests')}
        <textarea className="w-full rounded-lg border border-ds-border bg-ds-main p-2" rows={2} placeholder="memory/experiment.md"
          value={value.memory} onChange={e => onChange({ memory: e.target.value })} /></label>
      <label className="space-y-1 text-xs text-ds-muted">{t('sideChatNextInstruction')}
        <textarea className="w-full rounded-lg border border-ds-border bg-ds-main p-2" rows={2}
          value={value.instruction} onChange={e => onChange({ instruction: e.target.value })} /></label>
      {error ? <p role="alert" className="text-xs text-red-600 dark:text-red-300">{error}</p> : null}
      <div className="flex justify-end gap-2 text-xs"><button className="rounded-md border border-ds-border px-3 py-1.5" disabled={busy} onClick={onCancel}>{t('cancel')}</button>
        <button className="rounded-md bg-accent px-3 py-1.5 text-white disabled:opacity-50" disabled={busy || !value.document.trim()} onClick={onSend}>{t('sideChatHandoffSend')}</button></div>
    </div>
}
