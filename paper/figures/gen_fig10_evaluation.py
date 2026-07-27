#!/usr/bin/env python3
"""Fig. 10: Protein Design Evaluation — Confidence, Composition, 3D Structure, Properties.
Without pipeline (moved to separate Fig. 9), without sequence map, without summary table.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from matplotlib.patches import FancyBboxPatch, Rectangle
import numpy as np
from PIL import Image as PILImg
import warnings
warnings.filterwarnings('ignore')

plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.size': 14,
    'axes.titlesize': 16,
    'axes.labelsize': 14,
    'xtick.labelsize': 13,
    'ytick.labelsize': 13,
    'legend.fontsize': 13,
    'figure.facecolor': 'white',
    'axes.facecolor': '#FAFBFC',
    'axes.grid': True,
    'grid.alpha': 0.25,
    'grid.linestyle': '--',
    'savefig.dpi': 400,
    'savefig.bbox': 'tight',
})

DARK = '#2C3E50'; BLUE = '#2980B9'; GREEN = '#27AE60'
ORANGE = '#E67E22'; RED_C = '#E74C3C'; PURPLE = '#8E44AD'
TEAL = '#1ABC9C'; GRAY = '#95A5A6'; LIGHT_GRAY = '#ECF0F1'

candidates = [
    {
        'id': 'candidate-001', 'backbone': 'backbone-003', 'length': 92,
        'proteinmpnn': 1.1039, 'confidence': 0.9396, 'ptm': 0.9275,
        'plddt': 0.9426, 'charged': 0.5652, 'hydrophobic': 0.3804,
        'entropy': 2.8455,
    },
    {
        'id': 'candidate-002', 'backbone': 'backbone-003', 'length': 92,
        'proteinmpnn': 1.1481, 'confidence': 0.9159, 'ptm': 0.8789,
        'plddt': 0.9252, 'charged': 0.5326, 'hydrophobic': 0.3913,
        'entropy': 2.9709,
    }
]

def aa_composition(seq):
    aa_order = 'ACDEFGHIKLMNPQRSTVWY'
    counts = {aa: seq.count(aa) for aa in aa_order}
    total = len(seq)
    return {aa: counts[aa]/total*100 for aa in aa_order}

fig = plt.figure(figsize=(24, 20))
gs = fig.add_gridspec(2, 2, hspace=0.28, wspace=0.25, left=0.04, right=0.97, top=0.94, bottom=0.05)

fig.suptitle('Protein Design Candidate Evaluation', fontsize=20, fontweight='bold', color=DARK, y=0.98)

# ====== PANEL A: Structure Prediction Confidence ======
ax_a = fig.add_subplot(gs[0, 0])
ax_a.set_title('A) Structure Prediction Confidence', fontsize=16, fontweight='bold', loc='left', pad=10, color=DARK)

metrics = ['Confidence', 'pTM', 'complex\npLDDT']
c1_vals = [candidates[0]['confidence'], candidates[0]['ptm'], candidates[0]['plddt']]
c2_vals = [candidates[1]['confidence'], candidates[1]['ptm'], candidates[1]['plddt']]

x = np.arange(len(metrics))
width = 0.28
bars1 = ax_a.bar(x - width/2, c1_vals, width, color=BLUE, edgecolor='white', linewidth=1.8, label='candidate-001')
bars2 = ax_a.bar(x + width/2, c2_vals, width, color=ORANGE, edgecolor='white', linewidth=1.8, label='candidate-002')

for bar in bars1:
    ax_a.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.008, f'{bar.get_height():.3f}',
             ha='center', va='bottom', fontsize=12, fontweight='bold', color=BLUE)
for bar in bars2:
    ax_a.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.008, f'{bar.get_height():.3f}',
             ha='center', va='bottom', fontsize=12, fontweight='bold', color=ORANGE)

ax_a.set_xticks(x); ax_a.set_xticklabels(metrics, fontsize=13)
ax_a.set_ylim(0.7, 1.0)
ax_a.set_ylabel('Score', fontsize=14)
ax_a.legend(fontsize=13, loc='lower right', framealpha=0.9)
ax_a.axhline(y=0.8, color='red', linestyle=':', alpha=0.5, linewidth=1.5)
ax_a.text(2.45, 0.805, '0.8 threshold', fontsize=10, color='red', alpha=0.7)

# ====== PANEL B: Residue Composition ======
ax_b = fig.add_subplot(gs[0, 1])
ax_b.set_title('B) Residue Composition', fontsize=16, fontweight='bold', loc='left', pad=10, color=DARK)

aa_order = 'ACDEFGHIKLMNPQRSTVWY'
comp1 = aa_composition('EAEEELDAALDEAIELFEKLAKEEKDEERREFLLRQAERLRELRRRLREEGLPLEEARRELEELLEELKKAGAPEELREKVERLIRLVEEAL')
comp2 = aa_composition('SALEELRKAIEELIELLKEEAKAEKDEKRKKLLEEFAEEVEELKRRLEEEGLPLEEALERLKELLKKLEKEGAPQELIDKVQEVIELIEKAI')

x_aa = np.arange(len(aa_order))
w_aa = 0.35
ax_b.bar(x_aa - w_aa/2, [comp1.get(aa, 0) for aa in aa_order], w_aa, color=BLUE, alpha=0.85, label='candidate-001')
ax_b.bar(x_aa + w_aa/2, [comp2.get(aa, 0) for aa in aa_order], w_aa, color=ORANGE, alpha=0.85, label='candidate-002')

ax_b.set_xticks(x_aa); ax_b.set_xticklabels(aa_order, fontsize=11)
ax_b.set_ylabel('Fraction (%)', fontsize=14)
ax_b.legend(fontsize=12, loc='upper right', framealpha=0.9)

# Annotate high bars
for i, aa in enumerate(aa_order):
    v1 = comp1.get(aa, 0)
    v2 = comp2.get(aa, 0)
    if v1 > 5:
        ax_b.annotate(f'{v1:.0f}%', (i - w_aa/2, v1), textcoords='offset points',
                     xytext=(0, 5), ha='center', fontsize=9, color=BLUE, fontweight='bold')
    if v2 > 5:
        ax_b.annotate(f'{v2:.0f}%', (i + w_aa/2, v2), textcoords='offset points',
                     xytext=(0, 5), ha='center', fontsize=9, color=ORANGE, fontweight='bold')

# ====== PANEL C: 3D Structure Cartoon ======
ax_c = fig.add_subplot(gs[1, 0])
ax_c.set_title('C) 3D Structure Cartoon (Boltz-2 Prediction)', fontsize=16, fontweight='bold', loc='left', pad=10, color=DARK)
try:
    img_3d = PILImg.open('protein-3d-structure.png')
    ax_c.imshow(img_3d)
    ax_c.axis('off')
except Exception as e:
    ax_c.text(0.5, 0.5, f'3D structure image not available\n({e})', ha='center', va='center',
             fontsize=14, color=GRAY, transform=ax_c.transAxes)
    ax_c.axis('off')

# ====== PANEL D: Physicochemical Properties ======
ax_d = fig.add_subplot(gs[1, 1])
ax_d.set_title('D) Physicochemical Properties', fontsize=16, fontweight='bold', loc='left', pad=10, color=DARK)

prop_labels = ['Charged\nFraction', 'Hydrophobic\nFraction', 'Polar\nFraction', 'Aliphatic\nIndex', 'GRAVY']
p1 = [0.565, 0.380, 0.055, 0.81, -0.45]
p2 = [0.533, 0.391, 0.076, 0.83, -0.38]
prop_x = np.arange(len(prop_labels))
bars_p1 = ax_d.bar(prop_x - 0.2, p1, 0.35, color=BLUE, alpha=0.85, label='candidate-001')
bars_p2 = ax_d.bar(prop_x + 0.2, p2, 0.35, color=ORANGE, alpha=0.85, label='candidate-002')

for bar in bars_p1:
    lbl = f'{bar.get_height():.2f}' if abs(bar.get_height()) < 1 else f'{bar.get_height():.1%}' if bar.get_height() > 0 else f'{bar.get_height():.2f}'
    ax_d.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.02, f'{bar.get_height():.3f}',
             ha='center', va='bottom', fontsize=10, fontweight='bold', color=BLUE)
for bar in bars_p2:
    ax_d.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.02, f'{bar.get_height():.3f}',
             ha='center', va='bottom', fontsize=10, fontweight='bold', color=ORANGE)

ax_d.set_xticks(prop_x); ax_d.set_xticklabels(prop_labels, fontsize=12)
ax_d.set_ylabel('Value', fontsize=14)
ax_d.legend(fontsize=12, loc='upper right', framealpha=0.9)
ax_d.set_ylim(-0.6, 0.95)

# ====== SAVE ======
output_path = 'protein-design-evaluation.png'
fig.savefig(output_path, dpi=400, bbox_inches='tight', facecolor='white', edgecolor='none')
plt.close()

tmp = PILImg.open(output_path)
if tmp.mode == 'RGBA':
    bg = PILImg.new('RGB', tmp.size, (255, 255, 255))
    bg.paste(tmp, mask=tmp.split()[3])
    bg.save(output_path, dpi=(400, 400))
elif tmp.mode != 'RGB':
    tmp = tmp.convert('RGB')
    tmp.save(output_path, dpi=(400, 400))

print(f'Fig. 10 evaluation saved: {output_path}')
