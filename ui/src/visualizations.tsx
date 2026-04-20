import { useEffect, useRef } from 'react';

export interface NetworkNodeInput {
  id?: string;
  label?: string;
  type?: string;
}

export interface NetworkEdgeInput {
  source?: string;
  target?: string;
}

export interface UmapPointInput {
  x: number;
  y: number;
  cluster?: string;
  label?: string;
}

export interface MoleculeViewerProps {
  pdbId?: string;
  ligand?: string;
  pocketLabel?: string;
  highlightResidues?: string[];
  atoms?: Array<{
    atomName?: string;
    residueName?: string;
    chain?: string;
    residueNumber?: string;
    element?: string;
    x: number;
    y: number;
    z: number;
    hetatm?: boolean;
  }>;
}

export interface HeatmapViewerProps {
  matrix?: number[][];
  label?: string;
}

export interface NetworkGraphProps {
  nodes?: NetworkNodeInput[];
  edges?: NetworkEdgeInput[];
}

export interface UmapViewerProps {
  points?: UmapPointInput[];
}

function fitCanvas(canvas: HTMLCanvasElement) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(320, canvas.clientWidth);
  const height = Math.max(260, canvas.clientHeight);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

export function MoleculeViewer({
  pdbId = 'runtime-structure',
  ligand = 'none',
  pocketLabel = 'Runtime structure',
  highlightResidues = [],
  atoms: runtimeAtoms = [],
}: MoleculeViewerProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    let frame = 0;
    let raf = 0;
    const sourceAtoms = runtimeAtoms.filter((atom) => [atom.x, atom.y, atom.z].every(Number.isFinite));
    if (!sourceAtoms.length) return undefined;
    const centroid = sourceAtoms.reduce((sum, atom) => ({
      x: sum.x + atom.x,
      y: sum.y + atom.y,
      z: sum.z + atom.z,
    }), { x: 0, y: 0, z: 0 });
    centroid.x /= sourceAtoms.length;
    centroid.y /= sourceAtoms.length;
    centroid.z /= sourceAtoms.length;
    const maxRadius = Math.max(1, ...sourceAtoms.map((atom) => Math.hypot(atom.x - centroid.x, atom.y - centroid.y, atom.z - centroid.z)));
    const atoms = sourceAtoms.map((atom) => {
      const element = (atom.element || '').toUpperCase();
      return {
        x: ((atom.x - centroid.x) / maxRadius) * 120,
        y: ((atom.y - centroid.y) / maxRadius) * 120,
        z: ((atom.z - centroid.z) / maxRadius) * 120,
        r: atom.hetatm ? 6.5 : atom.atomName === 'CA' || atom.atomName === 'P' ? 4.8 : 3.6,
        color: atom.hetatm ? '#FF7043' : element === 'O' ? '#4ECDC4' : element === 'N' ? '#7B93B0' : element === 'S' ? '#FFD54F' : '#00E5A0',
      };
    });

    const draw = () => {
      const fit = fitCanvas(canvas);
      if (!fit) return;
      const { ctx, width, height } = fit;
      frame += 0.012;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#0A0F1A';
      ctx.fillRect(0, 0, width, height);

      const projected = atoms.map((atom, index) => {
        const cos = Math.cos(frame);
        const sin = Math.sin(frame);
        const x = atom.x * cos - atom.z * sin;
        const z = atom.x * sin + atom.z * cos;
        return {
          ...atom,
          index,
          px: width / 2 + x,
          py: height / 2 + atom.y,
          depth: z,
          scale: 0.75 + (z + 100) / 360,
        };
      }).sort((a, b) => a.depth - b.depth);

      ctx.strokeStyle = 'rgba(123,147,176,0.28)';
      ctx.lineWidth = 2;
      for (let i = 1; i < projected.length; i += 1) {
        const a = projected.find((p) => p.index === i - 1);
        const b = projected.find((p) => p.index === i);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.px, a.py);
        ctx.lineTo(b.px, b.py);
        ctx.stroke();
      }

      projected.forEach((atom) => {
        const radius = atom.r * atom.scale;
        const gradient = ctx.createRadialGradient(atom.px - radius / 3, atom.py - radius / 3, 1, atom.px, atom.py, radius);
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(0.18, atom.color);
        gradient.addColorStop(1, 'rgba(5,8,16,0.85)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(atom.px, atom.py, radius, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = '#00E5A0';
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillText(`${pocketLabel} (${sourceAtoms.length} parsed atoms)`, 22, height - 24);
      ctx.fillStyle = '#B0C4D8';
      ctx.fillText(`PDB:${pdbId} ligand:${ligand}`, 22, 24);
      if (highlightResidues.length) {
        ctx.fillStyle = '#FFD54F';
        ctx.fillText(`residues: ${highlightResidues.slice(0, 4).join(',')}`, 22, 44);
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [highlightResidues, ligand, pdbId, pocketLabel, runtimeAtoms]);

  return <canvas ref={ref} className="viz-canvas" aria-label="Molecule viewer" />;
}

export function HeatmapViewer({ matrix, label = 'Top variable genes x samples' }: HeatmapViewerProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const fit = fitCanvas(canvas);
    if (!fit) return;
    const { ctx, width, height } = fit;
    ctx.fillStyle = '#0A0F1A';
    ctx.fillRect(0, 0, width, height);
    if (!matrix?.length || !matrix[0]?.length) {
      ctx.fillStyle = '#B0C4D8';
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillText('No runtime heatmap matrix', 34, 34);
      return;
    }
    const rows = matrix.length;
    const cols = matrix[0].length;
    const margin = 34;
    const cell = Math.min((width - margin * 2) / cols, (height - margin * 2) / rows);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const v = matrix[r]?.[c] ?? 0;
        const color = v > 0 ? `rgba(255,112,67,${Math.min(0.95, 0.25 + v * 0.28)})` : `rgba(78,205,196,${Math.min(0.95, 0.25 - v * 0.28)})`;
        ctx.fillStyle = color;
        ctx.fillRect(margin + c * cell, margin + r * cell, cell - 2, cell - 2);
      }
    }
    ctx.fillStyle = '#B0C4D8';
    ctx.font = '12px JetBrains Mono, monospace';
    ctx.fillText(label, margin, 20);
  }, [label, matrix]);

  return <canvas ref={ref} className="viz-canvas" aria-label="Heatmap" />;
}

