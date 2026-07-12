#!/usr/bin/env python3
"""
Cross-Scale Coverage Heatmap — Publication-quality, properly sized for sn-jnl.
Designed for 5.5 inch display width at 200 DPI (1100 px).
Rendered at 0.85\textwidth (4.37in), scale factor 0.79.
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
from matplotlib.colors import ListedColormap, BoundaryNorm

FIGSIZE = (5.5, 4.5)
DPI = 200
OUTPUT = '/Applications/workspace/ailab/research/app/DeepSeek-GUI/paper/figures/cross-scale-coverage-heatmap.png'

# ── Data ──
genes = [
    'JAK1', 'JAK2', 'STAT1', 'STAT2', 'IFNGR1', 'IFNGR2',
    'IRF1', 'NFKB1', 'RELA', 'CTLA4', 'PDCD1', 'CD274',
    'NonT-1', 'NonT-2', 'NonT-3', 'NonT-4',
]
layers = ['L0\nPerturb.', 'L1\nAnnot.', 'L2\nPathway',
          'L3\nRNA', 'L4\nProtein', 'L5\nPheno.']

data = np.array([
    [2, 2, 2, 2, 2, 2],
    [2, 2, 2, 2, 2, 2],
    [2, 2, 2, 2, 2, 2],
    [2, 2, 2, 2, 1, 2],
    [2, 2, 2, 2, 2, 1],
    [2, 2, 2, 2, 2, 1],
    [2, 2, 2, 2, 0, 1],
    [2, 2, 2, 2, 1, 2],
    [2, 2, 2, 2, 2, 2],
    [2, 2, 2, 2, 2, 1],
    [2, 2, 2, 2, 0, 2],
    [2, 2, 2, 2, 1, 2],
    [2, 0, 0, 2, 0, 0],
    [2, 0, 0, 2, 0, 0],
    [2, 0, 0, 2, 0, 0],
    [2, 0, 0, 2, 0, 0],
])

cmap = ListedColormap(['#E5E7EB', '#FCD34D', '#059669'])
bounds = [-0.5, 0.5, 1.5, 2.5]
norm = BoundaryNorm(bounds, cmap.N)

plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10})

fig, ax = plt.subplots(figsize=FIGSIZE, facecolor='white')
ax.set_facecolor('white')

im = ax.imshow(data, cmap=cmap, norm=norm, aspect='auto', interpolation='nearest')

# Grid
for i in range(data.shape[0] + 1):
    ax.axhline(i - 0.5, color='white', lw=1.5)
for j in range(data.shape[1] + 1):
    ax.axvline(j - 0.5, color='white', lw=1.5)

# Cell labels
for i in range(data.shape[0]):
    for j in range(data.shape[1]):
        val = data[i, j]
        labels = {0: '\u2014', 1: '\u25D0', 2: '\u25CF'}
        colors = {0: '#9CA3AF', 1: '#92400E', 2: '#FFFFFF'}
        ax.text(j, i, labels.get(val, str(val)), ha='center', va='center',
                fontsize=9, fontweight='bold', color=colors.get(val, '#000'))

# Axes
ax.set_xticks(range(len(layers)))
ax.set_xticklabels(layers, fontsize=8.5, fontweight='bold', color='#374151')
ax.xaxis.set_ticks_position('top')
ax.xaxis.set_label_position('top')

ax.set_yticks(range(len(genes)))
ax.set_yticklabels(genes, fontsize=9, fontfamily='DejaVu Sans Mono', color='#1F2937')

for i in range(12, 16):
    ax.get_yticklabels()[i].set_color('#9CA3AF')

# Group separator
ax.axhline(11.5, color='#D1D5DB', lw=1.8, ls='-')

# Group labels
ax.text(-1.2, 5.5, 'Target Genes', ha='center', va='center',
        fontsize=9, fontweight='bold', color='#6B7280', rotation=90)
ax.text(-1.2, 13.5, 'Controls', ha='center', va='center',
        fontsize=9, fontweight='bold', color='#9CA3AF', rotation=90)

# Legend
legend_elements = [
    mpatches.Patch(facecolor='#059669', edgecolor='white', linewidth=1.2, label='Complete'),
    mpatches.Patch(facecolor='#FCD34D', edgecolor='white', linewidth=1.2, label='Partial'),
    mpatches.Patch(facecolor='#E5E7EB', edgecolor='white', linewidth=1.2, label='Missing'),
]
leg = ax.legend(handles=legend_elements, loc='lower center',
                bbox_to_anchor=(0.5, -0.33), ncol=3,
                frameon=True, fancybox=True, edgecolor='#E5E7EB',
                fontsize=9, handleheight=1.3, handlelength=1.5)
leg.get_frame().set_facecolor('white')

ax.set_title('Cross-Scale Data Coverage Matrix', fontsize=12, fontweight='bold',
             color='#1F2937', pad=20)

plt.tight_layout(pad=1.0)
fig.savefig(OUTPUT, dpi=DPI, facecolor='white', edgecolor='none',
            bbox_inches='tight', pad_inches=0.2)
plt.close(fig)
print(f'Fig. 7 saved -> {OUTPUT}')
