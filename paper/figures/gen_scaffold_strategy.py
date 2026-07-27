#!/usr/bin/env python3
"""Regenerate molclaw_scaffold_strategy.png with clear R1-R6 labels ON the molecule.
Reviewer: text on the right side too small, which atoms are R1,R2,R3 needs labeling."""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
from rdkit import Chem
from rdkit.Chem import Draw, AllChem
from rdkit.Chem.Draw import rdMolDraw2D
from io import BytesIO
from PIL import Image
import numpy as np
import warnings
warnings.filterwarnings('ignore')

plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.size': 18,
    'axes.titlesize': 20,
    'axes.labelsize': 18,
    'figure.facecolor': 'white',
    'savefig.dpi': 300,
    'savefig.bbox': 'tight',
})

BLUE = '#2E86C1'; RED_C = '#E74C3C'; GREEN = '#27AE60'
PURPLE = '#8E44AD'; YELLOW = '#D4AC0D'; DARK = '#2C3E50'

# ======== SCAFFOLD DATA ========
scaffold_smiles = 'COCCOc1cc2ncnc(Nc3ccccc3)c2cc1OCCOC'

r_groups = {
    'R₁': dict(position='gatekeeper', best='CF₃', strategy='Exploration→Exploitation',
            score='-1.7 kcal/mol', desc='CF₃ outperforms ethynyl\nby ~0.5-0.8 kcal/mol',
            color=BLUE, atom_substituent='CF₃'),
    'R₂': dict(position='solvent region', best='OCH₂CF₃', strategy='Exploration→Pivot',
            score='~-0.5 kcal/mol', desc='Best single-site\nmodification; OH\nalso favorable',
            color=RED_C, atom_substituent='OCH₂CF₃'),
    'R₃': dict(position='solvent region', best='F', strategy='Exploration',
            score='~-0.3 kcal/mol', desc='F outperforms Cl\nby ~0.1-0.3 kcal/mol',
            color=GREEN, atom_substituent='F'),
    'R₅': dict(position='C2 position', best='CH₃', strategy='Exploitation',
            score='~-0.2 kcal/mol', desc='C2-methyl provides\nmodest improvement',
            color=PURPLE, atom_substituent='CH₃'),
    'R₆': dict(position='solvent-exposed', best='O(CH₂)₂OCH₃', strategy='Fixed (Erlotinib)',
            score='baseline scaffold', desc='Retained from parent\nerlotinib scaffold',
            color=YELLOW, atom_substituent='O(CH₂)₂OCH₃'),
}

# ======== Atom index mapping for R-group positions ========
# Based on the 4-anilinoquinazoline scaffold SMILES:
# COCCOc1cc2ncnc(Nc3ccccc3)c2cc1OCCOC
# R1: CF3 on aniline ring meta to NH -> atom 15 (one meta position)
# R2: OCH2CF3 on quinazoline -> atom 5 is the attachment C for O-substituent
# R3: F on quinazoline -> atom 20 (other side of quinazoline)
# R5: CH3 at C2 -> atom 9 is quinazoline C2
# R6: O(CH2)2OCH3 solvent-exposed -> atom 21 attachment or atoms 0-4 chain

# We'll annotate atoms near the modification sites
r_atom_map = {
    'R₁': [15],      # aniline meta position
    'R₂': [5],       # quinazoline position 6/7 (O-attachment site)
    'R₃': [20],      # quinazoline position (other side)
    'R₅': [9],       # C2 of quinazoline
    'R₆': [4, 21],   # ether chain attachment
}

