import { lazy, Suspense, useEffect, useState } from 'react';
import { AlertTriangle, Check, Clock, CornerUpLeft, FilePlus, FileText, Sparkles, Target } from 'lucide-react';
import { feasibilityRows, radarData, scenarios, type ClaimType, type ScenarioId } from '../data';
import { timeline } from '../demoData';
import { nowIso, type AlignmentContractRecord, type ScenarioInstanceId, type TimelineEventRecord } from '../domain';
import { exportJsonFile } from './exportUtils';
import { ActionButton, Badge, Card, ChartLoadingFallback, ClaimTag, ConfidenceBar, EmptyArtifactState, SectionHeader, cx } from './uiPrimitives';

const CapabilityRadarChart = lazy(async () => ({ default: (await import('../charts')).CapabilityRadarChart }));

export type AlignmentContractData = AlignmentContractRecord['data'];

const defaultAlignmentContract: AlignmentContractData = {
  dataReality: '内部药敏样本约 200 例，包含 GDSC/CCLE 对齐后的表达矩阵、药物响应标签和基础质控记录。',
  aiAssessment: '特征维度显著高于样本量，主模型需要正则化、先验通路约束和外部数据预训练。',
  bioReality: '窄谱靶向药低响应率是生物学现实，需要按机制拆分模型，不能简单合并为一个泛化分类器。',
  feasibilityMatrix: feasibilityRows.map((row) => `${row.dim}: status=needs-data; source=AI-draft; AI=${row.ai}; Bio=${row.bio}; Action=${row.action}`).join('\n'),
  researchGoal: '聚焦 12 种药物的敏感性预测，排除 3 种极低响应率窄谱靶向药。',
  technicalRoute: 'GDSC/CCLE 预训练 + 内部数据微调，按机制拆分模型。',
  successCriteria: 'AUROC > 0.80，假阳性率 < 20%，至少 3 个命中完成实验验证。',
  knownRisks: '批次效应、药物机制差异和验证成本可能影响项目节奏。',
  recalibrationRecord: '模型在 2 种 HDAC 抑制剂上 AUROC 仅 0.58；共识为拆分模型并补充组蛋白修饰数据。',
  dataAssetsChecklist: 'needs-data: 列出表达矩阵、药敏标签、质控报告和外部公共数据 sourceRefs。',
  sampleSizeChecklist: 'needs-data: 按药物、癌种、批次统计样本量；低于阈值不得给出确定可行判断。',
  labelQualityChecklist: 'needs-data: 标注标签来源、缺失率、不平衡比例和人工复核状态。',
  batchEffectChecklist: 'needs-data: 记录 GDSC/CCLE/内部数据批次变量、校正策略和残余风险。',
  experimentalConstraints: 'needs-data: 记录预算、周期、可用细胞系、验证读出和失败重试条件。',
  feasibilitySourceNotes: 'unknown: 每个矩阵单元必须标注 user-input / artifact-statistic / literature-evidence / AI-draft。',
};

