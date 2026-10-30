import { useId, useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

const FIELD =
  'w-full rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-60'

export type ModelPickerGroup = {
  id: string
  name: string
  models: string[]
}

type Props = {
  providers: ModelPickerGroup[]
  providerId: string
  model: string
  onChange: (next: { providerId: string; model: string }) => void
  providerFilter?: (provider: ModelPickerGroup) => boolean
  modelsOf?: (provider: ModelPickerGroup) => string[]
  modelLabel?: string
  emptyHint?: string
}

export function ModelPicker({
  providers,
  providerId,
  model,
  onChange,
  providerFilter,
  modelsOf,
  modelLabel,
  emptyHint
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const listId = useId()
  const choices = useMemo(
    () => (providerFilter ? providers.filter(providerFilter) : providers),
    [providerFilter, providers]
  )
  const selected = choices.find((provider) => provider.id === providerId) ?? null
  const models = useMemo(() => {
    if (!selected) return []
    const rawModels = modelsOf ? modelsOf(selected) : selected.models
    return [...new Set(rawModels.map((item) => item.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  }, [modelsOf, selected])

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ds-muted">{t('scheduleProvider')}</span>
        <select
          className={FIELD}
          value={selected ? providerId : ''}
          onChange={(event) => onChange({ providerId: event.target.value, model: '' })}
        >
          <option value="">—</option>
          {choices.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name || provider.id}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ds-muted">{modelLabel ?? t('scheduleModel')}</span>
        <input
          className={FIELD}
          list={selected ? listId : undefined}
          value={selected ? model : ''}
          disabled={!selected}
          placeholder={selected ? 'auto' : t('workflowModelPickProviderFirst')}
          onChange={(event) => onChange({ providerId, model: event.target.value })}
        />
      </label>

      {selected ? (
        <datalist id={listId}>
          {models.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      ) : null}

      {emptyHint && (!selected || !model.trim()) ? (
        <span className="text-[11px] leading-4 text-ds-faint">{emptyHint}</span>
      ) : null}
    </div>
  )
}