# ======== DRAW MOLECULE WITH ATOM LABELS ========
def draw_scaffold_with_atom_labels(smiles, size=(1200, 800)):
    """Draw scaffold with large R-group labels at modification sites."""
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    AllChem.Compute2DCoords(mol)

    # Use MolDraw2DSVG and convert to PNG via cairosvg
    drawer = rdMolDraw2D.MolDraw2DSVG(size[0], size[1])
    opts = drawer.drawOptions()
    opts.bondLineWidth = 5
    opts.baseFontSize = 0.9
    opts.clearBackground = True
    opts.addAtomIndices = False
    opts.includeAtomTags = False
    opts.includeRadicals = False

    # Highlight atoms for each R-group with distinct colors
    highlight_atoms = []
    highlight_colors = {}
    for r_label, atom_indices in r_atom_map.items():
        info = r_groups[r_label]
        r, g, b = tuple(int(info['color'].lstrip('#')[i:i+2], 16) / 255 for i in (0, 2, 4))
        for ai in atom_indices:
            if ai < mol.GetNumAtoms():
                highlight_atoms.append(ai)
                highlight_colors[ai] = (r, g, b)

    drawer.DrawMolecule(mol, highlightAtoms=highlight_atoms,
                        highlightAtomColors=highlight_colors)
    drawer.FinishDrawing()
    svg_data = drawer.GetDrawingText()
    
    # Convert SVG to PNG using cairosvg
    try:
        import cairosvg
        png_data = cairosvg.svg2png(bytestring=svg_data.encode('utf-8'))
        img = Image.open(BytesIO(png_data))
    except ImportError:
        # Fallback: use Draw.MolToImage with highlights
        img = Draw.MolToImage(mol, size=size, highlightAtoms=highlight_atoms,
                              highlightAtomColors=highlight_colors)
    return img

def draw_atom_annotations(mol_img, size=(1200, 800)):
    """Overlay R-group labels on the molecule image using matplotlib."""
    fig, ax = plt.subplots(figsize=(size[0]/100, size[1]/100))
    ax.imshow(mol_img)
    ax.axis('off')

    # Atom 2D coordinates (RDKit layout positions)
    # We need the actual 2D positions from RDKit
    # Let's re-compute with coordinates
    mol = Chem.MolFromSmiles(scaffold_smiles)
    AllChem.Compute2DCoords(mol)
    conf = mol.GetConformer()

    # Map atom positions to image coordinates
    # RDKit coordinates need to be scaled to image dimensions
    xs = [conf.GetAtomPosition(i).x for i in range(mol.GetNumAtoms())]
    ys = [conf.GetAtomPosition(i).y for i in range(mol.GetNumAtoms())]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    pad = 0.1
    range_x = max_x - min_x + 2 * pad
    range_y = max_y - min_y + 2 * pad

    img_w, img_h = size

    def atom_to_img(i):
        x = conf.GetAtomPosition(i).x
        y = conf.GetAtomPosition(i).y
        ix = (x - min_x + pad) / range_x * img_w
        iy = img_h - (y - min_y + pad) / range_y * img_h  # flip y
        return ix, iy

    # Draw R-group labels
    for r_label, atom_indices in r_atom_map.items():
        info = r_groups[r_label]
        for ai in atom_indices:
            if ai < mol.GetNumAtoms():
                ix, iy = atom_to_img(ai)
                # Draw a colored circle behind the label
                ax.plot(ix, iy, 'o', color=info['color'], markersize=28, alpha=0.3, zorder=5)
                # Add offset label with arrow
                offset_x = 60 if ai % 2 == 0 else -60
                offset_y = 20 if ai < 13 else -20
                ax.annotate(
                    f'{r_label}', xy=(ix, iy),
                    xytext=(ix + offset_x, iy + offset_y),
                    fontsize=18, fontweight='bold', color=info['color'],
                    ha='center', va='center',
                    bbox=dict(boxstyle='round,pad=0.3', facecolor='white',
                             edgecolor=info['color'], linewidth=2, alpha=0.95),
                    arrowprops=dict(arrowstyle='->', color=info['color'], lw=2.5),
                    zorder=10
                )

    return fig

# ======== CREATE FINAL FIGURE ========
fig = plt.figure(figsize=(14, 10))

# ---- Left half: Scaffold molecule with labels ----
ax_mol = fig.add_axes([0.02, 0.12, 0.38, 0.80])
ax_mol.axis('off')