export function AlignmentPage({
  contracts,
  onSaveContract,
}: {
  contracts: AlignmentContractRecord[];
  onSaveContract: (data: AlignmentContractData, reason: string, confirmationStatus?: AlignmentContractRecord['confirmationStatus']) => void;
}) {
  const [step, setStep] = useState(0);
  const latest = contracts[0];
  const [draft, setDraft] = useState<AlignmentContractData>(() => alignmentDraftData(latest));
  const [reason, setReason] = useState('alignment contract saved from workspace');
  const steps = ['数据摸底', '可行性评估', '方案共识', '持续校准'];
  useEffect(() => {
    setDraft(alignmentDraftData(latest));
  }, [latest?.id]);
  function updateField(field: keyof AlignmentContractData, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }
  function saveDraft(nextReason = reason, confirmationStatus: AlignmentContractRecord['confirmationStatus'] = 'needs-data') {
    onSaveContract(draft, nextReason.trim() || 'alignment contract saved from workspace', confirmationStatus);
  }
  function restore(contract: AlignmentContractRecord) {
    setDraft(alignmentDraftData(contract));
    onSaveContract(contract.data, `restore alignment contract ${contract.id}`);
  }
  return (
    <main className="page">
      <div className="page-heading">
        <h1>跨领域对齐工作台</h1>
        <p>把 AI 专家的可行性判断和生物专家的实验现实放到同一个结构化工作台里。</p>
      </div>
      <div className="artifact-source-bar alignment-status">
        <Badge variant={latest ? 'success' : 'muted'}>{latest ? 'alignment-contract' : 'draft-only'}</Badge>
        {latest ? <code>{latest.id}</code> : <code>not saved</code>}
        {latest ? <code>checksum={latest.checksum}</code> : null}
        {latest ? <code>versions={contracts.length}</code> : null}
        {latest ? <code>authority={latest.decisionAuthority || 'researcher'}</code> : null}
        {latest ? <Badge variant={latest.confirmationStatus === 'user-confirmed' ? 'success' : latest.confirmationStatus === 'needs-data' ? 'warning' : 'muted'}>{latest.confirmationStatus || 'needs-data'}</Badge> : null}
      </div>
      <div className="stepper">
        {steps.map((name, index) => (
          <button key={name} className={cx(index === step && 'active', index < step && 'done')} onClick={() => setStep(index)}>
            <span>{index < step ? <Check size={13} /> : index + 1}</span>
            {name}
          </button>
        ))}
      </div>
      {step === 0 ? (
        <AlignmentSurvey draft={draft} onChange={updateField} />
      ) : step === 1 ? (
        <Feasibility draft={draft} onChange={updateField} />
      ) : step === 2 ? (
        <ProjectContract draft={draft} onChange={updateField} reason={reason} onReasonChange={setReason} onSave={() => saveDraft()} onConfirm={() => saveDraft('researcher confirmed alignment contract', 'user-confirmed')} />
      ) : (
        <Recalibration draft={draft} onChange={updateField} contracts={contracts} onRestore={restore} onSave={() => saveDraft('alignment recalibration saved')} />
      )}
    </main>
  );
}

function alignmentDraftData(contract?: AlignmentContractRecord): AlignmentContractData {
  return { ...defaultAlignmentContract, ...(contract?.data ?? {}) };
}

function AlignmentSurvey({
  draft,
  onChange,
}: {
  draft: AlignmentContractData;
  onChange: (field: keyof AlignmentContractData, value: string) => void;
}) {
  return (
    <div className="alignment-grid">
      <Card>
        <SectionHeader icon={Sparkles} title="AI 视角" subtitle="数据能力评估" />
        <Progress label="样本量" value={20} color="#FFD54F" detail="200 / 1000 ideal" />
        <Progress label="特征维度" value={100} color="#00E5A0" detail="20K genes" />
        <Progress label="标签平衡度" value={35} color="#FF7043" detail="3 drugs < 5%" />
        <EditableBlock label="AI assessment" value={draft.aiAssessment} onChange={(value) => onChange('aiAssessment', value)} />
        <EditableBlock label="Data assets checklist" value={draft.dataAssetsChecklist} onChange={(value) => onChange('dataAssetsChecklist', value)} rows={4} />
        <EditableBlock label="Sample size checklist" value={draft.sampleSizeChecklist} onChange={(value) => onChange('sampleSizeChecklist', value)} rows={4} />
      </Card>
      <Card>
        <SectionHeader icon={Target} title="生物视角" subtitle="数据来源与实验现实" />
        <Progress label="药物覆盖" value={100} color="#00E5A0" detail="15 / 15" />
        <Progress label="组学模态" value={60} color="#FFD54F" detail="3 / 5" />
        <Progress label="批次一致性" value={60} color="#FFD54F" detail="GDSC vs CCLE" />
        <EditableBlock label="Data reality" value={draft.dataReality} onChange={(value) => onChange('dataReality', value)} />
        <EditableBlock label="Bio reality" value={draft.bioReality} onChange={(value) => onChange('bioReality', value)} />
        <EditableBlock label="Label quality checklist" value={draft.labelQualityChecklist} onChange={(value) => onChange('labelQualityChecklist', value)} rows={4} />
        <EditableBlock label="Batch effect checklist" value={draft.batchEffectChecklist} onChange={(value) => onChange('batchEffectChecklist', value)} rows={4} />
      </Card>
    </div>
  );
}