export function NetworkGraph({ nodes: inputNodes, edges: inputEdges }: NetworkGraphProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    let raf = 0;
    let tick = 0;
    const nodes: Array<{ id: string; label: string; type?: string }> = inputNodes?.length
      ? inputNodes.map((node, index) => ({
        id: node.id || node.label || `node-${index}`,
        label: node.label || node.id || `Node ${index + 1}`,
        type: node.type,
      }))
      : [];
    const indexById = new Map(nodes.map((node, index) => [node.id, index]));
    const edges = inputEdges?.length
      ? inputEdges.flatMap((edge) => {
        const source = edge.source ? indexById.get(edge.source) : undefined;
        const target = edge.target ? indexById.get(edge.target) : undefined;
        return source === undefined || target === undefined ? [] : [[source, target] as [number, number]];
      })
      : [];
    const draw = () => {
      const fit = fitCanvas(canvas);
      if (!fit) return;
      const { ctx, width, height } = fit;
      tick += 0.01;
      ctx.fillStyle = '#0A0F1A';
      ctx.fillRect(0, 0, width, height);
      if (!nodes.length) {
        ctx.fillStyle = '#B0C4D8';
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText('No runtime graph nodes', 24, 24);
        return;
      }
      const positions = nodes.map((_, i) => {
        const angle = (i / nodes.length) * Math.PI * 2 + tick;
        const radius = i === 0 ? 0 : Math.min(width, height) * 0.28 + Math.sin(tick * 2 + i) * 10;
        return {
          x: width / 2 + Math.cos(angle) * radius,
          y: height / 2 + Math.sin(angle) * radius * 0.8,
        };
      });
      ctx.strokeStyle = 'rgba(90,112,145,0.5)';
      edges.forEach(([a, b]) => {
        ctx.beginPath();
        ctx.moveTo(positions[a].x, positions[a].y);
        ctx.lineTo(positions[b].x, positions[b].y);
        ctx.stroke();
      });
      positions.forEach((pos, i) => {
        const color = i === 0 ? '#00E5A0' : nodes[i].type === 'drug' || i < 3 ? '#FF7043' : '#4ECDC4';
        ctx.fillStyle = `${color}33`;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, i === 0 ? 34 : 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.fillStyle = '#E8EDF5';
        ctx.font = i === 0 ? '700 13px DM Sans' : '11px DM Sans';
        ctx.textAlign = 'center';
        ctx.fillText(nodes[i].label.slice(0, 14), pos.x, pos.y + 4);
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [inputEdges, inputNodes]);

  return <canvas ref={ref} className="viz-canvas" aria-label="Network graph" />;
}

export function UmapViewer({ points }: UmapViewerProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const fit = fitCanvas(canvas);
    if (!fit) return;
    const { ctx, width, height } = fit;
    ctx.fillStyle = '#0A0F1A';
    ctx.fillRect(0, 0, width, height);
    if (points?.length) {
      const colors = ['#00E5A0', '#FF7043', '#4ECDC4', '#FFD54F', '#3D7AED'];
      const clusters = Array.from(new Set(points.map((point) => point.cluster || 'cluster')));
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      points.forEach((point) => {
        const color = colors[Math.max(0, clusters.indexOf(point.cluster || 'cluster')) % colors.length];
        const x = 32 + ((point.x - minX) / Math.max(1e-6, maxX - minX)) * (width - 64);
        const y = 32 + ((point.y - minY) / Math.max(1e-6, maxY - minY)) * (height - 64);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.74;
        ctx.beginPath();
        ctx.arc(x, y, 3.6, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#B0C4D8';
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillText(`UMAP ${points.length} samples`, 24, 24);
      return;
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#B0C4D8';
    ctx.font = '12px JetBrains Mono, monospace';
    ctx.fillText('No runtime UMAP points', 24, 24);
  }, [points]);

  return <canvas ref={ref} className="viz-canvas" aria-label="UMAP" />;
}
