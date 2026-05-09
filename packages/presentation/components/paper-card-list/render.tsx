import React from 'react';
import type { UIComponentRendererProps, UIComponentRuntimeArtifact } from '@sciforge-ui/runtime-contract';

type PaperEvidenceLevel = 'meta' | 'rct' | 'cohort' | 'case' | 'experimental' | 'review' | 'database' | 'preprint' | 'prediction';

export type PaperCardPresentation = {
  title: string;
  source: string;
  year: string;
  url?: string;
  evidenceLevel: PaperEvidenceLevel;
};

const paperEvidenceLevels: PaperEvidenceLevel[] = ['meta', 'rct', 'cohort', 'case', 'experimental', 'review', 'database', 'preprint', 'prediction'];

const evidenceLabels: Record<PaperEvidenceLevel, string> = {
  meta: 'Meta分析',
  rct: 'RCT/临床',
  cohort: '队列研究',
  case: '案例报告',
  experimental: '实验验证',
  review: '综述',
  database: '数据库',
  preprint: '预印本',
  prediction: '计算预测',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function recordsFromPaperArtifact(props: UIComponentRendererProps): Record<string, unknown>[] {
  const payload = props.artifact?.data ?? props.slot.props;
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  for (const key of ['papers', 'rows']) {
    const rows = payload[key];
    if (Array.isArray(rows)) return rows.filter(isRecord);
  }
  return [];
}

function compareValue(left: unknown, op: string, right: unknown) {
  const leftNumber = typeof left === 'number' ? left : typeof left === 'string' ? Number(left) : Number.NaN;
  const rightNumber = typeof right === 'number' ? right : typeof right === 'string' ? Number(right) : Number.NaN;
  if (op === '<=' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber <= rightNumber;
  if (op === '>=' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber >= rightNumber;
  if (op === '<' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber < rightNumber;
  if (op === '>' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber > rightNumber;
  if (op === '!=' || op === '!==') return String(left ?? '') !== String(right ?? '');
  return String(left ?? '') === String(right ?? '');
}

function applyPaperCardTransforms(rows: Record<string, unknown>[], props: UIComponentRendererProps) {
  return (props.slot.transform ?? []).reduce((current, transform) => {
    if (transform.type === 'filter' && transform.field) return current.filter((row) => compareValue(row[transform.field ?? ''], transform.op ?? '==', transform.value));
    if (transform.type === 'sort' && transform.field) return [...current].sort((left, right) => String(left[transform.field ?? ''] ?? '').localeCompare(String(right[transform.field ?? ''] ?? '')));
    if (transform.type === 'limit') {
      const limit = typeof transform.value === 'number' ? transform.value : Number(transform.value);
      return Number.isFinite(limit) && limit >= 0 ? current.slice(0, limit) : current;
    }
    return current;
  }, rows);
}

function pickPaperEvidenceLevel(value: unknown): PaperEvidenceLevel {
  return paperEvidenceLevels.includes(value as PaperEvidenceLevel) ? value as PaperEvidenceLevel : 'prediction';
}

export function paperCardListPresentationPolicy(props: UIComponentRendererProps): PaperCardPresentation[] {
  return applyPaperCardTransforms(recordsFromPaperArtifact(props), props).map((record, index) => ({
    title: asString(record.title) || asString(record.name) || `Paper ${index + 1}`,
    source: asString(record.source) || asString(record.journal) || asString(record.venue) || 'unknown source',
    year: asString(record.year) || String(asNumber(record.year) ?? 'unknown'),
    url: asString(record.url),
    evidenceLevel: pickPaperEvidenceLevel(record.evidenceLevel),
  }));
}

function paperListEmptyDetail(artifact?: UIComponentRuntimeArtifact) {
  return artifact ? '当前 paper-list artifact 缺少 papers/rows 数组；请检查字段映射或修复 skill 输出。' : undefined;
}

function viewCompositionSummary(props: UIComponentRendererProps) {
  const encoding = props.slot.encoding ?? {};
  const parts = [
    encoding.colorBy ? `colorBy=${encoding.colorBy}` : undefined,
    encoding.splitBy ? `splitBy=${encoding.splitBy}` : undefined,
    encoding.overlayBy ? `overlayBy=${encoding.overlayBy}` : undefined,
    encoding.facetBy ? `facetBy=${encoding.facetBy}` : undefined,
    encoding.syncViewport ? 'syncViewport=true' : undefined,
    props.slot.layout?.mode ? `layout=${props.slot.layout.mode}` : undefined,
    props.slot.compare?.mode ? `compare=${props.slot.compare.mode}` : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function renderPaperCardList(props: UIComponentRendererProps) {
  const papers = paperCardListPresentationPolicy(props);
  const ArtifactSourceBar = props.helpers?.ArtifactSourceBar;
  const ComponentEmptyState = props.helpers?.ComponentEmptyState;
  if (!props.artifact || !papers.length) {
    return ComponentEmptyState
      ? <ComponentEmptyState componentId="paper-card-list" artifactType="paper-list" detail={paperListEmptyDetail(props.artifact)} />
      : <p>No papers available.</p>;
  }
  const compositionSummary = viewCompositionSummary(props);
  return (
    <div className="stack" data-component-id="paper-card-list">
      {ArtifactSourceBar ? <ArtifactSourceBar artifact={props.artifact} session={props.session} /> : null}
      {compositionSummary ? <div className="composition-strip"><code>{compositionSummary}</code></div> : null}
      <div className="paper-list">
        {papers.map((paper) => (
          <div key={`${paper.title}-${paper.source}`} className="card paper-card">
            <div>
              <h3>{paper.url ? <a href={paper.url} target="_blank" rel="noreferrer">{paper.title}</a> : paper.title}</h3>
              <p>{paper.source} · {paper.year}</p>
            </div>
            <span className={`evidence-tag evidence-tag-${paper.evidenceLevel}`}>{evidenceLabels[paper.evidenceLevel]}</span>
            <span className="badge badge-success">runtime</span>
          </div>
        ))}
      </div>
    </div>
  );
}
