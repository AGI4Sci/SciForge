#!/usr/bin/env python3
"""Generate Fig. 9 (v2): De Novo Protein Design with SciForge.
Redesigned per reviewer feedback for better expressiveness.
Uses real data from sciforge-de-novo-protein-demo.
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import numpy as np
from PIL import Image as PILImg
import warnings
warnings.filterwarnings('ignore')

plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.size': 11,
    'axes.titlesize': 13,
    'axes.labelsize': 11,
    'xtick.labelsize': 10,
    'ytick.labelsize': 10,
    'legend.fontsize': 9,
    'figure.facecolor': 'white',
    'axes.facecolor': '#F8F9FA',
    'axes.grid': True,
    'grid.alpha': 0.25,
    'grid.linestyle': '--',
    'savefig.dpi': 300,
    'savefig.bbox': 'tight',
})

# Color palette
C1 = '#2E86C1'  # blue
C2 = '#E74C3C'  # red
C3 = '#27AE60'  # green
C4 = '#8E44AD'  # purple
C5 = '#E67E22'  # orange
C6 = '#16A085'  # teal
DARK = '#2C3E50'
GRAY = '#7F8C8D'

# ---- REAL DATA from demo repo ----
candidates = {
    'candidate-001': {
        'length': 92,
        'proteinmpnn': 1.1039,
        'confidence': 0.9396,
        'ptm': 0.9275,
        'plddt': 0.9426,
        'charged': 0.5652,
        'hydrophobic': 0.3804,
        'entropy': 2.8455,
        'seq': 'EAEEELDAALDEAIELFEKLAKEEKDEERREFLLRQAERLRELRRRLREEGLPLEEARRELEELLEELKKAGAPEELREKVERLIRLVEEAL',
        'label': 'Candidate 1',
        'color': C1,
    },
    'candidate-002': {
        'length': 92,
        'proteinmpnn': 1.1481,
        'confidence': 0.9159,
        'ptm': 0.8789,
        'plddt': 0.9252,
        'charged': 0.5326,
        'hydrophobic': 0.3913,
        'entropy': 2.9709,
        'seq': 'SALEELRKAIEELIELLKEEAKAEKDEKRKKLLEEFAEEVEELKRRLEEEGLPLEEALERLKELLKKLEKEGAPQELIDKVQEVIELIEKAI',
        'label': 'Candidate 2',
        'color': C5,
    },
}

# AA properties
aa_groups = {
    'Acidic (D,E)': ['D', 'E'],
    'Basic (K,R,H)': ['K', 'R', 'H'],
    'Hydrophobic (A,I,L,M,F,W,V)': ['A', 'I', 'L', 'M', 'F', 'W', 'V'],
    'Polar (N,C,Q,S,T,Y)': ['N', 'C', 'Q', 'S', 'T', 'Y'],
    'Special (G,P)': ['G', 'P'],
}
aa_colors = {'Acidic (D,E)': '#E74C3C', 'Basic (K,R,H)': '#3498DB',
             'Hydrophobic (A,I,L,M,F,W,V)': '#F39C12', 'Polar (N,C,Q,S,T,Y)': '#2ECC71',
             'Special (G,P)': '#9B59B6'}

fig = plt.figure(figsize=(24, 18))
gs = fig.add_gridspec(3, 3, hspace=0.35, wspace=0.30, left=0.04, right=0.98, top=0.94, bottom=0.04)
fig.suptitle('De Novo Protein Scaffold Design with SciForge', fontsize=18, fontweight='bold',
             y=0.975, color=DARK)

# ===== PANEL A: Design Workflow Pipeline =====
ax_a = fig.add_subplot(gs[0, 0])
ax_a.set_xlim(0, 10); ax_a.set_ylim(0, 10); ax_a.axis('off')
ax_a.set_title('A  Computational Design Pipeline', fontsize=13, fontweight='bold', loc='left', pad=6, color=DARK)

stages = [
    (1, 7.5, 'RFdiffusion\nBackbone\nGeneration', C4, 3),
    (4, 7.5, 'ProteinMPNN\nSequence\nDesign', C1, 15),
    (7, 7.5, 'Boltz-2\nStructure\nVerification', C6, 2),
    (8.5, 4.5, 'Ranking &\nSelection', C3, 2),
]
for x, y, label, color, count in stages:
    rect = FancyBboxPatch((x-1.2, y-1.2), 2.4, 2.4, boxstyle='round,pad=0.1',
                          facecolor=color, edgecolor='white', alpha=0.9, lw=2)
    ax_a.add_patch(rect)
    ax_a.text(x, y+0.2, label, ha='center', va='center', fontsize=9, fontweight='bold', color='white')
    ax_a.text(x, y-0.8, f'({count} outputs)', ha='center', va='center', fontsize=7, color='white', alpha=0.8)

arrows = [(2.2, 7.5, 2.8, 7.5), (5.2, 7.5, 5.8, 7.5)]
for x1, y1, x2, y2 in arrows:
    ax_a.annotate('', xy=(x2, y2), xytext=(x1, y1),
                  arrowprops=dict(arrowstyle='->', lw=2, color=GRAY))
# Arrow from verification to ranking
ax_a.annotate('', xy=(8.5, 5.7), xytext=(7, 6.3),
              arrowprops=dict(arrowstyle='->', lw=2, color=GRAY, connectionstyle='arc3,rad=0.3'))

# Stats box
ax_a.text(5, 2.5, 'Input: 3 backbones\n→ 15 sequences\n→ 2 verified structures\n→ 2 final candidates',
          ha='center', va='center', fontsize=9, color=DARK,
          bbox=dict(boxstyle='round', facecolor='#F0F0F0', edgecolor=GRAY, alpha=0.8))

# ===== PANEL B: Quality Metrics Comparison =====
ax_b = fig.add_subplot(gs[0, 1])
metrics = ['ProteinMPNN\nScore', 'Boltz\nConfidence', 'pTM', 'pLDDT']
x_pos = np.arange(len(metrics))
width = 0.35

vals1 = [1.1039, 0.9396, 0.9275, 0.9426]
vals2 = [1.1481, 0.9159, 0.8789, 0.9252]
bars1 = ax_b.bar(x_pos - width/2, vals1, width, color=C1, alpha=0.85, edgecolor='white', lw=1, label='Candidate 1')
bars2 = ax_b.bar(x_pos + width/2, vals2, width, color=C5, alpha=0.85, edgecolor='white', lw=1, label='Candidate 2')

for bar, val in zip(bars1, vals1):
    ax_b.text(bar.get_x()+bar.get_width()/2, bar.get_height()+0.02, f'{val:.3f}',
              ha='center', fontsize=8, fontweight='bold', color=C1)
for bar, val in zip(bars2, vals2):
    ax_b.text(bar.get_x()+bar.get_width()/2, bar.get_height()+0.02, f'{val:.3f}',
              ha='center', fontsize=8, fontweight='bold', color=C5)

ax_b.set_xticks(x_pos); ax_b.set_xticklabels(metrics, fontsize=10)
ax_b.set_ylim(0, 1.35); ax_b.set_ylabel('Score', fontsize=11, fontweight='bold')
ax_b.legend(fontsize=9, loc='upper right', framealpha=0.9)
ax_b.set_title('B  Computational Quality Metrics', fontsize=13, fontweight='bold', loc='left', pad=6, color=DARK)
ax_b.axhline(y=0.9, color=GRAY, ls='--', alpha=0.5, lw=1)
ax_b.text(3.3, 0.91, 'High confidence\nthreshold', fontsize=7, color=GRAY, alpha=0.8)

# ===== PANEL C: AA Composition =====
ax_c = fig.add_subplot(gs[0, 2])
groups = list(aa_groups.keys())
group_colors = [aa_colors[g] for g in groups]

y = np.arange(2)
for j, (cid, cd) in enumerate(candidates.items()):
    seq = cd['seq']
    counts = {g: sum(1 for aa in seq if aa in aas) for g, aas in aa_groups.items()}
    total = sum(counts.values())
    left = 0
    for gi, g in enumerate(groups):
        pct = counts[g] / total * 100
        ax_c.barh(j, pct, left=left, color=group_colors[gi], height=0.5, edgecolor='white', lw=0.5)
        if pct > 5:
            ax_c.text(left + pct/2, j, f'{pct:.0f}%', ha='center', va='center', fontsize=7,
                      fontweight='bold', color='white' if pct > 15 else DARK)
        left += pct

ax_c.set_yticks([0, 1])
ax_c.set_yticklabels(['Candidate 1\n(92 aa)', 'Candidate 2\n(92 aa)'], fontsize=10)
ax_c.set_xlabel('Composition (%)', fontsize=11, fontweight='bold')
ax_c.set_title('C  Amino-Acid Composition', fontsize=13, fontweight='bold', loc='left', pad=6, color=DARK)

patches = [mpatches.Patch(color=group_colors[g], label=g) for g in groups]
ax_c.legend(handles=patches, fontsize=7, loc='lower right', ncol=2, framealpha=0.9)

# ===== PANEL D: Sequence Alignment View =====
ax_d = fig.add_subplot(gs[1, :2])
ax_d.set_xlim(0, 95); ax_d.set_ylim(0.5, 2.5); ax_d.axis('off')
ax_d.set_title('D  Designed Sequences', fontsize=13, fontweight='bold', loc='left', pad=6, color=DARK)

# Color mapping for residues
aa_color_map = {}
for g, aas in aa_groups.items():
    for aa in aas:
        aa_color_map[aa] = aa_colors[g]

for j, (cid, cd) in enumerate(candidates.items()):
    seq = cd['seq']
    y_pos = 2 - j
    ax_d.text(-0.5, y_pos, cd['label'], fontsize=11, fontweight='bold', color=cd['color'],
              ha='right', va='center')
    for i, aa in enumerate(seq):
        color = aa_color_map.get(aa, GRAY)
        ax_d.add_patch(plt.Rectangle((i*0.95 + 1, y_pos - 0.4), 0.9, 0.8,
                                     facecolor=color, edgecolor='white', lw=0.3, alpha=0.85))
        if i % 10 == 0:
            ax_d.text(i*0.95 + 1.45, y_pos - 0.65, str(i+1), fontsize=5, color=GRAY, ha='center')

# Legend for residue colors (top residues only)
top_aas = ['E', 'K', 'R', 'L', 'A']
legend_x = 0.5
for aa in top_aas:
    color = aa_color_map.get(aa, GRAY)
    ax_d.add_patch(plt.Rectangle((legend_x, 2.8), 0.4, 0.35, facecolor=color, edgecolor='white', lw=0.5))
    ax_d.text(legend_x + 0.2, 3.25, aa, fontsize=7, ha='center', fontweight='bold')
    legend_x += 0.55

# ===== PANEL E: Sequence Properties =====
ax_e = fig.add_subplot(gs[1, 2])

props = ['Charged\nFraction', 'Hydrophobic\nFraction', 'Sequence\nEntropy (bits)']
prop_vals = {
    'Candidate 1': [0.5652, 0.3804, 2.8455],
    'Candidate 2': [0.5326, 0.3913, 2.9709],
}
x_props = np.arange(len(props))
w_props = 0.35

for i, (label, vals) in enumerate(prop_vals.items()):
    color = C1 if i == 0 else C5
    offset = -w_props/2 + i*w_props
    bars = ax_e.bar(x_props + offset, vals, w_props, color=color, alpha=0.85,
                    edgecolor='white', lw=1, label=label)
    for bar, val in zip(bars, vals):
        ax_e.text(bar.get_x()+bar.get_width()/2, bar.get_height()+0.02,
                  f'{val:.3f}' if val < 1 else f'{val:.2f}',
                  ha='center', fontsize=8, fontweight='bold', color=color)

ax_e.set_xticks(x_props); ax_e.set_xticklabels(props, fontsize=10)
ax_e.set_title('E  Sequence Properties', fontsize=13, fontweight='bold', loc='left', pad=6, color=DARK)
ax_e.legend(fontsize=9, loc='upper right', framealpha=0.9)
ax_e.set_ylim(0, 3.3)
# Warning annotation
ax_e.text(2.5, 2.0, '⚠ High charged\nfraction may indicate\ncoiled-coil bias',
          fontsize=7, color=C2, ha='center', style='italic',
          bbox=dict(boxstyle='round', facecolor='#FFF3F3', edgecolor=C2, alpha=0.7))

# ===== PANEL F: Design Assessment & Limitations =====
ax_f = fig.add_subplot(gs[2, :])
ax_f.axis('off')
ax_f.set_title('F  Design Assessment & Quality Audit', fontsize=13, fontweight='bold', loc='left', pad=6, color=DARK)

assessment_data = [
    ('✓', 'Workflow Completed', '3 backbones → 15 sequences → 2 structures → 2 candidates', C3),
    ('✓', 'High Confidence', 'Boltz confidence > 0.91, pLDDT > 0.92 for both candidates', C3),
    ('✓', 'Provenance Retained', 'Full tool-call trace, stage manifest, artifact checksums', C3),
    ('⚠', 'Composition Bias', 'E+K+R > 50% in both candidates; limited alphabet (5 dominant AAs)', C5),
    ('⚠', 'Topology Unverified', 'Mixed α/β topology objective unconfirmed; coiled-coil bias suspected', C5),
    ('⚠', 'Selection Mismatch', 'Stated selection rationale used different sequences than verified ones', C5),
    ('✗', 'No Wet-Lab Validation', 'Folding, stability, expression, solubility not experimentally tested', C2),
    ('✗', 'No Function Assay', 'Binding, activity, safety not evaluated', C2),
]

y_pos = 6.5
for i, (icon, title, detail, color) in enumerate(assessment_data):
    ax_f.text(1, y_pos, f'{icon}  ', fontsize=13, color=color, ha='right', fontweight='bold')
    ax_f.text(1.5, y_pos, title, fontsize=11, fontweight='bold', color=DARK, va='center')
    ax_f.text(14, y_pos, detail, fontsize=10, color=DARK, va='center')
    y_pos -= 0.9
    # Separator
    if i < len(assessment_data) - 1:
        ax_f.axhline(y=y_pos + 0.45, xmin=0.02, xmax=0.98, color='#E0E0E0', lw=0.5)

# Key insight box
ax_f.text(0.5, 0.3,
          'Key Insight: While computational metrics appear strong, composition analysis and independent audit\n'
          'reveal limitations. Future iterations should add topology verification, diversity filters, and\n'
          'experimental validation. SciForge retains full provenance for reproducibility.',
          fontsize=9, color=DARK, style='italic', va='top',
          bbox=dict(boxstyle='round', facecolor='#EBF5FB', edgecolor=C1, alpha=0.5))

# ===== SAVE =====
output_path = 'protein-design-comprehensive.png'
fig.savefig(output_path, dpi=300, bbox_inches='tight', facecolor='white', edgecolor='none')

# Convert RGBA to RGB
tmp = PILImg.open(output_path)
if tmp.mode == 'RGBA':
    bg = PILImg.new('RGB', tmp.size, (255, 255, 255))
    bg.paste(tmp, mask=tmp.split()[3])
    bg.save(output_path)
elif tmp.mode != 'RGB':
    tmp = tmp.convert('RGB')
    tmp.save(output_path)

plt.close()
print(f'Fig. 9 (v2) saved: {output_path}')
