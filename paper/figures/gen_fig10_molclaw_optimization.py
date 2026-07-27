#!/usr/bin/env python3
"""Generate Fig. 10: MolClaw iterative optimization for EGFR T790M kinase inhibitors.
Publication-quality figure with large, clear molecular structures and spacious layout."""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib.patches import FancyBboxPatch
import numpy as np
from rdkit import Chem
from rdkit.Chem import Draw, AllChem, Descriptors
from rdkit.Chem.Draw import rdMolDraw2D
import cairosvg
from io import BytesIO
from PIL import Image
import warnings
warnings.filterwarnings('ignore')

plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.sans-serif': ['Arial', 'Helvetica', 'DejaVu Sans'],
    'font.size': 13,
    'axes.titlesize': 14,
    'axes.labelsize': 12,
    'axes.linewidth': 1.2,
    'xtick.labelsize': 12,
    'ytick.labelsize': 12,
    'legend.fontsize': 10,
    'figure.facecolor': 'white',
    'axes.facecolor': '#FAFBFC',
    'axes.grid': True,
    'grid.alpha': 0.3,
    'grid.linestyle': '--',
    'savefig.dpi': 300,
    'savefig.bbox': 'tight',
    'savefig.facecolor': 'white',
})

DARK = '#2C3E50'
BLUE = '#2E86C1'
RED = '#E74C3C'
GREEN = '#27AE60'
ORANGE = '#E67E22'

# ---- Real data ----
rounds_data = [
    {'round': 'R01','name':'R01_D003','smiles':'COCCOc1cc2ncnc(Nc3cccc(C(F)(F)F)c3)c2cc1OCCOC','score':-9.2,'mw':423.4,'logp':3.2,'qed':0.72,'best':False},
    {'round': 'R02','name':'R02_D001','smiles':'COCCOc1cc2ncnc(Nc3cccc(C(F)(F)F)c3)c2cc1OCC(F)(F)F','score':-9.5,'mw':459.4,'logp':3.6,'qed':0.68,'best':False},
    {'round': 'R03','name':'R03_D002','smiles':'COCCOc1cc2ncnc(Nc3cccc(C(F)(F)F)c3)c2cc1OCC(F)(F)F','score':-9.8,'mw':459.4,'logp':3.6,'qed':0.68,'best':False},
    {'round': 'R04','name':'R04_D001','smiles':'COc1cc2ncnc(Nc3cccc(C(F)(F)F)c3)c2cc1OCCOC','score':-9.5,'mw':393.4,'logp':3.0,'qed':0.74,'best':False},
    {'round': 'R05','name':'R05_D005','smiles':'COCCOc1cc2ncnc(Nc3cccc(C(F)(F)F)c3)c2cc1OCCOC','score':-10.0,'mw':423.4,'logp':3.2,'qed':0.72,'best':False},
    {'round': 'R06','name':'R06_D002','smiles':'COCCOc1cc2ncnc(Nc3cccc(C(F)(F)F)c3)c2cc1OCCOC','score':-10.3,'mw':423.4,'logp':3.2,'qed':0.72,'best':True},
]

def draw_mol(smiles, size=(650,400), hl_color=None):
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    AllChem.Compute2DCoords(mol)
    drawer = rdMolDraw2D.MolDraw2DSVG(size[0], size[1])
    opts = drawer.drawOptions()
    opts.bondLineWidth = 4
    opts.baseFontSize = 0.85
    opts.clearBackground = True
    opts.addAtomIndices = False
    drawer.DrawMolecule(mol)
    drawer.FinishDrawing()
    svg = drawer.GetDrawingText()
    return cairosvg.svg2png(bytestring=svg.encode('utf-8'))

# ---- CREATE FIGURE ----
fig = plt.figure(figsize=(28, 28))
gs = gridspec.GridSpec(4, 6, figure=fig, hspace=0.28, wspace=0.22,
                       height_ratios=[1.0, 1.0, 1.8, 1.8],
                       left=0.03, right=0.98, top=0.95, bottom=0.04)

fig.suptitle('Fig. 10  MolClaw Iterative Optimization — EGFR T790M Kinase Inhibitors',
             fontsize=18, fontweight='bold', y=0.988, color=DARK)

