#!/usr/bin/env python3
"""
Generate Fig. 9: De Novo Protein Design — Comprehensive Evaluation.
Redesigned per reviewer feedback with real data from sciforge-de-novo-protein-demo.
Panels: A) Design Pipeline Overview, B) Candidate Sequence Logos,
C) Quality Metrics Comparison, D) Amino-Acid Composition,
E) Design Assessment Summary.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Arc, Rectangle
import numpy as np
from PIL import Image as PILImg, ImageDraw, ImageFont
import io
import warnings
warnings.filterwarnings('ignore')

plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.size': 13,
    'axes.titlesize': 15,
    'axes.labelsize': 13,
    'xtick.labelsize': 12,
    'ytick.labelsize': 12,
    'legend.fontsize': 12,
    'figure.facecolor': 'white',
    'axes.facecolor': '#FAFBFC',
    'axes.grid': True,
    'grid.alpha': 0.25,
    'grid.linestyle': '--',
    'savefig.dpi': 400,
    'savefig.bbox': 'tight',
})

# Color palette
DARK = '#2C3E50'; BLUE = '#2980B9'; GREEN = '#27AE60'
ORANGE = '#E67E22'; RED_C = '#E74C3C'; PURPLE = '#8E44AD'
TEAL = '#1ABC9C'; GRAY = '#95A5A6'; LIGHT_GRAY = '#ECF0F1'

# ====== REAL DATA from sciforge-de-novo-protein-demo ======
candidates = [
    {
        'id': 'candidate-001',
        'backbone': 'backbone-003',
        'length': 92,
        'proteinmpnn': 1.1039,
        'confidence': 0.9396,
        'ptm': 0.9275,
        'plddt': 0.9426,
        'charged': 0.5652,
        'hydrophobic': 0.3804,
        'entropy': 2.8455,
        'seq': 'EAEEELDAALDEAIELFEKLAKEEKDEERREFLLRQAERLRELRRRLREEGLPLEEARRELEELLEELKKAGAPEELREKVERLIRLVEEAL'
    },
    {
        'id': 'candidate-002',
        'backbone': 'backbone-003',
        'length': 92,
        'proteinmpnn': 1.1481,
        'confidence': 0.9159,
        'ptm': 0.8789,
        'plddt': 0.9252,
        'charged': 0.5326,
        'hydrophobic': 0.3913,
        'entropy': 2.9709,
        'seq': 'SALEELRKAIEELIELLKEEAKAEKDEKRKKLLEEFAEEVEELKRRLEEEGLPLEEALERLKELLKKLEKEGAPQELIDKVQEVIELIEKAI'
    }
]

# Amino acid composition
def aa_composition(seq):
    aa_order = 'ACDEFGHIKLMNPQRSTVWY'
    counts = {aa: seq.count(aa) for aa in aa_order}
    total = len(seq)
    return {aa: counts[aa]/total*100 for aa in aa_order}

# ====== FIGURE ======
fig = plt.figure(figsize=(30, 22))
gs = fig.add_gridspec(3, 3, hspace=0.32, wspace=0.28, left=0.03, right=0.98, top=0.94, bottom=0.04)

fig.suptitle('De Novo Protein Design: Computational Pipeline and Candidate Evaluation',
             fontsize=22, fontweight='bold', y=0.975, color=DARK)

# ====== PANEL A: Design Pipeline Overview (spans cols 0-2) ======
ax_a = fig.add_subplot(gs[0, :])
ax_a.set_xlim(0, 10); ax_a.set_ylim(0, 3)
ax_a.axis('off')
ax_a.set_title('A) Design Pipeline Overview', fontsize=15, fontweight='bold', loc='left', pad=12, color=DARK)

# Pipeline boxes with arrows
boxes = [
    (0.3, 1.0, 1.8, 1.0, '#E8F6F3', BLUE, 'RFdiffusion\nBackbone\nGeneration'),
    (2.5, 1.0, 1.8, 1.0, '#EAF2F8', BLUE, 'ProteinMPNN\nSequence\nDesign'),
    (4.7, 1.0, 1.8, 1.0, '#FDEBD0', ORANGE, 'Boltz-2\nStructure\nPrediction'),
    (6.9, 1.0, 1.8, 1.0, '#D5F5E3', GREEN, 'Multi-Metric\nQuality\nRanking'),
    (9.0, 1.0, 0.8, 1.0, '#FADBD8', RED_C, '2 Final\nCandidates'),
]

for x, y, w, h, fc, ec, label in boxes:
    rect = FancyBboxPatch((x, y), w, h, boxstyle='round,pad=0.15',
                          facecolor=fc, edgecolor=ec, linewidth=2.5)
    ax_a.add_patch(rect)
    lines = label.split('\n')
    for li, line in enumerate(lines):
        ax_a.text(x + w/2, y + h/2 + (len(lines)-1)*0.15 - li*0.3, line,
                 ha='center', va='center', fontsize=11, fontweight='bold', color=DARK)

# Arrows between boxes
for i in range(len(boxes) - 1):
    x1 = boxes[i][0] + boxes[i][2]
    y1 = boxes[i][1] + boxes[i][3]/2
    x2 = boxes[i+1][0]
    y2 = boxes[i+1][1] + boxes[i+1][3]/2
    ax_a.annotate('', xy=(x2, y2), xytext=(x1, y1),
                  arrowprops=dict(arrowstyle='->', color=GRAY, lw=3, connectionstyle='arc3,rad=0'))

# Pipeline stats
stats_text = (f'3 Backbones → 15 Sequences → 2 Verified | '
              f'ProteinMPNN: 1.10–1.15 | Boltz-2 pTM: 0.88–0.93 | '
              f'Target: 80–100 residue mixed α/β scaffold')
ax_a.text(5, 2.5, stats_text, ha='center', va='center', fontsize=11,
          fontstyle='italic', color=GRAY)

# Design objective box
obj_box = FancyBboxPatch((0.1, 2.15), 9.6, 0.6, boxstyle='round,pad=0.1',
                         facecolor='#F4F6F7', edgecolor=GRAY, linewidth=1.5, linestyle='--')
ax_a.add_patch(obj_box)
ax_a.text(5, 2.45, 'Design Objective: 80–100 residue de novo scaffold with stable hydrophobic core and mixed α/β topology',
          ha='center', va='center', fontsize=11, fontweight='bold', color=DARK)

# ====== PANEL B: Quality Metrics Comparison ======
ax_b = fig.add_subplot(gs[1, 0])
ax_b.set_title('B) Structure Prediction Confidence', fontsize=14, fontweight='bold', loc='left', pad=8, color=DARK)

metrics = ['pLDDT', 'pTM', 'Confidence']
x = np.arange(len(metrics))
width = 0.3

c1_vals = [candidates[0]['plddt'], candidates[0]['ptm'], candidates[0]['confidence']]
c2_vals = [candidates[1]['plddt'], candidates[1]['ptm'], candidates[1]['confidence']]

bars1 = ax_b.bar(x - width/2, c1_vals, width, color=BLUE, edgecolor='white', linewidth=1.5, label='candidate-001')
bars2 = ax_b.bar(x + width/2, c2_vals, width, color=ORANGE, edgecolor='white', linewidth=1.5, label='candidate-002')

for bar, val in zip(bars1, c1_vals):
    ax_b.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01, f'{val:.3f}',
             ha='center', va='bottom', fontsize=10, fontweight='bold', color=BLUE)
for bar, val in zip(bars2, c2_vals):
    ax_b.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01, f'{val:.3f}',
             ha='center', va='bottom', fontsize=10, fontweight='bold', color=ORANGE)

ax_b.set_xticks(x); ax_b.set_xticklabels(metrics, fontsize=12)
ax_b.set_ylim(0.7, 1.0)
ax_b.set_ylabel('Score', fontsize=12)
ax_b.legend(fontsize=11, loc='lower right', framealpha=0.9)
ax_b.axhline(y=0.8, color='red', linestyle=':', alpha=0.5, linewidth=1.5)
ax_b.text(2.5, 0.805, '0.8 threshold', fontsize=9, color='red', alpha=0.7)

# ====== PANEL C: Amino-Acid Composition ======
ax_c = fig.add_subplot(gs[1, 1])
ax_c.set_title('C) Residue Composition', fontsize=14, fontweight='bold', loc='left', pad=8, color=DARK)

aa_order = 'ACDEFGHIKLMNPQRSTVWY'
comp1 = aa_composition(candidates[0]['seq'])
comp2 = aa_composition(candidates[1]['seq'])

x_aa = np.arange(len(aa_order))
w_aa = 0.35

ax_c.bar(x_aa - w_aa/2, [comp1.get(aa, 0) for aa in aa_order], w_aa, color=BLUE, alpha=0.85, label='candidate-001')
ax_c.bar(x_aa + w_aa/2, [comp2.get(aa, 0) for aa in aa_order], w_aa, color=ORANGE, alpha=0.85, label='candidate-002')

ax_c.set_xticks(x_aa); ax_c.set_xticklabels(aa_order, fontsize=10)
ax_c.set_ylabel('Fraction (%)', fontsize=12)
ax_c.legend(fontsize=10, loc='upper right', framealpha=0.9)

# Highlight top residues
for i, aa in enumerate(aa_order):
    v = comp1.get(aa, 0)
    if v > 10:
        ax_c.annotate(f'{v:.0f}%', (i - w_aa/2, v), textcoords='offset points',
                     xytext=(0, 4), ha='center', fontsize=8, color=BLUE, fontweight='bold')

# ====== PANEL D: Key Properties Radar/Bar ======
ax_d = fig.add_subplot(gs[1, 2])
ax_d.set_title('D) Physicochemical Properties', fontsize=14, fontweight='bold', loc='left', pad=8, color=DARK)

prop_labels = ['Charged\nFraction', 'Hydrophobic\nFraction', 'Sequence\nEntropy']
prop_x = np.arange(len(prop_labels))

p1 = [candidates[0]['charged'], candidates[0]['hydrophobic'], candidates[0]['entropy']/4]
p2 = [candidates[1]['charged'], candidates[1]['hydrophobic'], candidates[1]['entropy']/4]

bars_p1 = ax_d.bar(prop_x - 0.2, p1, 0.35, color=BLUE, alpha=0.85, label='candidate-001')
bars_p2 = ax_d.bar(prop_x + 0.2, p2, 0.35, color=ORANGE, alpha=0.85, label='candidate-002')

for bar, val, orig in zip(bars_p1, p1, [candidates[0]['charged'], candidates[0]['hydrophobic'], candidates[0]['entropy']]):
    lbl = f'{orig:.2f}' if orig < 1 else f'{orig:.1f}%'
    if orig < 1: lbl = f'{orig:.2f}'
    else: lbl = f'{orig*100:.0f}%' if orig <= 1 else f'{orig:.1f}'
    ax_d.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.02, lbl,
             ha='center', fontsize=9, fontweight='bold', color=BLUE)

for bar, val, orig in zip(bars_p2, p2, [candidates[1]['charged'], candidates[1]['hydrophobic'], candidates[1]['entropy']]):
    if orig < 1: lbl = f'{orig:.2f}'
    else: lbl = f'{orig*100:.0f}%'
    ax_d.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.02, lbl,
             ha='center', fontsize=9, fontweight='bold', color=ORANGE)

ax_d.set_xticks(prop_x); ax_d.set_xticklabels(prop_labels, fontsize=11)
ax_d.set_ylabel('Value', fontsize=12)
ax_d.legend(fontsize=10, loc='upper right', framealpha=0.9)
ax_d.set_ylim(0, 0.85)

# ====== PANEL E: Candidate Sequence Map ======
ax_e = fig.add_subplot(gs[2, 0:2])
ax_e.set_title('E) Candidate Sequence Maps (ProteinMPNN Design)', fontsize=14, fontweight='bold', loc='left', pad=8, color=DARK)

# Create a heatmap-like sequence visualization
seq1 = candidates[0]['seq']
seq2 = candidates[1]['seq']

# Amino acid property coloring
aa_colors = {
    'A': '#E8E8E8', 'C': '#FFFF00', 'D': '#E60A0A', 'E': '#E60A0A',
    'F': '#145AFF', 'G': '#EBEBEB', 'H': '#8282D2', 'I': '#0F820F',
    'K': '#145AFF', 'L': '#0F820F', 'M': '#0F820F', 'N': '#2CD0D0',
    'P': '#DC9682', 'Q': '#2CD0D0', 'R': '#145AFF', 'S': '#2CD0D0',
    'T': '#2CD0D0', 'V': '#0F820F', 'W': '#145AFF', 'Y': '#8282D2'
}

for si, seq in enumerate([seq1, seq2]):
    y_pos = 1 - si * 0.8
    # Draw sequence as colored rectangles
    for ai, aa in enumerate(seq):
        color = aa_colors.get(aa, '#CCCCCC')
        ax_e.add_patch(Rectangle((ai, y_pos), 1, 0.6, facecolor=color, edgecolor='white', linewidth=0.5))
    ax_e.text(-2, y_pos + 0.3, f'{candidates[si]["id"]}', ha='right', va='center', fontsize=11, fontweight='bold', color=DARK)
    # Mark every 10 residues
    for ai in range(0, len(seq), 10):
        ax_e.text(ai + 0.5, y_pos - 0.25, str(ai+1), ha='center', fontsize=8, color=GRAY)
    # Key stats on right
    c = candidates[si]
    ax_e.text(95, y_pos + 0.3, f'Len: {c["length"]} | pTM: {c["ptm"]:.3f} | pLDDT: {c["plddt"]:.3f}', fontsize=10, color=DARK)

ax_e.set_xlim(-3, 105); ax_e.set_ylim(-0.5, 1.8)
ax_e.axis('off')

# Legend for sequence coloring
legend_items = [
    ('Hydrophobic', '#0F820F'), ('Positive', '#145AFF'), ('Negative', '#E60A0A'),
    ('Polar', '#2CD0D0'), ('Aromatic', '#8282D2'), ('Gly/Pro', '#DC9682')
]
for i, (label, color) in enumerate(legend_items):
    ax_e.add_patch(Rectangle((85 + (i % 3) * 7, 1.55 - (i // 3) * 0.3), 1.5, 0.2, facecolor=color, edgecolor='white'))
    ax_e.text(87 + (i % 3) * 7, 1.65 - (i // 3) * 0.3, label, fontsize=8, color=DARK, va='bottom')

# ====== PANEL F: Design Assessment Summary ======
ax_f = fig.add_subplot(gs[2, 2])
ax_f.axis('off')
ax_f.set_title('F) Design Assessment Summary', fontsize=14, fontweight='bold', loc='left', pad=8, color=DARK)

# Summary table using text
table_data = [
    ('Metric', 'candidate-001', 'candidate-002'),
    ('Length (residues)', '92', '92'),
    ('ProteinMPNN Score', '1.104', '1.148'),
    ('Boltz-2 Confidence', '0.940', '0.916'),
    ('pTM', '0.928', '0.879'),
    ('complex pLDDT', '0.943', '0.925'),
    ('Charged Fraction', '56.5%', '53.3%'),
    ('Hydrophobic Fraction', '38.0%', '39.1%'),
    ('Seq. Entropy (bits)', '2.85', '2.97'),
]

y_start = 0.85
row_h = 0.09
for ri, row in enumerate(table_data):
    for ci, cell in enumerate(row):
        x_pos = 0.05 + ci * 0.35
        if ri == 0:
            ax_f.text(x_pos, y_start - ri * row_h, cell, fontsize=11, fontweight='bold',
                     color=DARK, transform=ax_f.transAxes,
                     bbox=dict(facecolor=LIGHT_GRAY, edgecolor=GRAY, pad=2))
        else:
            color = BLUE if ci == 1 else (ORANGE if ci == 2 else DARK)
            weight = 'bold' if ci == 0 else 'normal'
            ax_f.text(x_pos, y_start - ri * row_h, cell, fontsize=10, color=color,
                     fontweight=weight, transform=ax_f.transAxes)

# Key findings text
findings = [
    '✓ Pipeline completed successfully',
    '✓ Both candidates show high computational confidence',
    '⚠ Composition biased toward E/K/R/L/A',
    '⚠ Mixed α/β topology remains unverified',
    '→ Wet-lab validation required for folding confirmation'
]
for i, finding in enumerate(findings):
    color = GREEN if finding.startswith('✓') else (ORANGE if finding.startswith('⚠') else GRAY)
    ax_f.text(0.05, y_start - len(table_data) * row_h - 0.03 - i * 0.06, finding,
             fontsize=9, color=color, transform=ax_f.transAxes, fontweight='bold')

# ====== SAVE ======
output_path = 'protein-design-comprehensive.png'
fig.savefig(output_path, dpi=400, bbox_inches='tight', facecolor='white', edgecolor='none')
plt.close()

# Convert RGBA to RGB for PDF compatibility
tmp = PILImg.open(output_path)
if tmp.mode == 'RGBA':
    bg = PILImg.new('RGB', tmp.size, (255, 255, 255))
    bg.paste(tmp, mask=tmp.split()[3])
    bg.save(output_path, dpi=(400, 400))
elif tmp.mode != 'RGB':
    tmp = tmp.convert('RGB')
    tmp.save(output_path, dpi=(400, 400))

print(f'Fig. 9 saved: {output_path}')
