import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelRightClose } from 'lucide-react'
import { ScientificPlottingProvenancePanel } from '../renderer/ScientificPlottingProvenancePanel.js'
import { createScientificPlottingCapabilityClient } from '../renderer/scientific-plotting-capability-client.js'
import { VisualReviewPanel } from '../review-ui/VisualReviewPanel.js'
import { VisualReviewVersionHistory } from '../review-ui/VisualReviewVersionHistory.js'
import { createVisualReviewCapabilityClient } from '../review-ui/capability-client.js'
import { visualReviewDocumentInputSchema, visualReviewOpenInputSchema } from '../review/contract.js'
import { createSandboxCapabilityInvoker, type PluginUiHostInit, type PluginUiSdk } from './sdk.js'
import { activationFields, activationSnapshot, buildVisualGenerationRequest, type ScientificPlottingTab } from './unified-state.js'

export function ScientificPlottingUnifiedPanel({ sdk, initialHost }: {
  sdk: PluginUiSdk
  initialHost: PluginUiHostInit
}): ReactElement {
  const { t } = useTranslation()
  const [host, setHost] = useState(initialHost)
  const snapshot = activationSnapshot(host)
  const parsedActivation = useMemo<{ value: ReturnType<typeof activationFields>; error: string | null }>(() => {
    try {
      return { value: activationFields({ capabilityIds: [], activation: JSON.parse(snapshot) as PluginUiHostInit['activation'] }), error: null }
    } catch (error) {
      return { value: { tab: 'provenance' as const }, error: error instanceof Error ? error.message : String(error) }
    }
  }, [snapshot])
  const activation = parsedActivation.value
  const [tab, setTab] = useState<ScientificPlottingTab>(activation.tab)
  const [documentId, setDocumentId] = useState(activation.documentId ?? '')
  const [existingDocumentId, setExistingDocumentId] = useState('')
  const existingDocumentInput = visualReviewDocumentInputSchema.safeParse({ documentId: existingDocumentId.trim() })
  const [reviewReady, setReviewReady] = useState(!activation.artifact)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const invoker = useMemo(() => createSandboxCapabilityInvoker(sdk), [sdk])
  const plottingClient = useMemo(() => createScientificPlottingCapabilityClient(invoker), [invoker])
  const reviewClient = useMemo(() => createVisualReviewCapabilityClient(invoker), [invoker])
  const workbench = useMemo(() => ({ sendMessage: sdk.sendMessage }), [sdk])
  const workspace = useMemo(() => ({ pickFile: sdk.pickFile }), [sdk])

  useEffect(() => sdk.subscribeInit(setHost), [sdk])
  useEffect(() => {
    let current = true
    setTab(activation.tab)
    setDocumentId(activation.documentId ?? '')
    setReviewReady(!activation.artifact)
    setMessage(null)
    if (activation.documentId && activation.artifact && host.workspaceRoot) {
      const open = async (): Promise<void> => {
        try {
          const input = visualReviewOpenInputSchema.parse({ documentId: activation.documentId, artifact: activation.artifact })
          const result = await reviewClient.open(input, host.workspaceRoot ?? '')
          if (current) { setDocumentId(result.document.documentId); setReviewReady(true) }
        } catch (error) { if (current) setMessage(error instanceof Error ? error.message : String(error)) }
      }
      void open()
    }
    return () => { current = false }
  }, [activation, host.workspaceRoot, reviewClient])

  const openExistingReview = async (): Promise<void> => {
    if (!host.workspaceRoot) return
    setBusy(true)
    setMessage(null)
    try {
      const input = visualReviewDocumentInputSchema.parse({ documentId: existingDocumentId.trim() })
      const opened = await reviewClient.readDocument(input, host.workspaceRoot)
      setDocumentId(opened.document.documentId)
      setReviewReady(true)
      setTab('review')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const openReviewImage = async (): Promise<void> => {
    if (!host.workspaceRoot) return
    setBusy(true)
    setMessage(null)
    try {
      const picked = await sdk.pickFile({ title: t('scientificPlottingOpenReviewImage'), defaultPath: host.workspaceRoot,
        filters: [{ name: 'Images', extensions: ['avif', 'bmp', 'gif', 'png', 'jpg', 'jpeg', 'webp'] }] })
      if (picked.canceled || !picked.path) return
      const opened = await reviewClient.open({ documentId: `visual-${crypto.randomUUID()}`,
        artifact: { kind: 'image', sourcePath: picked.path } }, host.workspaceRoot)
      setDocumentId(opened.document.documentId)
      setReviewReady(true)
      setTab('review')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const generate = async (): Promise<void> => {
    if (!host.sessionId || !host.workspaceRoot || !instruction.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      const submitted = await sdk.sendMessage({ sessionId: host.sessionId,
        text: buildVisualGenerationRequest({ instruction, sessionId: host.sessionId }), displayText: instruction.trim() })
      if (!submitted.ok) throw new Error(submitted.error.message)
      setMessage(t('scientificPlottingGenerationSubmitted'))
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  const tabs = [
    ['generate', 'scientificPlottingUnifiedGenerate'],
    ['review', 'scientificPlottingUnifiedReview'],
    ['provenance', 'scientificPlottingUnifiedProvenance']
  ] as const
  return <section className="scientific-plotting-unified" aria-label={t('rightPanelScientificPlotting')}>
    <header className="scientific-plotting-unified-header">
      <strong>{t('rightPanelScientificPlotting')}</strong>
      <button type="button" onClick={() => sdk.collapse()} aria-label={t('scientificPlottingCollapse')}><PanelRightClose size={16} /></button>
    </header>
    <div className="scientific-plotting-unified-tabs" role="tablist" aria-label={t('rightPanelScientificPlotting')}>
      {tabs.map(([id, label]) => <button key={id} id={`plot-tab-${id}`} type="button" role="tab"
        aria-selected={tab === id} aria-controls={`plot-view-${id}`} onClick={() => setTab(id)}>{t(label)}</button>)}
    </div>
    {message ? <p className="scientific-plotting-unified-message" role="status">{message}</p> : null}
    <div id="plot-view-generate" className="scientific-plotting-unified-view" role="tabpanel" aria-labelledby="plot-tab-generate" hidden={tab !== 'generate'}>
      <div className="scientific-plotting-generation-form">
        <h2>{t('scientificPlottingUnifiedGenerate')}</h2>
        <p>{t('scientificPlottingGenerationHint')}</p>
        <label htmlFor="plot-instruction">{t('scientificPlottingGenerationInstruction')}</label>
        <textarea id="plot-instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={t('scientificPlottingGenerationPlaceholder')} />
        {!host.workspaceRoot || !host.sessionId ? <p>{t('scientificPlottingGenerationNoSession')}</p> : null}
        <button type="button" disabled={busy || !instruction.trim() || !host.workspaceRoot || !host.sessionId} onClick={() => void generate()}>
          {t(busy ? 'scientificPlottingBusy' : 'scientificPlottingGenerationSubmit')}
        </button>
      </div>
    </div>
    <div id="plot-view-review" className="scientific-plotting-unified-view" role="tabpanel" aria-labelledby="plot-tab-review" hidden={tab !== 'review'}>
      <div className="scientific-plotting-review-open">
        <label htmlFor="plot-existing-document-id">{t('scientificPlottingReviewDocumentId')}</label>
        <input id="plot-existing-document-id" type="text" value={existingDocumentId}
          onChange={(event) => setExistingDocumentId(event.target.value)} />
        <button type="button" disabled={busy || !host.workspaceRoot || !existingDocumentInput.success}
          onClick={() => void openExistingReview()}>{t('scientificPlottingOpenExistingReview')}</button>
        <button type="button" disabled={busy || !host.workspaceRoot} onClick={() => void openReviewImage()}>{t('scientificPlottingOpenReviewImage')}</button>
      </div>
      {documentId && reviewReady ? <VisualReviewPanel key={`${host.workspaceRoot}:${documentId}`} documentId={documentId}
        workspaceRoot={host.workspaceRoot ?? ''} sessionId={host.sessionId ?? ''} refreshKey={activation.refreshKey}
        client={reviewClient} workbench={workbench} workspace={workspace} onCollapse={() => sdk.collapse()} />
        : <p className="scientific-plotting-generation-form">{t('scientificPlottingReviewEmpty')}</p>}
    </div>
    <div id="plot-view-provenance" className="scientific-plotting-unified-view" role="tabpanel" aria-labelledby="plot-tab-provenance" hidden={tab !== 'provenance'}>
      <VisualReviewVersionHistory client={reviewClient} workspaceRoot={host.workspaceRoot ?? ''} documentId={documentId} active={tab === 'provenance'} />
      {parsedActivation.error ? <p role="alert">{parsedActivation.error}</p> : <ScientificPlottingProvenancePanel key={`${host.workspaceRoot}:${host.sessionId}:${snapshot}`} client={plottingClient} workspaceRoot={host.workspaceRoot ?? ''} onCollapse={() => sdk.collapse()}
        preferredManifestVersionId={activation.preferredManifestVersionId} preferredFigureVersionId={activation.preferredFigureVersionId}
        preferredResourceDigest={activation.preferredResourceDigest} />}
    </div>
  </section>
}
