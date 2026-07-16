#!/usr/bin/env python3
"""Generate standalone Protein Design Pipeline figure for the paper."""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import matplotlib.patches as mpatches
import numpy as np
import warnings
warnings.filterwarnings('ignore')

plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.size': 16,
    'axes.titlesize': 20,
    'axes.labelsize': 16,
    'xtick.labelsize': 14,
    'ytick.labelsize': 14,
    'figure.facecolor': 'white',
    'savefig.dpi': 300,
    'savefig.bbox': 'tight',
})

DARK = '#2C3E50'
BLUE = '#2980B9'
BLUE_LIGHT = '#AED6F1'
TEAL = '#1ABC9C'
TEAL_LIGHT = '#A3E4D7'
GREEN = '#27AE60'
GREEN_LIGHT = '#A9DFBF'
PURPLE = '#8E44AD'
PURPLE_LIGHT = '#D7BDE2'
ORANGE = '#E67E22'
ORANGE_LIGHT = '#FAD7A1'
WHITE = '#FFFFFF'
GRAY = '#7F8C8D'
LIGHT_GRAY = '#ECF0F1'

# Create figure
fig, ax = plt.subplots(figsize=(18, 8))
ax.set_xlim(0, 100)
ax.set_ylim(0, 40)
ax.axis('off')

# Title
fig.suptitle('AI-Guided De Novo Protein Design Pipeline',
             fontsize=22, fontweight='bold', color=DARK, y=0.96)

# Pipeline stages
stages = [
    {'label': 'Input\nObjective', 'desc': '80-100 residues\nmixed α/β fold\nstable hydrophobic core',
     'x': 3, 'color': BLUE, 'light': BLUE_LIGHT},
    {'label': 'Stage 1\nBackbone\nGeneration', 'desc': 'RFdiffusion\n3 backbones\n(80-100 aa)',
     'x': 22, 'color': TEAL, 'light': TEAL_LIGHT},
    {'label': 'Stage 2\nSequence\nDesign', 'desc': 'ProteinMPNN\n5 seqs/backbone\n15 sequences total',
     'x': 41, 'color': GREEN, 'light': GREEN_LIGHT},
    {'label': 'Stage 3\nStructural\nVerification', 'desc': 'Boltz-2 (confidence)\nESMFold (consensus)\n5 GPU slots',
     'x': 60, 'color': PURPLE, 'light': PURPLE_LIGHT},
    {'label': 'Stage 4\nCandidate\nSelection', 'desc': 'pTM ≥ 0.85\npLDDT ≥ 0.90\nTop-2 candidates',
     'x': 79, 'color': ORANGE, 'light': ORANGE_LIGHT},
    {'label': 'Output\nCandidates', 'desc': 'Ranked designs\n+ Provenance\n+ PDB/mmCIF',
     'x': 95, 'color': BLUE, 'light': BLUE_LIGHT},
]

# Draw boxes and arrows
box_w = 14
box_h = 16
y_center = 20

for i, stage in enumerate(stages):
    cx = stage['x']
    color = stage['color']
    light = stage['light']
    
    # Main box
    box = FancyBboxPatch((cx - box_w/2, y_center - box_h/2), box_w, box_h,
                          boxstyle="round,pad=0.5",
                          facecolor=light, edgecolor=color,
                          linewidth=2.5, alpha=0.95)
    ax.add_patch(box)
    
    # Stage label
    ax.text(cx, y_center + 3.5, stage['label'],
            ha='center', va='center', fontsize=13, fontweight='bold',
            color=DARK, linespacing=1.3)
    
    # Description
    ax.text(cx, y_center - 3.5, stage['desc'],
            ha='center', va='center', fontsize=10.5, color=GRAY,
            linespacing=1.35, fontstyle='italic')
    
    # Stage number badge
    circle = plt.Circle((cx, y_center + box_h/2 + 1), 1.8,
                        facecolor=color, edgecolor='white', linewidth=2, zorder=5)
    ax.add_patch(circle)
    ax.text(cx, y_center + box_h/2 + 1, str(i+1) if i < len(stages)-1 else '★',
            ha='center', va='center', fontsize=12, fontweight='bold',
            color='white', zorder=6)

# Arrows between stages
for i in range(len(stages) - 1):
    x1 = stages[i]['x'] + box_w/2
    x2 = stages[i+1]['x'] - box_w/2
    y1 = y_center
    y2 = y_center
    
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle='->', color=DARK,
                               lw=2.5, connectionstyle='arc3,rad=0'))

# Metrics summary box at bottom
metrics_box = FancyBboxPatch((5, 3), 90, 5, boxstyle="round,pad=0.3",
                              facecolor=LIGHT_GRAY, edgecolor=GRAY,
                              linewidth=1.5, alpha=0.8)
ax.add_patch(metrics_box)
ax.text(50, 5.5,
        'Verified Output: candidate-001 (confidence=0.940, pTM=0.928, pLDDT=0.943)  |  candidate-002 (confidence=0.916, pTM=0.879, pLDDT=0.925)  |  ~5 min wall-clock time',
        ha='center', va='center', fontsize=11, color=DARK, fontweight='bold')

# Legend
legend_y = 1
ax.text(95, legend_y, 'Tools: RFdiffusion | ProteinMPNN | Boltz-2 | ESMFold',
        ha='right', va='center', fontsize=9, color=GRAY, fontstyle='italic')

output_path = 'figures/protein-design-pipeline.png'
fig.savefig(output_path, dpi=300, bbox_inches='tight', facecolor='white', edgecolor='none')
plt.close()

# Convert RGBA to RGB for PDF compatibility
from PIL import Image as PILImg
tmp = PILImg.open(output_path)
if tmp.mode == 'RGBA':
    bg = PILImg.new('RGB', tmp.size, (255, 255, 255))
    bg.paste(tmp, mask=tmp.split()[3])
    bg.save(output_path)
elif tmp.mode != 'RGB':
    tmp = tmp.convert('RGB')
    tmp.save(output_path)

print(f'Pipeline figure saved: {output_path}')
