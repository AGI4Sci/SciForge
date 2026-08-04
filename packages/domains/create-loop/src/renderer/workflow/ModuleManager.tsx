import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Blocks, Plus, Trash2, X } from 'lucide-react'
import {
  WORKFLOW_MODULE_FIELD_TYPES,
  type WorkflowCodeCheckResult,
  type WorkflowCodeLanguage,
  type WorkflowCustomModuleV1,
  type WorkflowModuleFieldType,
  type WorkflowModuleFieldV1
} from '../../contract.js'
import { useCreateLoopRuntime } from '../runtime-bridge.js'
import { createCustomModule } from './workflow-types'

const INPUT_CLASS =
  'w-full rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25'

const CODE_PLACEHOLDERS: Record<WorkflowCodeLanguage, string> = {
  javascript: 'return { greeting: `hi ${$fields.name}` }',
  python: 'import os, json\nf = json.loads(os.environ["WORKFLOW_FIELDS"])\nprint(json.dumps({"greeting": f["name"]}))',
  bash: 'echo "{\\"greeting\\": \\"$WORKFLOW_FIELDS\\"}"'
}

type Props = {
  modules: WorkflowCustomModuleV1[]
  onChange: (modules: WorkflowCustomModuleV1[]) => void
  onClose: () => void
}

