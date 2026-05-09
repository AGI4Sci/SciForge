export interface StructureSummaryMetricRow {
  label: string;
  value: string;
  color: string;
}

export interface StructureSummaryMetricPresentation {
  rows: StructureSummaryMetricRow[];
  emptyState?: {
    title: string;
    detail: string;
  };
}

export function structureSummaryMetricPresentation(metrics: Record<string, unknown> = {}): StructureSummaryMetricPresentation {
  const rows = [
    metricRow('Pocket volume', asString(metrics.pocketVolume) || formatNumberWithUnit(metrics.pocketVolume, 'A3'), '#00E5A0'),
    metricRow('pLDDT mean', asString(metrics.pLDDT) || asString(metrics.plddt) || formatNumber(metrics.pLDDT) || formatNumber(metrics.plddt), '#4ECDC4'),
    metricRow('Resolution', asString(metrics.resolution) || formatNumberWithUnit(metrics.resolution, 'A'), '#FFD54F'),
    metricRow('Mutation risk', asString(metrics.mutationRisk), '#FF7043'),
    metricRow('Method', asString(metrics.method), '#B0C4D8'),
  ].filter((row): row is StructureSummaryMetricRow => Boolean(row));

  return rows.length
    ? { rows }
    : {
      rows,
      emptyState: {
        title: '没有结构指标',
        detail: 'structure-summary 未提供 metrics；UI 不再填充默认分辨率或 pLDDT。',
      },
    };
}

function metricRow(label: string, value: string | undefined, color: string): StructureSummaryMetricRow | undefined {
  return value && value.trim() ? { label, value, color } : undefined;
}

function formatNumber(value: unknown): string | undefined {
  const numeric = asNumber(value);
  return numeric === undefined ? undefined : numeric.toString();
}

function formatNumberWithUnit(value: unknown, unit: string): string | undefined {
  const numeric = asNumber(value);
  return numeric === undefined ? undefined : `${numeric} ${unit}`;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
