/** Pure renderer style mapping extracted from the existing visual style adapter. */
import type { FigureStyleSpec, MatplotlibStyleAdapter } from './types.js'

export function buildMatplotlibStyleAdapterFromFigureStyleSpec(
  styleSpec: FigureStyleSpec
): MatplotlibStyleAdapter {
  return {
    rcParams: {
        'figure.facecolor': styleSpec.canvas.background,
        'axes.facecolor': styleSpec.canvas.background,
        'axes.edgecolor': styleSpec.palette.ink,
        'axes.linewidth': Math.max(0.6, Number((styleSpec.marks.lineWidth * 0.9).toFixed(2))),
        'axes.axisbelow': true,
        'axes.grid': styleSpec.axes.grid,
        'grid.color': styleSpec.axes.gridColor,
        'grid.alpha': styleSpec.axes.gridAlpha,
        'grid.linewidth': styleSpec.axes.gridLineWidth,
        'grid.linestyle': '-',
        'axes.spines.left': styleSpec.axes.spine !== 'none',
        'axes.spines.bottom': styleSpec.axes.spine !== 'none',
        'axes.spines.top': styleSpec.axes.spine === 'box',
        'axes.spines.right': styleSpec.axes.spine === 'box',
        'font.family': styleSpec.typography.fontFamily,
        'font.size': styleSpec.typography.labelSize,
        'text.color': styleSpec.palette.ink,
        'axes.labelcolor': styleSpec.palette.ink,
        'axes.labelsize': styleSpec.typography.labelSize,
        'axes.titlesize': styleSpec.typography.titleSize,
        'xtick.color': styleSpec.palette.ink,
        'ytick.color': styleSpec.palette.ink,
        'xtick.labelsize': styleSpec.typography.axisSize,
        'ytick.labelsize': styleSpec.typography.axisSize,
        'xtick.direction': tickDirectionForMatplotlib(styleSpec.axes.tickDirection),
        'ytick.direction': tickDirectionForMatplotlib(styleSpec.axes.tickDirection),
        'xtick.major.width': tickWidthForStyle(styleSpec),
        'ytick.major.width': tickWidthForStyle(styleSpec),
        'xtick.major.size': tickSizeForStyle(styleSpec),
        'ytick.major.size': tickSizeForStyle(styleSpec),
        'lines.linewidth': styleSpec.marks.lineWidth,
        'lines.markersize': styleSpec.marks.markerSize,
        'errorbar.capsize': errorbarCapsizeForStyle(styleSpec),
        'legend.frameon': styleSpec.annotations.legend === 'boxed',
        'legend.fontsize': styleSpec.typography.axisSize,
        'legend.facecolor': styleSpec.canvas.background,
        'legend.edgecolor': styleSpec.palette.ink,
        'savefig.dpi': styleSpec.export.dpi,
        'savefig.facecolor': styleSpec.canvas.background,
        'savefig.transparent': styleSpec.export.transparent
    },
    palette: styleSpec.palette.accent.length > 0 ? styleSpec.palette.accent : styleSpec.palette.colors,
    layoutNotes: [
        `Use ${styleSpec.layout.panelGrid} panel layout unless the target data requires a different grid.`,
        `Approximate margins as left=${styleSpec.layout.margin.left}, right=${styleSpec.layout.margin.right}, top=${styleSpec.layout.margin.top}, bottom=${styleSpec.layout.margin.bottom}.`,
        `Use ${styleSpec.axes.spine} axes and ${styleSpec.layout.gutter} gutters.`
    ]
  }
}

function tickDirectionForMatplotlib(direction: FigureStyleSpec['axes']['tickDirection']): string {
  if (direction === 'in') return 'in'
  return 'out'
}

function tickWidthForStyle(styleSpec: FigureStyleSpec): number {
  if (styleSpec.axes.tickDirection === 'none') return 0
  return Number(Math.min(0.9, Math.max(0.45, styleSpec.marks.lineWidth * 0.65)).toFixed(2))
}

function tickSizeForStyle(styleSpec: FigureStyleSpec): number {
  if (styleSpec.axes.tickDirection === 'none') return 0
  return styleSpec.axes.spine === 'box' ? 3 : 2.5
}

function errorbarCapsizeForStyle(styleSpec: FigureStyleSpec): number {
  if (styleSpec.marks.errorBarStyle === 'none') return 0
  return Number(Math.min(2.8, Math.max(1.6, styleSpec.marks.markerSize * 0.7)).toFixed(1))
}
