import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Database, Play, X } from 'lucide-react'
import type { CreateDatasetLoopInput } from '../../contract.js'

type DatasetSourceBinding = NonNullable<CreateDatasetLoopInput['sourceBindings']>[number]
export type DatasetSourceOption = Readonly<{
  id: string
  name: string
  binding?: DatasetSourceBinding
}>

export function DatasetLoopDialog({
  sources,
  onSubmit,
  onClose
}: Readonly<{
  sources: readonly DatasetSourceOption[]
  onSubmit: (input: CreateDatasetLoopInput) => Promise<void>
  onClose: () => void
}>): ReactElement {
  const { t } = useTranslation('common')
  const [name, setName] = useState(t('workflowDatasetDefaultName'))
  const [objective, setObjective] = useState('Build a high-quality, traceable biology dataset.')
  const [selected, setSelected] = useState(() => new Set(sources.slice(0, 2).map((source) => source.id)))
  const [criteria, setCriteria] = useState('Every record is supported by source evidence.\nRequired fields are complete and internally consistent.')
  const [targetCount, setTargetCount] = useState(5)
  const [maxIterations, setMaxIterations] = useState(8)
  const [datasetName, setDatasetName] = useState('generated_biology_dataset')
  const [fileName, setFileName] = useState('dataset.jsonl')
  const [format, setFormat] = useState<CreateDatasetLoopInput['output']['format']>('jsonl')
  const [humanReview, setHumanReview] = useState(true)
  const [run, setRun] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const criterionList = useMemo(
    () => criteria.split('\n').map((item) => item.trim()).filter(Boolean),
    [criteria]
  )
  const invalid = !name.trim() || !objective.trim() || selected.size === 0 || criterionList.length === 0 ||
    targetCount < 1 || maxIterations < targetCount || !datasetName.trim() || !fileName.trim()

  const submit = async (): Promise<void> => {
    if (invalid || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const selectedSources = sources.filter((source) => selected.has(source.id))
      await onSubmit({
        name: name.trim(),
        objective: objective.trim(),
        sourceIds: selectedSources.map((source) => source.id),
        sourceBindings: selectedSources.flatMap((source) => (
          source.binding ? [source.binding] : []
        )),
        quality: {
          criteria: criterionList,
          targetCount,
          maxIterations,
          minQualityScore: 0.7,
          minStrongScore: 0.65,
          maxWeakScore: 0.5,
          minScoreGap: 0.2,
          minRubricCoverage: 0.8,
          minQuestionQuality: 0.7,
          maxDuplicateFraction: 0.05
        },
        output: { datasetName: datasetName.trim(), fileName: fileName.trim(), format },
        humanReview,
        run
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
      setSubmitting(false)
    }
  }

  return (
    <div className="ds-no-drag fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-hidden rounded-lg border border-ds-border bg-ds-card shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-ds-border px-5 py-4">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600">
            <Database className="h-4.5 w-4.5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-ds-ink">{t('workflowBuildDataset')}</h2>
            <p className="text-[11.5px] text-ds-faint">{t('workflowDatasetBuilderHint')}</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ds-faint hover:bg-ds-hover hover:text-ds-ink" aria-label={t('cancel')}>
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 grid-cols-1 gap-5 overflow-y-auto px-5 py-4 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <TextField label={t('workflowDatasetLoopName')} value={name} onChange={setName} />
            <TextArea label={t('workflowDatasetObjective')} value={objective} onChange={setObjective} rows={4} />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[12px] font-medium text-ds-muted">{t('workflowDatasetSources')}</legend>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {sources.map((source) => (
                  <label key={source.id} className="flex min-w-0 items-center gap-2 rounded-md border border-ds-border px-2.5 py-2 text-[12px] text-ds-ink hover:bg-ds-hover">
                    <input
                      type="checkbox"
                      checked={selected.has(source.id)}
                      onChange={(event) => setSelected((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(source.id)
                        else next.delete(source.id)
                        return next
                      })}
                    />
                    <span className="truncate" title={source.id}>{source.name}</span>
                  </label>
                ))}
              </div>
              {sources.length === 0 ? <span className="text-[11.5px] text-red-600">{t('workflowDatasetNoSources')}</span> : null}
            </fieldset>
          </div>

          <div className="flex flex-col gap-4">
            <TextArea label={t('workflowDatasetCriteria')} value={criteria} onChange={setCriteria} rows={5} />
            <div className="grid grid-cols-2 gap-3">
              <NumberField label={t('workflowDatasetTargetCount')} value={targetCount} onChange={setTargetCount} />
              <NumberField label={t('workflowDatasetMaxIterations')} value={maxIterations} onChange={setMaxIterations} />
            </div>
            <TextField label={t('workflowDatasetOutputName')} value={datasetName} onChange={setDatasetName} />
            <div className="grid grid-cols-[1fr_110px] gap-3">
              <TextField label={t('workflowDatasetFileName')} value={fileName} onChange={setFileName} />
              <label className="flex flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                {t('workflowDatasetFormat')}
                <select className={FIELD_CLASS} value={format} onChange={(event) => setFormat(event.target.value as typeof format)}>
                  {['jsonl', 'json', 'csv', 'tsv'].map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-[12.5px] text-ds-ink">
              <input type="checkbox" checked={humanReview} onChange={(event) => setHumanReview(event.target.checked)} />
              {t('workflowDatasetHumanReview')}
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-ds-ink">
              <input type="checkbox" checked={run} onChange={(event) => setRun(event.target.checked)} />
              {t('workflowDatasetRunNow')}
            </label>
            {maxIterations < targetCount ? <span className="text-[11.5px] text-red-600">{t('workflowDatasetIterationError')}</span> : null}
            {error ? <div className="rounded-md bg-red-500/10 px-3 py-2 text-[12px] text-red-700">{error}</div> : null}
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-ds-border px-5 py-3.5">
          <button type="button" onClick={onClose} className="rounded-md border border-ds-border px-4 py-2 text-[13px] font-medium text-ds-muted hover:bg-ds-hover">{t('cancel')}</button>
          <button
            type="button"
            disabled={invalid || submitting}
            onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-md bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Play className="h-4 w-4" />
            {submitting ? t('workflowDatasetCreating') : t('workflowDatasetCreate')}
          </button>
        </footer>
      </div>
    </div>
  )
}

const FIELD_CLASS = 'w-full rounded-md border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25'

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): ReactElement {
  return <label className="flex flex-col gap-1.5 text-[12px] font-medium text-ds-muted">{label}<input className={FIELD_CLASS} value={value} onChange={(event) => onChange(event.target.value)} /></label>
}

function TextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (value: string) => void; rows: number }): ReactElement {
  return <label className="flex flex-col gap-1.5 text-[12px] font-medium text-ds-muted">{label}<textarea rows={rows} className={`${FIELD_CLASS} resize-y font-sans leading-5`} value={value} onChange={(event) => onChange(event.target.value)} /></label>
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }): ReactElement {
  return <label className="flex flex-col gap-1.5 text-[12px] font-medium text-ds-muted">{label}<input type="number" min={1} max={100} className={FIELD_CLASS} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>
}