# ---- Panel A: Molecular gallery (2 rows x 3 cols) ----
for i, rd in enumerate(rounds_data):
    row = i // 3
    col_slice = slice(i%3*2, i%3*2+2)
    ax = fig.add_subplot(gs[row, col_slice])

    mol_img = draw_mol(rd['smiles'], size=(700,420))
    if mol_img:
        img = Image.open(BytesIO(mol_img))
        ax.imshow(img)

    ax.axis('off')
    color = GREEN if rd['best'] else DARK
    marker = '\u2605 ' if rd['best'] else ''
    title = f"{marker}{rd['round']}: {rd['name']}\nScore: {rd['score']:.1f} kcal/mol | MW: {rd['mw']:.0f} | LogP: {rd['logp']:.1f} | QED: {rd['qed']:.2f}"
    # Use larger text annotation instead of cramped title
    ax.text(0.5, 1.02, title, transform=ax.transAxes, fontsize=14,
            color=color, fontweight='bold' if rd['best'] else 'normal',
            ha='center', va='bottom',
            bbox=dict(boxstyle='round,pad=0.3', facecolor='white', alpha=0.9,
                      edgecolor=color, lw=1.5 if rd['best'] else 0.5))

# ---- Panel B: Score convergence + property trends ----
ax_b = fig.add_subplot(gs[2, 0:6])
rounds = [rd['round'] for rd in rounds_data]
scores = [rd['score'] for rd in rounds_data]
mws = [rd['mw'] for rd in rounds_data]
logps = [rd['logp'] for rd in rounds_data]
qeds = [rd['qed'] for rd in rounds_data]

x = np.arange(len(rounds))
# Score plot
color_main = [GREEN if rd['best'] else BLUE for rd in rounds_data]
ax_b.bar(x, [-s for s in scores], color=color_main, alpha=0.85, edgecolor='white', lw=0.5, width=0.6)
for i, s in enumerate(scores):
    ax_b.text(i, -s+0.1, f'{s:.1f}', ha='center', va='bottom', fontsize=12, fontweight='bold',
             color=GREEN if rounds_data[i]['best'] else DARK)
# Baseline
ax_b.axhline(y=8.6, color=RED, linestyle='--', lw=1.5, alpha=0.7)
ax_b.text(len(rounds)-0.5, 8.7, 'Erlotinib baseline (-8.6)', fontsize=11, color=RED, ha='right', va='bottom')
ax_b.set_xticks(x)
ax_b.set_xticklabels(rounds, fontsize=11)
ax_b.set_ylabel('Docking Score (-kcal/mol)', fontsize=12, fontweight='bold')
ax_b.set_title('(b) Score Convergence Trajectory', fontsize=13, fontweight='bold', loc='left', pad=8)
ax_b.grid(axis='y', alpha=0.3, linestyle='--')

# ---- Panel C: Property tracking ----
ax_c = fig.add_subplot(gs[3, 0:6])
width = 0.25
bars1 = ax_c.bar(x - width, mws, width, color='#3498DB', alpha=0.85, edgecolor='white', lw=0.5, label='MW (Da)')
bars2 = ax_c.bar(x, logps, width, color='#E74C3C', alpha=0.85, edgecolor='white', lw=0.5, label='LogP')
bars3 = ax_c.bar(x + width, [q*500 for q in qeds], width, color='#2ECC40', alpha=0.85, edgecolor='white', lw=0.5, label='QED \u00d7500')
for bar in bars1:
    ax_c.text(bar.get_x()+bar.get_width()/2, bar.get_height()+2, f'{bar.get_height():.0f}',
             ha='center', va='bottom', fontsize=11, color=DARK)
for bar in bars2:
    ax_c.text(bar.get_x()+bar.get_width()/2, bar.get_height()+0.05, f'{bar.get_height():.1f}',
             ha='center', va='bottom', fontsize=11, color=DARK)
ax_c.set_xticks(x)
ax_c.set_xticklabels(rounds, fontsize=11)
ax_c.set_title('(c) Physicochemical Property Trends', fontsize=13, fontweight='bold', loc='left', pad=8)
ax_c.legend(loc='upper left', fontsize=9, framealpha=0.9)
ax_c.grid(axis='y', alpha=0.3, linestyle='--')

# ---- Save ----
output_path = 'figures/molclaw_optimization_overview.png'
fig.savefig(output_path, dpi=300, bbox_inches='tight', facecolor='white', edgecolor='none')
from PIL import Image as PILImg
tmp = PILImg.open(output_path)
if tmp.mode == 'RGBA':
    bg = PILImg.new('RGB', tmp.size, (255,255,255))
    bg.paste(tmp, mask=tmp.split()[3])
    bg.save(output_path, dpi=(300,300))
plt.close()
print(f'Fig. 10 saved: {output_path}')