mol_img = draw_scaffold_with_atom_labels(scaffold_smiles, size=(1200, 800))
if mol_img:
    # Draw the molecule in the axis with annotations
    img_arr = np.array(mol_img)
    ax_mol.imshow(img_arr)

    # Now overlay R-group labels using the atom positions
    mol = Chem.MolFromSmiles(scaffold_smiles)
    AllChem.Compute2DCoords(mol)
    conf = mol.GetConformer()
    xs = [conf.GetAtomPosition(i).x for i in range(mol.GetNumAtoms())]
    ys = [conf.GetAtomPosition(i).y for i in range(mol.GetNumAtoms())]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    pad = 0.12
    range_x = max_x - min_x + 2 * pad
    range_y = max_y - min_y + 2 * pad
    img_w, img_h = 1200, 800
    center_y = sum(ys) / len(ys)

    for r_label, atom_indices in r_atom_map.items():
        info = r_groups[r_label]
        for ai in atom_indices:
            if ai < mol.GetNumAtoms():
                x = conf.GetAtomPosition(ai).x
                y = conf.GetAtomPosition(ai).y
                ix = (x - min_x + pad) / range_x * img_w
                iy = img_h - (y - min_y + pad) / range_y * img_h
                # Offset direction based on position
                ox = 50 if ix > img_w/2 else -50
                oy = 50 if y > center_y else -50
                ax_mol.annotate(
                    f'{r_label}', xy=(ix, iy),
                    xytext=(ix + ox, iy + oy),
                    fontsize=20, fontweight='bold', color=info['color'],
                    ha='center', va='center',
                    bbox=dict(boxstyle='round,pad=0.4', facecolor='white',
                             edgecolor=info['color'], linewidth=2.5, alpha=0.95),
                    arrowprops=dict(arrowstyle='->', color=info['color'], lw=3),
                    zorder=10
                )

ax_mol.set_title('4-Anilinoquinazoline Scaffold\n\u2014 Modification Sites \u2014',
                 fontsize=22, fontweight='bold', pad=12)

# ---- Right half: Detail cards (LARGER text) ----
gs_right = fig.add_gridspec(5, 1, left=0.45, right=0.99, top=0.93, bottom=0.07, hspace=0.15)

for i, (r_label, info) in enumerate(r_groups.items()):
    ax_card = fig.add_subplot(gs_right[i])
    ax_card.set_xlim(0, 12)
    ax_card.set_ylim(0, 1)
    ax_card.axis('off')

    # Background card
    card = FancyBboxPatch((0.05, 0.02), 11.8, 0.96, boxstyle="round,pad=0.12",
                          facecolor=info['color'], alpha=0.10,
                          edgecolor=info['color'], linewidth=2.5)
    ax_card.add_patch(card)

    # Left colored bar
    bar = FancyBboxPatch((0.05, 0.12), 0.12, 0.76, boxstyle="round,pad=0.03",
                         facecolor=info['color'], alpha=0.95)
    ax_card.add_patch(bar)

    # === LEFT COLUMN: R-label on top, Best substituent below ===
    ax_card.text(0.3, 0.80, f'{r_label}', fontsize=20, fontweight='bold',
                color=info['color'], va='center')
    ax_card.text(0.3, 0.50, f'{info["best"]}', fontsize=18, fontweight='bold',
                color=DARK, va='center')

    # === MIDDLE COLUMN: Strategy and Score vertically ===
    ax_card.text(5.0, 0.80, f'Strategy: {info["strategy"]}', fontsize=12,
                color='#555', va='center',
                bbox=dict(boxstyle='round,pad=0.3', facecolor='white', alpha=0.85,
                         edgecolor='#DDD'))
    ax_card.text(5.0, 0.50, info['score'], fontsize=14,
                color=GREEN, va='center', fontweight='bold')

    # === RIGHT: Description ===
    ax_card.text(9.0, 0.55, info['desc'], fontsize=12, color='#444',
                va='center', ha='left', linespacing=1.4)
fig.suptitle('Scaffold Modification Strategy \u2014 Best Substituent per Position',
             fontsize=24, fontweight='bold', y=0.99)

output_path = 'figures/molclaw_scaffold_strategy.png'
fig.savefig(output_path, dpi=300, bbox_inches='tight', facecolor='white', edgecolor='none')
plt.close()
print(f'Scaffold strategy saved: {output_path}')
