import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { DiscussionHandoffDraft } from '../../store/discussion-checkpoint'
export type SideConversationHandoffDraft = DiscussionHandoffDraft
/** User review before the existing ordinary-input handoff; no persistence or execution here. */
export function SideConversationHandoffEditor({ value, error, busy, stale = false, sent = false, uncertain = false, onReconcile, latestAnswer, onRefresh, onChange, onCancel, onSend }: {
 value: SideConversationHandoffDraft; error: string; busy: boolean; onChange: (patch: Partial<SideConversationHandoffDraft>) => void; onCancel: () => void; onSend: () => void
 stale?: boolean; sent?: boolean; onRefresh?: () => void
 latestAnswer?: string
 uncertain?: boolean; onReconcile?: () => void
}): ReactElement {
 const { t } = useTranslation('common')
 return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" aria-label={t('sideChatHandoffPreview')}>
      <p className="text-ds-sm text-ds-muted">{t('sideChatHandoffDescription')}</p>
      {uncertain && <div role="alert" className="rounded-lg border border-ds-border p-2 text-ds-sm">{t('sideChatHandoffUncertain')}
        <button type="button" onClick={onReconcile} className="mt-2 block underline">{t('sideChatHandoffReconciled')}</button></div>}
      {stale && <div role="status" className="rounded-lg border border-ds-border p-2 text-ds-sm">{t('sideChatHandoffChanged')}
        <p className="my-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{latestAnswer}</p>
        <button type="button" disabled={busy} onClick={onRefresh} className="mt-2 block underline">{t('sideChatHandoffRefresh')}</button></div>}
      <textarea className="min-h-48 flex-1 resize-y rounded-lg border border-ds-border bg-ds-main p-2 text-ds-sm leading-5"
        disabled={busy} maxLength={60000} aria-label={t('sideChatHandoffDocument')} value={value.document} onChange={e => onChange({ document: e.target.value })} />
      <label className="space-y-1 text-ds-sm text-ds-muted">{t('sideChatNextInstruction')}
        <textarea className="w-full rounded-lg border border-ds-border bg-ds-main p-2" rows={2} disabled={busy} maxLength={8000}
          value={value.instruction} onChange={e => onChange({ instruction: e.target.value })} /></label>
      <details><summary className="cursor-pointer text-ds-sm text-ds-muted">{t('sideChatMoreSources')}{(value.preserve?.trim() || value.verification?.trim() || value.memory.trim()) ? ` · ${t('sideChatDetailsAdded')}` : ''}</summary>
      <div className="mt-2 space-y-3">
      <label className="block space-y-1 text-ds-sm text-ds-muted">{t('sideChatPreserve')}
        <textarea className="w-full rounded-lg border border-ds-border bg-ds-main p-2" rows={2} disabled={busy} maxLength={8000}
          value={value.preserve ?? ''} onChange={e => onChange({ preserve: e.target.value })} /></label>
      <label className="block space-y-1 text-ds-sm text-ds-muted">{t('sideChatVerification')}
        <textarea className="w-full rounded-lg border border-ds-border bg-ds-main p-2" rows={2} disabled={busy} maxLength={8000}
          value={value.verification ?? ''} onChange={e => onChange({ verification: e.target.value })} /></label>
      <label className="block space-y-1 text-ds-sm text-ds-muted">{t('sideChatMemoryReadRequests')}
        <textarea className="w-full rounded-lg border border-ds-border bg-ds-main p-2" rows={2} placeholder="memory/experiment.md" disabled={busy} maxLength={8000}
          value={value.memory} onChange={e => onChange({ memory: e.target.value })} /></label>
      </div></details>
      {error ? <p role="alert" className="text-ds-sm text-red-600 dark:text-red-300">{error}</p> : null}
      <div className="flex justify-end gap-2 text-ds-sm"><button className="rounded-md border border-ds-border px-3 py-1.5" disabled={busy} onClick={onCancel}>{t('cancel')}</button>
        <button className="rounded-md bg-accent px-3 py-1.5 text-white disabled:opacity-50" disabled={busy || stale || sent || uncertain || !value.document.trim()} onClick={onSend}>{t(sent ? 'sideChatHandoffAccepted' : 'sideChatHandoffSend')}</button></div>
    </div>
}
