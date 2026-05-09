import type { ClaimType, EvidenceLevel } from '../data';
import { Badge, EmptyState } from '@agi4sci/design-system';

export {
  ActionButton,
  Badge,
  Button,
  Card,
  Details,
  EmptyState,
  IconButton,
  Input,
  Panel,
  SectionHeader,
  Select,
  TabBar,
  cssVar,
  cx,
  semanticTokens,
  themeClassNames,
} from '@agi4sci/design-system';
export type { BadgeVariant, ButtonVariant, SemanticToken, ThemeName } from '@agi4sci/design-system';

export function ChartLoadingFallback({ label }: { label: string }) {
  return (
    <div className="empty-runtime-state compact chart-loading-state">
      <Badge variant="muted">loading</Badge>
      <strong>{label}</strong>
    </div>
  );
}

export function EvidenceTag({ level }: { level: EvidenceLevel }) {
  const labels: Record<EvidenceLevel, string> = {
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
  const variant: Record<EvidenceLevel, 'success' | 'info' | 'warning' | 'coral' | 'muted'> = {
    meta: 'success',
    rct: 'info',
    cohort: 'warning',
    case: 'coral',
    experimental: 'success',
    review: 'info',
    database: 'muted',
    preprint: 'warning',
    prediction: 'muted',
  };
  return <Badge variant={variant[level]}>{labels[level]}</Badge>;
}

export function ClaimTag({ type }: { type: ClaimType }) {
  const labels: Record<ClaimType, string> = { fact: '事实', inference: '推断', hypothesis: '假设' };
  const variant: Record<ClaimType, 'success' | 'warning' | 'coral'> = {
    fact: 'success',
    inference: 'warning',
    hypothesis: 'coral',
  };
  return <Badge variant={variant[type]}>{labels[type]}</Badge>;
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 90 ? '#00E5A0' : pct >= 75 ? '#FFD54F' : '#FF7043';
  return (
    <div className="confidence">
      <div className="confidence-track">
        <div className="confidence-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span style={{ color }}>{pct}%</span>
    </div>
  );
}

export function EmptyArtifactState({ title, detail, recoverActions }: { title: string; detail: string; recoverActions?: string[] }) {
  const actions = recoverActions?.length ? recoverActions : ['run-current-scenario', 'import-matching-package', 'inspect-artifact-schema'];
  return (
    <EmptyState label="empty" title={title} detail={detail}>
      <details className="empty-recover-details">
        <summary>可尝试的恢复动作</summary>
        <div className="empty-recover-actions" aria-label="恢复动作">
          {actions.map((action) => (
            <span key={action}>{recoverActionLabel(action)}</span>
          ))}
        </div>
      </details>
    </EmptyState>
  );
}

export function recoverActionLabel(action: string) {
  const labels: Record<string, string> = {
    'run-current-scenario': '运行当前场景',
    'rerun-current-scenario': '重试当前运行',
    'import-matching-package': '导入匹配 package',
    'inspect-artifact-schema': '检查 artifact schema',
    'inspect-artifact': '打开 Artifact Inspector',
    'inspect-ui-manifest': '检查 UIManifest',
    'inspect-claims': '检查 claims',
    'inspect-runtime-route': '查看 runtime route',
    'export-diagnostics': '导出诊断包',
    'repair-ui-plan': '修复 UIPlan',
    'create-timeline-event': '创建 timeline event',
    'import-research-bundle': '导入研究 bundle',
  };
  if (labels[action]) return labels[action];
  if (action.startsWith('run-skill:')) return `运行 skill ${action.slice('run-skill:'.length)}`;
  if (action.startsWith('inspect-artifact-schema:')) return `检查 ${action.slice('inspect-artifact-schema:'.length)} schema`;
  if (action.startsWith('import-package:')) return `导入 ${action.slice('import-package:'.length)} package`;
  if (action.startsWith('add-field:')) return `补齐字段 ${action.slice('add-field:'.length)}`;
  if (action.startsWith('add-fields:')) return `补齐字段 ${action.slice('add-fields:'.length)}`;
  if (action.startsWith('map-fields:')) return `映射字段 ${action.slice('map-fields:'.length)}`;
  if (action.startsWith('map-array-field:')) return `映射数组字段 ${action.slice('map-array-field:'.length)}`;
  if (action.startsWith('repair-task:')) return `修复任务 ${action.slice('repair-task:'.length)}`;
  return action;
}