/** Modal editor for user-defined script-backed modules. Edits a local draft, persists on Done. */
export function ModuleManager({ modules, onChange, onClose }: Props): ReactElement {
  const { t } = useTranslation('common')
  const runtime = useCreateLoopRuntime()
  const [draft, setDraft] = useState<WorkflowCustomModuleV1[]>(modules)
  const [selectedId, setSelectedId] = useState<string | null>(modules[0]?.id ?? null)
  const [codeCheck, setCodeCheck] = useState<WorkflowCodeCheckResult | null>(null)

  const selected = useMemo(() => draft.find((module) => module.id === selectedId) ?? null, [draft, selectedId])

  // Debounced syntax check for the selected module's script.
  useEffect(() => {
    if (!selected || !selected.code.trim()) {
      setCodeCheck(null)
      return
    }
    let cancelled = false
    const handle = setTimeout(() => {
      runtime
        .checkWorkflowCode(selected.language, selected.code)
        .then((result) => {
          if (!cancelled) setCodeCheck(result)
        })
        .catch(() => {
          if (!cancelled) setCodeCheck(null)
        })
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [runtime, selected])

  const update = (id: string, patch: Partial<WorkflowCustomModuleV1>): void =>
    setDraft((list) => list.map((module) => (module.id === id ? { ...module, ...patch } : module)))

  const addModule = (): void => {
    const module = createCustomModule(t('workflowModuleNewName'))
    setDraft((list) => [...list, module])
    setSelectedId(module.id)
  }

  const deleteModule = (id: string): void => {
    setDraft((list) => list.filter((module) => module.id !== id))
    setSelectedId((current) => (current === id ? null : current))
  }

  const updateField = (fieldIndex: number, patch: Partial<WorkflowModuleFieldV1>): void => {
    if (!selected) return
    const fields = selected.fields.map((field, index) => (index === fieldIndex ? { ...field, ...patch } : field))
    update(selected.id, { fields })
  }

  const addField = (): void => {
    if (!selected) return
    const field: WorkflowModuleFieldV1 = {
      key: `field${selected.fields.length + 1}`,
      label: '',
      type: 'text',
      defaultValue: '',
      options: [],
      placeholder: ''
    }
    update(selected.id, { fields: [...selected.fields, field] })
  }

  const removeField = (fieldIndex: number): void => {
    if (!selected) return
    update(selected.id, { fields: selected.fields.filter((_, index) => index !== fieldIndex) })
  }

  return (
    <div className="ds-no-drag fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-6">
      <div className="flex h-[80vh] w-full max-w-[900px] flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-xl">
        <div className="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ds-ink">
            <Blocks className="h-4 w-4 text-accent" strokeWidth={1.9} />
            {t('workflowModulesTitle')}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onChange(draft)
                onClose()
              }}
              className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-[12.5px] font-medium text-white transition hover:opacity-90"
            >
              {t('workflowModulesDone')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ds-border text-ds-muted transition hover:bg-ds-hover"
              aria-label={t('cancel')}
            >
              <X className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[220px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-ds-border bg-ds-card/40 p-2">
            <button
              type="button"
              onClick={addModule}
              className="mb-1 flex items-center gap-2 rounded-lg border border-dashed border-ds-border px-2 py-2 text-[12.5px] font-medium text-ds-muted transition hover:border-accent/50 hover:text-accent"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
              {t('workflowModuleNew')}
            </button>
            {draft.length === 0 ? (
              <p className="px-2 py-1 text-[11.5px] leading-4 text-ds-faint">{t('workflowModulesEmpty')}</p>
            ) : (
              draft.map((module) => (
                <button
                  key={module.id}
                  type="button"
                  onClick={() => setSelectedId(module.id)}
                  className={`flex items-center gap-2 rounded-lg px-2 py-2 text-left text-[12.5px] transition ${
                    module.id === selectedId
                      ? 'bg-accent/10 text-accent'
                      : 'text-ds-ink hover:bg-ds-hover'
                  }`}
                >
                  <Blocks className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                  <span className="min-w-0 flex-1 truncate">{module.name || t('workflowModuleNewName')}</span>
                  <span className="shrink-0 text-[10px] uppercase text-ds-faint">{module.language}</span>
                </button>
              ))
            )}
          </aside>

          {selected ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[12px] font-medium text-ds-muted">{t('workflowModuleName')}</span>
                    <input
                      className={INPUT_CLASS}
                      value={selected.name}
                      onChange={(event) => update(selected.id, { name: event.target.value })}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => deleteModule(selected.id)}
                  className="mt-6 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ds-border text-ds-muted transition hover:bg-red-500/10 hover:text-red-600"
                  aria-label={t('workflowModuleDelete')}
                  title={t('workflowModuleDelete')}
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-ds-muted">{t('workflowModuleDescription')}</span>
                <input
                  className={INPUT_CLASS}
                  value={selected.description}
                  placeholder={t('workflowModuleDescriptionPlaceholder')}
                  onChange={(event) => update(selected.id, { description: event.target.value })}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-ds-muted">{t('workflowCodeLanguage')}</span>
                <select
                  className={INPUT_CLASS}
                  value={selected.language}
                  onChange={(event) => {
                    const value = event.target.value
                    update(selected.id, {
                      language: value === 'python' || value === 'bash' ? (value as WorkflowCodeLanguage) : 'javascript'
                    })
                  }}
                >
                  <option value="javascript">JavaScript</option>
                  <option value="python">Python</option>
                  <option value="bash">Shell (bash)</option>
                </select>
              </label>

              <div className="flex flex-col gap-2 border-t border-ds-border pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-ds-muted">{t('workflowModuleFields')}</span>
                  <button
                    type="button"
                    onClick={addField}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium text-accent transition hover:bg-accent/10"
                  >
                    <Plus className="h-3 w-3" strokeWidth={2} />
                    {t('workflowModuleAddField')}
                  </button>
                </div>
                {selected.fields.length === 0 ? (
                  <p className="text-[11.5px] leading-4 text-ds-faint">{t('workflowModuleFieldsHint')}</p>
                ) : (
                  selected.fields.map((field, index) => (
                    <div key={index} className="flex flex-col gap-2 rounded-lg border border-ds-border p-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          className={INPUT_CLASS}
                          value={field.key}
                          placeholder={t('workflowModuleFieldKey')}
                          onChange={(event) => updateField(index, { key: event.target.value })}
                        />
                        <select
                          className={`${INPUT_CLASS} w-32 shrink-0`}
                          value={field.type}
                          onChange={(event) =>
                            updateField(index, { type: event.target.value as WorkflowModuleFieldType })
                          }
                        >
                          {WORKFLOW_MODULE_FIELD_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {t(`workflowModuleFieldType_${type}`)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeField(index)}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-faint transition hover:bg-red-500/10 hover:text-red-600"
                          aria-label={t('workflowModuleRemoveField')}
                        >
                          <X className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          className={INPUT_CLASS}
                          value={field.label}
                          placeholder={t('workflowModuleFieldLabel')}
                          onChange={(event) => updateField(index, { label: event.target.value })}
                        />
                        <input
                          className={INPUT_CLASS}
                          value={field.defaultValue}
                          placeholder={t('workflowModuleFieldDefault')}
                          onChange={(event) => updateField(index, { defaultValue: event.target.value })}
                        />
                      </div>
                      {field.type === 'select' ? (
                        <input
                          className={INPUT_CLASS}
                          value={field.options.join(', ')}
                          placeholder={t('workflowModuleFieldOptions')}
                          onChange={(event) =>
                            updateField(index, {
                              options: event.target.value
                                .split(',')
                                .map((option) => option.trim())
                                .filter((option) => option.length > 0)
                            })
                          }
                        />
                      ) : null}
                    </div>
                  ))
                )}
              </div>

              <label className="flex flex-col gap-1.5 border-t border-ds-border pt-3">
                <span className="text-[12px] font-medium text-ds-muted">{t('workflowCode')}</span>
                <textarea
                  className={`${INPUT_CLASS} min-h-[160px] resize-y font-mono`}
                  value={selected.code}
                  placeholder={CODE_PLACEHOLDERS[selected.language]}
                  onChange={(event) => update(selected.id, { code: event.target.value })}
                />
              </label>
              <p className="text-[11.5px] leading-5 text-ds-faint">{t('workflowModuleCodeHint')}</p>
              {codeCheck?.status === 'error' ? (
                <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2">
                  <div className="text-[11.5px] font-semibold text-red-600">{t('workflowCodeSyntaxError')}</div>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-red-600/90">
                    {codeCheck.message}
                  </pre>
                </div>
              ) : codeCheck?.status === 'ok' ? (
                <div className="text-[11.5px] font-medium text-emerald-600">✓ {t('workflowCodeSyntaxOk')}</div>
              ) : codeCheck?.status === 'unavailable' ? (
                <div className="text-[11.5px] text-ds-faint">{codeCheck.message}</div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-ds-faint">
              {t('workflowModulesPick')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
