#!/usr/bin/env python3
"""
Cross-Scale Cell Atlas Pipeline — Publication-quality diagram.
Figure 6 for SciForge paper.  Render at 300 DPI, 0.95 textwidth.
Layout: central pipeline P0–P7, right-side biology stack L0–L5,
         gate validation markers, Evidence DAG, infrastructure row.
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch
from matplotlib.path import Path
import matplotlib.patheffects as pe
import numpy as np

FIGSIZE = (8.0, 6.0)
DPI = 300
OUTPUT = '/Applications/workspace/ailab/research/app/DeepSeek-GUI/paper/figures/cross-scale-pipeline.png'

# ═══════════════════════════════════════════
#  Publication Colour Palette
# ═══════════════════════════════════════════
BG              = '#FAFBFC'
C_BLUE          = '#2B6CB0'   # Pipeline phases
C_BLUE_LIGHT    = '#EBF4FB'
C_GREEN         = '#2D8A6E'   # Biology stack
C_GREEN_LIGHT   = '#E8F5EF'
C_PURPLE        = '#6B46C1'   # DAG & Orchestrator
C_PURPLE_LIGHT  = '#F3EEFF'
C_RED           = '#C53030'   # Gate validation
C_RED_LIGHT     = '#FFF5F5'
C_GRAY          = '#4A5568'   # Infrastructure text
C_GRAY_LIGHT    = '#EDF2F7'
C_TEXT          = '#1A202C'
C_SUBTLE        = '#718096'
C_LINE          = '#A0AEC0'
C_TITLE         = '#0D1B2A'

# ═══════════════════════════════════════════
#  Drawing helpers
# ═══════════════════════════════════════════

def rounded_box(ax, x, y, w, h, color, title='', desc='',
                bg='white', title_sz=9, desc_sz=7, corner=4,
                edge_alpha=1.0, shadow=True):
    """Draw a rounded-corner box with title + description."""
    if shadow:
        shadow_patch = FancyBboxPatch(
            (x + 0.015, y - 0.015), w, h,
            boxstyle=f'round,pad=0.04,rounding_size={corner}',
            fc='#E2E8F0', ec='none', zorder=0, alpha=0.5)
        ax.add_patch(shadow_patch)

    patch = FancyBboxPatch(
        (x, y), w, h,
        boxstyle=f'round,pad=0.04,rounding_size={corner}',
        fc=bg, ec=color, lw=2.0, zorder=1, alpha=edge_alpha)
    ax.add_patch(patch)

    # Title bar
    title_h = h * 0.36
    title_patch = FancyBboxPatch(
        (x + 0.02, y + h - title_h - 0.01), w - 0.04, title_h,
        boxstyle=f'round,pad=0.02,rounding_size={corner}',
        fc=color, ec='none', zorder=2, alpha=0.95)
    ax.add_patch(title_patch)

    ax.text(x + w/2, y + h - title_h/2 - 0.01, title,
            ha='center', va='center', fontsize=title_sz,
            fontweight='bold', color='white', zorder=3)

    if desc:
        ax.text(x + w/2, y + (h - title_h)/2 - 0.02, desc,
                ha='center', va='center', fontsize=desc_sz,
                color=C_TEXT, zorder=3, linespacing=1.3)


def arrow(ax, x1, y1, x2, y2, color=C_LINE, lw=1.8, style='-'):
    """Draw arrow from (x1,y1) to (x2,y2)."""
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle='->', color=color,
                                lw=lw, ls=style,
                                connectionstyle='arc3,rad=0'),
                zorder=0)


def heading(ax, x, y, text, sz=11, color=C_SUBTLE):
    """Section heading."""
    ax.text(x, y, text.upper(), ha='left', va='center',
            fontsize=sz, fontweight='bold', color=color,
            zorder=10, fontfamily='sans-serif')


def gate_badge(ax, x, y, label, color=C_RED):
    """Small gate validation badge (diamond-ish shape)."""
    w, h = 0.72, 0.24
    patch = FancyBboxPatch((x - w/2, y - h/2), w, h,
                           boxstyle='round,pad=0.03,rounding_size=3',
                           fc=color, ec='white', lw=1.2, zorder=8)
    ax.add_patch(patch)
    ax.text(x, y, label, ha='center', va='center',
            fontsize=5.5, fontweight='bold', color='white', zorder=9)


# ═══════════════════════════════════════════
#  Figure Setup
# ═══════════════════════════════════════════
fig, ax = plt.subplots(figsize=FIGSIZE, facecolor=BG)
ax.set_xlim(0, 8.0)
ax.set_ylim(0, 6.0)
ax.set_aspect('equal')
ax.axis('off')
ax.set_facecolor(BG)

# ═══════════════════════════════════════════
#  Title
# ═══════════════════════════════════════════
ax.text(4.0, 5.78, 'Cross-Scale Cell Atlas Pipeline',
        ha='center', va='center', fontsize=14, fontweight='bold',
        color=C_TITLE, zorder=10, fontfamily='sans-serif')
ax.text(4.0, 5.48, 'Multi-layer integration from CRISPR perturbation to cancer dependency',
        ha='center', va='center', fontsize=8.5, color=C_SUBTLE, zorder=10,
        fontfamily='sans-serif')

# ═══════════════════════════════════════════
#  Infrastructure Row
# ═══════════════════════════════════════════
INF_Y = 4.80
heading(ax, 0.25, INF_Y + 0.38, 'Infrastructure', 10, C_SUBTLE)

iw1, iw2 = 2.2, 2.8
ih = 0.48
rounded_box(ax, 0.25, INF_Y, iw1, ih, C_GRAY,
            'Local Frontend',
            'Instruction authoring · Review',
            bg='white', title_sz=8, desc_sz=7, corner=3, shadow=False)
rounded_box(ax, 2.70, INF_Y, iw2, ih, C_GRAY,
            'Remote Execution (PJLab)',
            'Agent runtime · Compute · Storage',
            bg='white', title_sz=8, desc_sz=7, corner=3, shadow=False)
arrow(ax, 2.45, INF_Y + ih/2, 2.70, INF_Y + ih/2, C_LINE, 1.6)

# ═══════════════════════════════════════════
#  Pipeline – Row 1:  P0  P1  P2  P3
# ═══════════════════════════════════════════
PW, PH, GAP = 1.10, 0.66, 0.12
P1Y = 3.75
heading(ax, 0.25, P1Y + PH + 0.22, 'Execution Pipeline', 10, C_SUBTLE)

row1 = [
    ('P0', 'Preflight',
     'Git credentials\nWorkspace audit\nFrame manifest'),
    ('P1', 'Inventory',
     'GEO supplementary\nMatrix availability\nFile enumeration'),
    ('P2', 'Targets',
     '20–50 guide/gene\nJAK/STAT · IFN\nNF-κB · Checkpoint'),
    ('P3', 'Extraction',
     'scRNA counts\nADT counts\nUniProt annotation'),
]
for i, (lb, ti, ds) in enumerate(row1):
    x = 0.25 + i * (PW + GAP)
    rounded_box(ax, x, P1Y, PW, PH, C_BLUE, lb,
                f'{ti}\n{ds}', bg='white', title_sz=10, desc_sz=5.8, corner=4)
    if i < 3:
        arrow(ax, x + PW, P1Y + PH/2, x + PW + GAP, P1Y + PH/2, C_LINE, 1.5)

# ═══════════════════════════════════════════
#  Pipeline – Row 2:  P4  P5  P6  P7
# ═══════════════════════════════════════════
P2Y = 2.55
OX = 0.55  # offset for row 2

row2 = [
    ('P4', 'RNA / ADT Response',
     'L3 guide-level RNA\nL4 ADT response\nReactome · GO enrich.'),
    ('P5', 'Phenotype Alignment',
     'L0–L4 → DepMap L5\nStrong / Moderate\nWeak dependency'),
    ('P6', 'Dataset Assembly',
     'L0–L5 integration\nProvenance manifests\nSchema validation'),
    ('P7', 'Exploratory Output',
     'Coverage analysis\nCross-scale linking\nVisualization suite'),
]
for i, (lb, ti, ds) in enumerate(row2):
    x = 0.25 + OX + i * (PW + GAP)
    rounded_box(ax, x, P2Y, PW, PH, C_BLUE, lb,
                f'{ti}\n{ds}', bg='white', title_sz=8.5, desc_sz=5.5, corner=4)
    if i < 3:
        arrow(ax, x + PW, P2Y + PH/2,
              x + PW + GAP, P2Y + PH/2, C_LINE, 1.5)

# P3 → P4 diagonal connector
p3cx = 0.25 + 3 * (PW + GAP) + PW/2
p4cx = 0.25 + OX + PW/2
arrow(ax, p3cx, P1Y, p4cx, P2Y + PH, C_LINE, 1.4)

# ═══════════════════════════════════════════
#  Gate Validation Badges
# ═══════════════════════════════════════════
gate_x_offsets = [
    OX + PW + GAP * 0.3,          # P4 gate
    OX + 2 * (PW + GAP) + GAP * 0.3,  # P5 gate
    OX + 3 * (PW + GAP) + PW + 0.02   # P7 gate
]
gate_labels = ['P4/P5 Gate', 'P5 Gating', 'P7 Gate']

for gx_off, gl in zip(gate_x_offsets, gate_labels):
    gx = 0.25 + gx_off
    gy = P2Y + PH + 0.10
    gate_badge(ax, gx, gy, gl, C_RED)

# Dashed enclosure for gate zone
gate_zone_x = 0.25 + OX - 0.10
gate_zone_w = 4 * (PW + GAP) - GAP + 0.20
gate_zone_y = P2Y + PH + 0.02
gate_zone_h = 0.30
gate_zone = FancyBboxPatch(
    (gate_zone_x, gate_zone_y), gate_zone_w, gate_zone_h,
    boxstyle='round,pad=0.02,rounding_size=8',
    fc='none', ec=C_RED, lw=1.0, ls='--', alpha=0.45, zorder=0)
ax.add_patch(gate_zone)
ax.text(gate_zone_x + 0.10, gate_zone_y + gate_zone_h + 0.04,
        'Automated Gate Validation',
        ha='left', va='bottom', fontsize=6.5, color=C_RED,
        fontweight='bold', zorder=10)

# ═══════════════════════════════════════════
#  Biology Stack  L0 … L5
# ═══════════════════════════════════════════
BX, BW, BC, BGAP = 5.70, 0.95, 0.36, 0.04
BY = 4.40
heading(ax, BX, BY + 0.12, 'Biology Stack', 10, C_SUBTLE)

bio = [
    ('L0', 'Perturbation', 'CRISPR guide / target'),
    ('L1', 'Annotation',   'UniProt'),
    ('L2', 'Pathway',      'Reactome / GO'),
    ('L3', 'RNA Response', 'scRNA differential expr.'),
    ('L4', 'Protein',      'ADT / CITE-seq'),
    ('L5', 'Phenotype',    'DepMap / Achilles'),
]
for i, (lb, ti, ds) in enumerate(bio):
    y = BY - 0.02 - i * (BC + BGAP)
    rounded_box(ax, BX, y, BW, BC, C_GREEN,
                f'{lb}  {ti}', ds,
                bg='white', title_sz=6.5, desc_sz=5.0, corner=3, shadow=False)

# ═══════════════════════════════════════════
#  Dashed Connectors: Pipeline → Biology
# ═══════════════════════════════════════════
connections = [
    # (phase_row_y, phase_index_in_row, bio_index)
    (P1Y, 1, 4),   # P1 → L4
    (P1Y, 2, 3),   # P2 → L3
    (P2Y, 0, 2),   # P4 → L2
]
for py, pi, bi in connections:
    px = 0.25 + (0 if py == P1Y else OX) + pi * (PW + GAP) + PW
    by = BY - 0.02 - bi * (BC + BGAP) + BC/2
    ax.annotate('', xy=(BX, by), xytext=(px, py + PH/2),
                arrowprops=dict(arrowstyle='->', color=C_LINE,
                                lw=1.0, ls=(0, (5, 3)),
                                connectionstyle='arc3,rad=0.05'),
                zorder=0)

# ═══════════════════════════════════════════
#  Evidence DAG & Orchestrator
# ═══════════════════════════════════════════
DY = 1.50
heading(ax, 0.25, DY + 0.60 + 0.12, 'Output & Traceability', 10, C_SUBTLE)
rounded_box(ax, 0.25, DY, 3.6, 0.52, C_PURPLE,
            'Evidence DAG',
            'Provenance graph · Schema validation · Audit trail',
            bg='white', title_sz=8.5, desc_sz=7, corner=4)
rounded_box(ax, 4.00, DY, 2.70, 0.52, C_PURPLE,
            'Orchestrator & Hub',
            'Decision records · Gate checkpoints · Rationale log',
            bg='white', title_sz=8.5, desc_sz=7, corner=4)

# P7 → Evidence DAG arrow
p7cx = 0.25 + OX + 3 * (PW + GAP) + PW/2
arrow(ax, p7cx, P2Y, DY + 0.52 + 0.05, DY + 0.52, C_LINE, 1.4)

# ═══════════════════════════════════════════
#  Colour Legend
# ═══════════════════════════════════════════
legend_y = 0.55
legend_items = [
    (C_BLUE,   'Pipeline Phase'),
    (C_GREEN,  'Biology Layer'),
    (C_PURPLE, 'Evidence DAG / Orchestrator'),
    (C_RED,    'Gate Validation'),
    (C_GRAY,   'Infrastructure'),
]
for i, (c, lab) in enumerate(legend_items):
    lx = 0.30 + i * 1.52
    # Coloured swatch
    swatch = mpatches.Rectangle((lx, legend_y), 0.20, 0.14,
                                fc=c, ec='none', zorder=5)
    ax.add_patch(swatch)
    ax.text(lx + 0.26, legend_y + 0.07, lab,
            ha='left', va='center', color=C_TEXT,
            fontsize=7.0, zorder=5, fontfamily='sans-serif')

# Divider line above legend
ax.plot([0.20, 7.80], [legend_y + 0.24, legend_y + 0.24],
        color=C_LINE, lw=0.5, alpha=0.5, zorder=0)

# ═══════════════════════════════════════════
#  Save
# ═══════════════════════════════════════════
plt.tight_layout(pad=0.2)
fig.savefig(OUTPUT, dpi=DPI, facecolor=BG, edgecolor='none',
            bbox_inches='tight', pad_inches=0.15)
plt.close(fig)
print(f'Fig. 6 saved -> {OUTPUT}')
