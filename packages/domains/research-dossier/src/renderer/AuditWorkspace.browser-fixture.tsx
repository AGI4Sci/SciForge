/** Browser QA entry. Synthetic read-only owner data; imports production components.
 * Render inside the app's normal i18n/theme provider at 320, 480 and 900px.
 * This fixture is not registered as a contribution or shipped as a user surface.
 */
import React, { useMemo } from 'react'
import type { DomainRendererContribution, DomainRendererHost } from '@sciforge/domain-sdk/host'
import type { ArtifactVersionListV2 } from '@sciforge/domain-artifact-versions/contract'
import { createEvidenceDagRightPanelContribution } from '@sciforge/domain-evidence-dag/renderer'
import { createResearchDossierActivation, RESEARCH_DOSSIER_RIGHT_PANEL_CONTRIBUTION_ID } from '../contract.js'
import { ResearchWorkspacePanel } from './ResearchWorkspacePanel.js'
import { createResearchDossierCapabilityClient } from './research-dossier-capability-client.js'

export type AuditBrowserScenario = 'browse' | 'current' | 'historical' | 'empty' | 'partial'
export function AuditWorkspaceBrowserFixture({ scenario = 'browse' }: { scenario?: AuditBrowserScenario }) {
  const fixture = useMemo(() => {
    const contents = [{"text": "初步观察到组间差异。独立对照尚未核查，这份结果仅供进一步讨论。", "digest": "2434ca627895a7ab9ca861ba13ddded33fe4950757e3800a306457c85639ac11", "bytes": 93, "data": "5Yid5q2l6KeC5a+f5Yiw57uE6Ze05beu5byC44CC54us56uL5a+554Wn5bCa5pyq5qC45p+l77yM6L+Z5Lu957uT5p6c5LuF5L6b6L+b5LiA5q2l6K6o6K6644CC"}, {"text": "补充样本排除条件后，组间仍观察到差异。独立对照没有出现同样变化，目前不足以作因果判断。", "digest": "a181d64dd7daf86022e2b53bd9ef248bb40660f8ed3e0399c76fd3e344710a96", "bytes": 129, "data": "6KGl5YWF5qC35pys5o6S6Zmk5p2h5Lu25ZCO77yM57uE6Ze05LuN6KeC5a+f5Yiw5beu5byC44CC54us56uL5a+554Wn5rKh5pyJ5Ye6546w5ZCM5qC35Y+Y5YyW77yM55uu5YmN5LiN6Laz5Lul5L2c5Zug5p6c5Yik5pat44CC"}]
    const items: ArtifactVersionListV2['items'] = [1, 2].map(index => {
      const versionId = `artifact-version:fixture:${index}`, artifactId = 'artifact:fixture:comparison'
      const accessPolicy = { visibility: 'workspace' as const, principals: [], allowExport: false }
      const contentDigest = contents[index-1].digest, createdAt = `2026-11-0${index}T09:00:00.000Z`
      return { artifact: { artifactId, kind: 'research-output', label: '条件 A 与对照组比较', createdAt, updatedAt: createdAt, currentVersionId: 'artifact-version:fixture:2', versionCount: 2 },
        version: { schemaVersion: 1, artifactId, versionId, sequence: index, transactionId: `artifact-commit:fixture:${index}`, createdAt, intent: 'save', ...(index === 2 ? {parentVersionId:'artifact-version:fixture:1'} : {}), storage: { mode: 'snapshot', contentDigest, byteLength: contents[index-1].bytes }, accessPolicy, dependencies: [], metadata: { executionOutcome:'succeeded', replicationStatus:'not-run', controlLevel:'unknown', causality: 'host-authenticated-executor-write', runtimeId: 'codex', threadId: 'audit-fixture', changeReason: index === 1 ? '首次保存比较结果' : '补充对照条件与误差说明' } },
        ref: { artifactId, versionId, contentDigest, byteLength: contents[index-1].bytes, mediaType:'text/plain',retention: 'snapshot', availability: 'available', accessPolicy }, artifactOrdinal: index, isCurrent: index === 2 }
    })
    const host = { capabilityInvoker: { invoke: async (contract: { actionId: string; effect: string }, input: { kind?: string; versionId?: string; nodeId?: string; subject?: unknown; artifactVersionRef?: unknown; fromVersionId?: string; toVersionId?: string }) => {
      if (contract.effect !== 'read') throw new Error('测试夹具只允许读取；未执行写入。')
      if (contract.actionId === 'artifact-versions.list-v2') return scenario === 'partial' && input.kind === 'research-checkpoint'
        ? { ok: false, issue: { code: 'owner-unavailable', message: '部分研究材料暂时无法读取', retryable: true } }
        : { ok: true, value: { items: scenario === 'empty' || input.kind === 'research-checkpoint' ? [] : items } }
      if (contract.actionId === 'artifact-versions.read') {const item=items.find(item=>item.ref.versionId===input.versionId)!;return {ok:true,value:{artifact:item.artifact,version:item.version,ref:item.ref,dataBase64:contents[items.indexOf(item)].data}}}
      if (contract.actionId === 'artifact-versions.describe-v2') return { ok: true, value: items.find(item => item.ref.versionId === input.versionId)! }
      if (contract.actionId === 'research-checkpoints.status') return { ok: false, issue: { code: 'owner-unavailable', message: '测试夹具没有记录写入能力', retryable: false } }
      if (contract.actionId === 'evidence-dag.audit-query') return {subject:input.subject,source:'evidence-dag',freshness:'fresh',completeness:{complete:true,gapCodes:[]},records:[],reviewDecisions:{status:'available',records:[],reasons:[]}}
      if (contract.actionId === 'evidence-dag.view') return {url:null,threadId:'codex:audit-fixture',status:{committed:null,pending:null,updatedAt:'2026-11-10T00:00:00Z'},binding:{status:'missing',reason:'material-snapshot-missing'}}
      if (contract.actionId === 'artifact-versions.compare') return {ok:true,value:{from:items.find(item=>item.ref.versionId===input.fromVersionId)!.ref,to:items.find(item=>item.ref.versionId===input.toVersionId)!.ref,sameContent:false,byteLengthDelta:0,metadataChanged:true,mediaTypeChanged:false,addedDependencies:[],removedDependencies:[],textPreview:{from:'初步观察到组间差异，尚未核对独立对照。',to:'补充样本条件后仍存在差异，因果解释仍需独立对照。',truncated:false}}}
      if (contract.actionId === 'evidence-dag.record.view') {
        const source={id:'fixture-source',parentId:'root',kind:'round',title:'样本条件与观测变化',summary:'当前比较观察到组间差异，独立对照仍需核查。',origin:'model',status:'completed',createdAt:'2026-11-10T00:00:00Z',updatedAt:'2026-11-10T00:00:00Z',concernCounts:{negative:1,open:1}}
        const node=input.nodeId && input.nodeId!=='root' ? source : null
        const children=scenario==='empty'||node?[]:[source,{...source,id:'fixture-negative',title:'独立对照的限制',summary:'现有对照未观察到同样的变化，不能据此得出因果结论。',status:'failed'}]
        return {revision:1,node,ancestors:[],children,latestRecordPath:['root'],totalChildren:children.length,messages:[],paused:false,model:'',pending:0,failures:scenario==='partial'?[{nodeId:'root',message:'一份来源暂时不可读；上次结果仍保留。',at:'2026-11-10T00:00:00Z'}]:[],coverage:'visible-session-snapshots',lastScanAt:null}
      }
      throw new Error('测试数据未提供此范围的依据。')
    } } } as unknown as DomainRendererHost
    const value = createEvidenceDagRightPanelContribution(host, undefined, RESEARCH_DOSSIER_RIGHT_PANEL_CONTRIBUTION_ID)
    const researchViews = [{ id: 'fixture.public-evidence-workspace', kind: 'renderer.extension', packageName: '@fixture/evidence', owner: { moduleId: 'fixture', moduleVersion: '1.0.0' }, contract: { location: 'research.workspace' }, value }] as readonly DomainRendererContribution[]
    const client = createResearchDossierCapabilityClient(host.capabilityInvoker)
    return { client, researchViews, activation: scenario === 'historical' || scenario === 'current' ? createResearchDossierActivation({kind:'artifact-version',versionId:items[scenario==='historical'?0:1].ref.versionId},{page:scenario==='historical'?'versions':'overview',expectedDigest:`sha256:${items[scenario==='historical'?0:1].ref.contentDigest}`}) : undefined }
  }, [scenario])
  return <div style={{ height: '100vh', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
    <p className="shrink-0 p-2 text-ds-xs">合成测试数据 · 生产组件交互验证</p>
    <div style={{ flex: 1, minHeight: 0 }}><ResearchWorkspacePanel {...fixture} session={{ id: 'audit-fixture', runtimeId: 'codex', workspaceRoot: '/audit-fixture' }} active focused surfaceId="audit-browser-fixture" onCollapse={() => undefined} /></div>
  </div>
}
