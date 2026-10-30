import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X, Zap } from 'lucide-react'
import {
  WORKFLOW_HOOK_MODES,
  WORKFLOW_HOOK_PHASES,
  type WorkflowHookPhase,
  type WorkflowHookMode,
  type WorkflowHookTriggerV1,
  type WorkflowV1
} from '../../contract.js'

const FIELD =
  'w-full rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[13px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25'

function isToolPhase(phase: WorkflowHookPhase): boolean {
  return phase === 'PreToolUse' || phase === 'PostToolUse'
}

function newTriggerId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `hook-${crypto.randomUUID()}`
    : `hook-${Date.now().toString(36)}`
}

/**
 * Editor for binding Create Loop workflows to local runtime hook phases — reactive
 * automation in code mode (e.g. PostToolUse on write/edit → run a review workflow).
 */
export function WorkflowHookTriggers({
  triggers,
  workflows,
  onChange,
  onClose
}: {
  triggers: WorkflowHookTriggerV1[]
  workflows: WorkflowV1[]
  onChange: (next: WorkflowHookTriggerV1[]) => void
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const update = (index: number, patch: Partial<WorkflowHookTriggerV1>): void =>
    onChange(triggers.map((trigger, i) => (i === index ? { ...trigger, ...patch } : trigger)))

  return (
    <div className="ds-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-[82vh] w-[620px] flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ds-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
            <div className="flex flex-col">
              <span className="text-[14px] font-semibold text-ds-ink">{t('workflowHooks')}</span>
              <span className="text-[11.5px] text-ds-faint">{t('workflowHooksHint')}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </header>

        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          {triggers.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] leading-5 text-ds-faint">{t('workflowHooksEmpty')}</p>
          ) : (
            triggers.map((trigger, index) => (
              <div key={trigger.id} className="flex flex-col gap-2.5 rounded-xl border border-ds-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-[12.5px] font-medium text-ds-muted">
                    <input
                      type="checkbox"
                      checked={trigger.enabled}
                      onChange={(event) => update(index, { enabled: event.target.checked })}
                    />
                    {t('workflowHookEnabled')}
                  </label>
                  <button
                    type="button"
                    onClick={() => onChange(triggers.filter((_, i) => i !== index))}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ds-faint transition hover:bg-red-500/10 hover:text-red-600"
                    aria-label={t('workflowHookRemove')}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-ds-faint">{t('workflowHookPhase')}</span>
                    <select
                      className={FIELD}
                      value={trigger.phase}
                      onChange={(event) => update(index, { phase: event.target.value as WorkflowHookPhase })}
                    >
                      {WORKFLOW_HOOK_PHASES.map((phase) => (
                        <option key={phase} value={phase}>
                          {t(`workflowHookPhase_${phase}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-ds-faint">{t('workflowHookWorkflow')}</span>
                    <select
                      className={FIELD}
                      value={trigger.workflowId}
                      onChange={(event) => update(index, { workflowId: event.target.value })}
                    >
                      <option value="">{t('workflowSubWorkflowNone')}</option>
                      {workflows.map((workflow) => (
                        <option key={workflow.id} value={workflow.id}>
                          {workflow.name || t('workflowUntitled')}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-ds-faint">{t('workflowHookMode')}</span>
                  <select
                    className={FIELD}
                    value={trigger.mode}
                    onChange={(event) => update(index, { mode: event.target.value as WorkflowHookMode })}
                  >
                    {WORKFLOW_HOOK_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`workflowHookMode_${mode}`)}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] leading-4 text-ds-faint">{t(`workflowHookModeHint_${trigger.mode}`)}</span>
                </label>

                {isToolPhase(trigger.phase) ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-ds-faint">{t('workflowHookToolNames')}</span>
                    <input
                      className={FIELD}
                      value={trigger.toolNames.join(', ')}
                      placeholder="write, edit"
                      onChange={(event) =>
                        update(index, {
                          toolNames: event.target.value
                            .split(',')
                            .map((name) => name.trim())
                            .filter((name) => name.length > 0)
                        })
                      }
                    />
                    <span className="text-[11px] leading-4 text-ds-faint">{t('workflowHookToolNamesHint')}</span>
                  </label>
                ) : null}
              </div>
            ))
          )}

          <button
            type="button"
            onClick={() =>
              onChange([
                ...triggers,
                {
                  id: newTriggerId(),
                  enabled: true,
                  workflowId: '',
                  phase: 'PostToolUse',
                  toolNames: ['write', 'edit'],
                  mode: 'observe',
                  timeoutMs: 0
                }
              ])
            }
            className="inline-flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-accent transition hover:bg-accent/10"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            {t('workflowHookAdd')}
          </button>

          <p className="rounded-lg bg-ds-subtle px-3 py-2 text-[11px] leading-5 text-ds-faint">
            {t('workflowHookRecursionNote')}
          </p>
        </div>
      </div>
    </div>
  )
}
