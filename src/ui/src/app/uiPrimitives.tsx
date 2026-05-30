import type { ClaimType, EvidenceLevel } from '../data';
import { Badge, EmptyState } from '@agi4sci/design-system';
import { claimTypeDisplay, evidenceLevelDisplay } from '@sciforge/scenario-core/scenario-demo-data';
import {
  DEFAULT_EMPTY_ARTIFACT_RECOVER_ACTIONS,
  runtimeRecoverActionLabel,
} from '@sciforge-ui/runtime-contract/events';

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
  const display = evidenceLevelDisplay(level);
  return <Badge variant={display.variant}>{display.label}</Badge>;
}

export function ClaimTag({ type }: { type: ClaimType }) {
  const display = claimTypeDisplay(type);
  return <Badge variant={display.variant}>{display.label}</Badge>;
}

export function ConfidenceBar({ value }: { value: number }) {
  const safeValue = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const pct = Math.round(safeValue * 100);
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
  const actions = recoverActions === undefined ? [...DEFAULT_EMPTY_ARTIFACT_RECOVER_ACTIONS] : recoverActions;
  return (
    <EmptyState label="Waiting" title={title} detail={detail}>
      {actions.length ? (
        <details className="empty-recover-details">
          <summary>Possible recovery actions</summary>
          <div className="empty-recover-actions" aria-label="Recovery actions">
            {actions.map((action) => (
              <span key={action}>{recoverActionLabel(action)}</span>
            ))}
          </div>
        </details>
      ) : null}
    </EmptyState>
  );
}

export function recoverActionLabel(action: string) {
  return runtimeRecoverActionLabel(action);
}