function Progress({ label, value, color, detail }: { label: string; value: number; color: string; detail: string }) {
  return (
    <div className="progress-row">
      <div>
        <span>{label}</span>
        <em>{detail}</em>
      </div>
      <div className="progress-track">
        <i style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

function Feasibility({
  draft,
  onChange,
}: {
  draft: AlignmentContractData;
  onChange: (field: keyof AlignmentContractData, value: string) => void;
}) {
  return (
    <div className="alignment-grid">
      <Card>
        <SectionHeader icon={Target} title="可行性矩阵" />
        <div className="feasibility-list">
          {feasibilityRows.map((row) => (
            <div className="feasibility-row" key={row.dim}>
              <div className="feasibility-top">
                <strong>{row.dim}</strong>
                <Badge variant="warning">needs-data</Badge>
              </div>
              <div className="dual-view">
                <span>AI draft: {row.ai}</span>
                <span>Bio input: {row.bio}</span>
              </div>
              <div className="slot-meta">
                <code>source=AI-draft</code>
                <code>state=unknown until sourceRefs are attached</code>
              </div>
              <p>{row.action}</p>
            </div>
          ))}
        </div>
        <EditableBlock label="Editable feasibility matrix" value={draft.feasibilityMatrix} onChange={(value) => onChange('feasibilityMatrix', value)} rows={8} />
        <EditableBlock label="Feasibility source notes" value={draft.feasibilitySourceNotes} onChange={(value) => onChange('feasibilitySourceNotes', value)} rows={5} />
      </Card>
      <Card>
        <SectionHeader title="双视角能力雷达" subtitle="AI vs Bio assessment" />
        <div className="chart-300">
          <Suspense fallback={<ChartLoadingFallback label="加载能力雷达" />}>
            <CapabilityRadarChart data={radarData} />
          </Suspense>
        </div>
      </Card>
    </div>
  );
}

function ProjectContract({
  draft,
  onChange,
  reason,
  onReasonChange,
  onSave,
  onConfirm,
}: {
  draft: AlignmentContractData;
  onChange: (field: keyof AlignmentContractData, value: string) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  onSave: () => void;
  onConfirm: () => void;
}) {
  const fields: Array<[keyof AlignmentContractData, string]> = [
    ['researchGoal', '研究目标'],
    ['technicalRoute', '技术路线'],
    ['successCriteria', '成功标准'],
    ['knownRisks', '已知风险'],
    ['experimentalConstraints', '实验约束'],
  ];
  return (
    <Card>
      <SectionHeader icon={FileText} title="项目契约草案" action={<ActionButton icon={FilePlus} variant="secondary" onClick={onSave}>保存契约</ActionButton>} />
      <div className="contract-grid">
        {fields.map(([field, label]) => (
          <EditableBlock key={field} label={label} value={draft[field]} onChange={(value) => onChange(field, value)} rows={4} />
        ))}
      </div>
      <div className="alignment-save-row">
        <label>
          <span>Version reason</span>
          <input value={reason} onChange={(event) => onReasonChange(event.target.value)} />
        </label>
        <Badge variant="warning">AI draft · needs-data until researcher confirmation</Badge>
        <ActionButton icon={FilePlus} onClick={onSave}>保存 alignment-contract</ActionButton>
        <ActionButton icon={Check} variant="secondary" onClick={onConfirm}>研究者确认保存</ActionButton>
      </div>
    </Card>
  );
}

function Recalibration({
  draft,
  onChange,
  contracts,
  onRestore,
  onSave,
}: {
  draft: AlignmentContractData;
  onChange: (field: keyof AlignmentContractData, value: string) => void;
  contracts: AlignmentContractRecord[];
  onRestore: (contract: AlignmentContractRecord) => void;
  onSave: () => void;
}) {
  return (
    <div className="alignment-grid">
      <Card>
        <SectionHeader icon={AlertTriangle} title="持续校准记录" subtitle="早期发现认知漂移和模型偏差" action={<ActionButton icon={FilePlus} variant="secondary" onClick={onSave}>保存校准</ActionButton>} />
        <EditableBlock label="Recalibration record" value={draft.recalibrationRecord} onChange={(value) => onChange('recalibrationRecord', value)} rows={8} />
      </Card>
      <Card>
        <SectionHeader icon={Clock} title="版本快照" subtitle="保存、查看和恢复 alignment-contract" />
        <div className="alignment-version-list">
          {contracts.length ? contracts.map((contract) => (
            <div className="alignment-version-row" key={contract.id}>
              <div>
                <strong>{contract.title}</strong>
                <p>{new Date(contract.updatedAt).toLocaleString('zh-CN', { hour12: false })} · {contract.reason}</p>
                <code>{contract.checksum}</code>
              </div>
              <ActionButton variant="ghost" onClick={() => onRestore(contract)}>恢复</ActionButton>
            </div>
          )) : <EmptyArtifactState title="等待保存契约" detail="保存后会生成 alignment-contract artifact，并同步到 workspace .sciforge/artifacts。" />}
        </div>
      </Card>
    </div>
  );
}

function EditableBlock({
  label,
  value,
  onChange,
  rows = 5,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="editable-block">
      <span>{label}</span>
      <textarea value={value} rows={rows} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function TimelinePage({
  alignmentContracts = [],
  events = [],
  onOpenScenario,
}: {
  alignmentContracts?: AlignmentContractRecord[];
  events?: TimelineEventRecord[];
  onOpenScenario: (id: ScenarioInstanceId) => void;
}) {
  const [query, setQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const alignmentItems = alignmentContracts.map((contract) => ({
    time: new Date(contract.updatedAt).toLocaleString('zh-CN', { hour12: false }),
    scenario: 'knowledge' as ScenarioId,
    title: contract.title,
    desc: `alignment-contract ${contract.id} · ${contract.reason} · checksum ${contract.checksum}`,
    claimType: 'fact' as ClaimType,
    confidence: 1,
    action: 'alignment.contract',
    refs: contract.sourceRefs,
  }));
  const runtimeItems = events.map((event) => ({
    time: new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false }),
    scenario: event.branchId ?? 'literature-evidence-review',
    title: event.action,
    desc: `${event.subject} · artifacts=${event.artifactRefs.length} · units=${event.executionUnitRefs.length}`,
    claimType: 'fact' as ClaimType,
    confidence: event.action.includes('failed') ? 0.35 : 0.9,
    action: event.action,
    refs: [...event.artifactRefs, ...event.executionUnitRefs],
  }));
  const items = [...runtimeItems, ...alignmentItems, ...timeline.map((item) => ({ ...item, action: 'demo.timeline', refs: [] }))];
  const filtered = items.filter((item) => {
    if (actionFilter !== 'all' && item.action !== actionFilter) return false;
    if (!query.trim()) return true;
    const normalized = query.trim().toLowerCase();
    return [item.title, item.desc, item.scenario, item.action, ...(item.refs ?? [])].some((value) => String(value).toLowerCase().includes(normalized));
  });
  const actions = ['all', ...Array.from(new Set(items.map((item) => item.action)))];
  function exportFilteredBranch() {
    exportJsonFile(`sciforge-timeline-${actionFilter}-${new Date().toISOString().slice(0, 10)}.json`, {
      schemaVersion: '1',
      exportedAt: nowIso(),
      query,
      actionFilter,
      eventCount: filtered.length,
      events: filtered,
    });
  }
  return (
    <main className="page">
      <div className="page-heading">
        <h1>研究时间线</h1>
        <p>聊天、工具、证据和执行单元最终都沉淀为可审计的研究记录。</p>
      </div>
      <div className="library-controls">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 run、artifact、package、scenario..." aria-label="搜索 Timeline" />
        <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} aria-label="按事件类型过滤">
          {actions.map((action) => <option key={action} value={action}>{action === 'all' ? '全部事件' : action}</option>)}
        </select>
        <button type="button" onClick={exportFilteredBranch}>导出当前分支</button>
      </div>
      <div className="timeline-list">
        {filtered.map((item) => {
          const scenario = scenarios.find((entry) => entry.id === item.scenario) ?? scenarios[0];
          return (
            <Card className="timeline-card" key={`${item.time}-${item.title}`}>
              <div className="timeline-dot" style={{ background: scenario.color }} />
              <div>
                <div className="timeline-meta">
                  <span>{item.time}</span>
                  <Badge variant="info">{scenario.name}</Badge>
                  <ClaimTag type={item.claimType} />
                  <ConfidenceBar value={item.confidence} />
                </div>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
                <div className="scenario-builder-actions timeline-card-actions">
                  <ActionButton type="button" icon={CornerUpLeft} variant="secondary" onClick={() => onOpenScenario(item.scenario)}>
                    回到场景
                  </ActionButton>
                  {item.refs?.slice(0, 3).map((ref) => <code key={ref}>{ref}</code>)}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {!filtered.length ? <EmptyArtifactState title="没有匹配的时间线事件" detail="运行任务、发布 package、handoff artifact 或保存契约后，会在这里形成可过滤记录。" /> : null}
    </main>
  );
}
