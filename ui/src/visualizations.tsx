import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { createViewer, SurfaceType, type GLViewer } from '3dmol';

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
  structureUrl?: string;
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

type MoleculeStyle = 'cartoon' | 'sticks' | 'spheres' | 'surface';
type ResidueRange = `${number}-${number}`;

function cx(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
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

function inferStructureFormat(url: string, fallback: 'pdb' | 'cif' = 'pdb') {
  const cleanUrl = url.split('?')[0]?.split('#')[0]?.toLowerCase() || '';
  if (cleanUrl.endsWith('.cif') || cleanUrl.endsWith('.mmcif')) return 'cif';
  if (cleanUrl.endsWith('.pdb')) return 'pdb';
  if (cleanUrl.endsWith('.sdf')) return 'sdf';
  if (cleanUrl.endsWith('.mol2')) return 'mol2';
  return fallback;
}

function residueSelection(residues: string[]) {
  const ranges = residues
    .map((residue) => residue.trim())
    .flatMap((residue): Array<number | ResidueRange> => {
      if (/^\d+$/.test(residue)) return [Number.parseInt(residue, 10)];
      if (/^\d+-\d+$/.test(residue)) return [residue as ResidueRange];
      return [];
    })
    .filter(Boolean);
  return ranges.length ? { resi: ranges } : undefined;
}

function atomElement(atom: NonNullable<MoleculeViewerProps['atoms']>[number]) {
  const explicit = atom.element?.trim();
  if (explicit) return explicit.slice(0, 2).toUpperCase();
  const guessed = atom.atomName?.replace(/[0-9]/g, '').trim();
  return guessed ? guessed.slice(0, 2).toUpperCase() : 'C';
}

function atomRecord(atom: NonNullable<MoleculeViewerProps['atoms']>[number], index: number) {
  const record = atom.hetatm ? 'HETATM' : 'ATOM';
  const serial = String(index + 1).padStart(5, ' ');
  const atomName = (atom.atomName || atomElement(atom)).slice(0, 4).padEnd(4, ' ');
  const residueName = (atom.residueName || 'UNK').slice(0, 3).padStart(3, ' ');
  const chain = (atom.chain || 'A').slice(0, 1);
  const residueNumber = String(Number.parseInt(atom.residueNumber || '', 10) || index + 1).padStart(4, ' ');
  const x = atom.x.toFixed(3).padStart(8, ' ');
  const y = atom.y.toFixed(3).padStart(8, ' ');
  const z = atom.z.toFixed(3).padStart(8, ' ');
  const element = atomElement(atom).padStart(2, ' ');
  return `${record.padEnd(6, ' ')}${serial} ${atomName} ${residueName} ${chain}${residueNumber}    ${x}${y}${z}  1.00 20.00          ${element}`;
}

function pdbFromAtoms(atoms: MoleculeViewerProps['atoms'] = []) {
  const usableAtoms = atoms.filter((atom) => [atom.x, atom.y, atom.z].every(Number.isFinite));
  if (!usableAtoms.length) return '';
  return `${usableAtoms.map(atomRecord).join('\n')}\nEND\n`;
}

function browserCanUseWebGL() {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl') || probe.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

function applyMoleculeStyle(viewer: GLViewer, style: MoleculeStyle, highlightResidues: string[]) {
  viewer.setStyle({}, {});
  viewer.removeAllSurfaces();
  if (style === 'cartoon') {
    viewer.setStyle({ hetflag: false }, { cartoon: { color: 'spectrum' } });
    viewer.setStyle({ hetflag: true }, { stick: { radius: 0.22, colorscheme: 'orangeCarbon' }, sphere: { scale: 0.24 } });
  }
  if (style === 'sticks') {
    viewer.setStyle({}, { stick: { radius: 0.16, colorscheme: 'Jmol' } });
  }
  if (style === 'spheres') {
    viewer.setStyle({}, { sphere: { scale: 0.28, colorscheme: 'Jmol' } });
  }
  if (style === 'surface') {
    viewer.setStyle({ hetflag: false }, { cartoon: { color: 'spectrum', opacity: 0.55 } });
    viewer.setStyle({ hetflag: true }, { stick: { radius: 0.24, colorscheme: 'orangeCarbon' } });
    viewer.addSurface(SurfaceType.VDW, { opacity: 0.58, color: '#4ECDC4' }, { hetflag: false });
  }
  const selection = residueSelection(highlightResidues);
  if (selection) {
    viewer.addStyle(selection, { cartoon: { color: '#FFD54F', thickness: 0.7 }, stick: { radius: 0.24, color: '#FFD54F' } });
  }
  viewer.render();
}

function elementColor(atom: NonNullable<MoleculeViewerProps['atoms']>[number]) {
  if (atom.hetatm) return '#FF7043';
  const element = atomElement(atom);
  if (element === 'O') return '#4ECDC4';
  if (element === 'N') return '#7B93B0';
  if (element === 'S') return '#FFD54F';
  if (element === 'P') return '#F43F5E';
  return '#00E5A0';
}

function FallbackMoleculeCanvas({
  atoms,
  pdbId,
  ligand,
  pocketLabel,
  style,
  spinning,
  resetSignal,
}: {
  atoms: NonNullable<MoleculeViewerProps['atoms']>;
  pdbId: string;
  ligand: string;
  pocketLabel: string;
  style: MoleculeStyle;
  spinning: boolean;
  resetSignal: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef({ rx: -0.35, ry: 0.55, zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef<{ x: number; y: number; button: number } | null>(null);
  const sourceAtoms = useMemo(() => atoms.filter((atom) => [atom.x, atom.y, atom.z].every(Number.isFinite)), [atoms]);

  useEffect(() => {
    viewRef.current = { rx: -0.35, ry: 0.55, zoom: 1, panX: 0, panY: 0 };
  }, [resetSignal]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !sourceAtoms.length) return undefined;
    let raf = 0;
    const centroid = sourceAtoms.reduce((sum, atom) => ({
      x: sum.x + atom.x,
      y: sum.y + atom.y,
      z: sum.z + atom.z,
    }), { x: 0, y: 0, z: 0 });
    centroid.x /= sourceAtoms.length;
    centroid.y /= sourceAtoms.length;
    centroid.z /= sourceAtoms.length;
    const maxRadius = Math.max(1, ...sourceAtoms.map((atom) => Math.hypot(atom.x - centroid.x, atom.y - centroid.y, atom.z - centroid.z)));
    const normalized = sourceAtoms.map((atom) => ({
      x: (atom.x - centroid.x) / maxRadius,
      y: (atom.y - centroid.y) / maxRadius,
      z: (atom.z - centroid.z) / maxRadius,
      color: elementColor(atom),
      r: atom.hetatm ? 5.8 : atom.atomName === 'CA' || atom.atomName === 'P' ? 4.6 : 3.4,
      residue: [atom.residueName, atom.chain, atom.residueNumber].filter(Boolean).join(':'),
    }));

    const draw = () => {
      const fit = fitCanvas(canvas);
      if (!fit) return;
      const { ctx, width, height } = fit;
      if (spinning) viewRef.current.ry += 0.01;
      const { rx, ry, zoom, panX, panY } = viewRef.current;
      const sinX = Math.sin(rx);
      const cosX = Math.cos(rx);
      const sinY = Math.sin(ry);
      const cosY = Math.cos(ry);
      const scale = Math.min(width, height) * 0.36 * zoom;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#0A0F1A';
      ctx.fillRect(0, 0, width, height);

      const projected = normalized.map((atom, index) => {
        const x1 = atom.x * cosY - atom.z * sinY;
        const z1 = atom.x * sinY + atom.z * cosY;
        const y1 = atom.y * cosX - z1 * sinX;
        const z2 = atom.y * sinX + z1 * cosX;
        return {
          ...atom,
          index,
          px: width / 2 + panX + x1 * scale,
          py: height / 2 + panY + y1 * scale,
          depth: z2,
          radius: atom.r * (style === 'spheres' ? 1.8 : style === 'sticks' ? 0.72 : 1) * (0.85 + (z2 + 1) * 0.18),
        };
      }).sort((a, b) => a.depth - b.depth);

      if (style !== 'spheres') {
        ctx.strokeStyle = style === 'surface' ? 'rgba(78,205,196,0.18)' : 'rgba(123,147,176,0.24)';
        ctx.lineWidth = style === 'sticks' ? 2 : 1.2;
        for (let index = 1; index < projected.length; index += 1) {
          const a = projected[index - 1];
          const b = projected[index];
          if (!a || !b) continue;
          const distance = Math.hypot(a.px - b.px, a.py - b.py);
          if (distance > scale * 0.18) continue;
          ctx.beginPath();
          ctx.moveTo(a.px, a.py);
          ctx.lineTo(b.px, b.py);
          ctx.stroke();
        }
      }

      projected.forEach((atom) => {
        const radius = Math.max(1.4, atom.radius);
        const gradient = ctx.createRadialGradient(atom.px - radius / 3, atom.py - radius / 3, 1, atom.px, atom.py, radius);
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(0.2, atom.color);
        gradient.addColorStop(1, 'rgba(5,8,16,0.82)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(atom.px, atom.py, radius, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = '#B0C4D8';
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillText(`${pdbId} · ${ligand}`, 18, 24);
      ctx.fillStyle = '#00E5A0';
      ctx.fillText(`${pocketLabel} · software 3D fallback · ${sourceAtoms.length} atoms`, 18, height - 18);
      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [ligand, pdbId, pocketLabel, sourceAtoms, spinning, style]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, button: event.button };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    dragRef.current = { ...drag, x: event.clientX, y: event.clientY };
    if (event.shiftKey || drag.button === 1) {
      viewRef.current.panX += dx;
      viewRef.current.panY += dy;
    } else {
      viewRef.current.ry += dx * 0.01;
      viewRef.current.rx += dy * 0.01;
    }
  };
  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const nextZoom = viewRef.current.zoom * (event.deltaY > 0 ? 0.9 : 1.1);
    viewRef.current.zoom = Math.min(5, Math.max(0.25, nextZoom));
  };

  if (!sourceAtoms.length) {
    return <div className="molecule-canvas molecule-empty">WebGL unavailable and no preview atoms were returned.</div>;
  }

  return (
    <canvas
      ref={ref}
      className="molecule-canvas molecule-canvas-fallback"
      aria-label={`${pocketLabel} software molecule viewer`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => { dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}
      onWheel={onWheel}
    />
  );
}

export function MoleculeViewer({
  pdbId = 'runtime-structure',
  ligand = 'none',
  pocketLabel = 'Runtime structure',
  structureUrl,
  highlightResidues = [],
  atoms: runtimeAtoms = [],
}: MoleculeViewerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<GLViewer | null>(null);
  const [style, setStyle] = useState<MoleculeStyle>('cartoon');
  const [spinning, setSpinning] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const localPdb = useMemo(() => pdbFromAtoms(runtimeAtoms), [runtimeAtoms]);

  useEffect(() => {
    const container = ref.current;
    if (!container || webglUnavailable) return undefined;
    let cancelled = false;
    let viewer: GLViewer;
    if (!browserCanUseWebGL()) {
      setWebglUnavailable(true);
      setStatus(runtimeAtoms.length ? 'ready' : 'error');
      setError('WebGL unavailable');
      return undefined;
    }
    try {
      viewer = createViewer(container, {
        backgroundColor: '#0A0F1A',
        antialias: true,
        cartoonQuality: 10,
      });
    } catch (viewerError) {
      setWebglUnavailable(true);
      setStatus(runtimeAtoms.length ? 'ready' : 'error');
      setError(viewerError instanceof Error ? `WebGL unavailable: ${viewerError.message}` : 'WebGL unavailable');
      return undefined;
    }
    viewerRef.current = viewer;
    const resizeObserver = new ResizeObserver(() => {
      viewer.resize();
      viewer.render();
    });
    resizeObserver.observe(container);

    async function loadStructure() {
      setStatus('loading');
      setError('');
      try {
        let structureText = '';
        let format = 'pdb';
        if (structureUrl) {
          const response = await fetch(structureUrl, { mode: 'cors' });
          if (!response.ok) throw new Error(`coordinates fetch failed: ${response.status}`);
          structureText = await response.text();
          format = inferStructureFormat(structureUrl, structureText.startsWith('data_') ? 'cif' : 'pdb');
        } else {
          structureText = localPdb;
        }
        if (!structureText.trim()) throw new Error('no coordinate text available');
        if (cancelled) return;
        viewer.clear();
        viewer.addModel(structureText, format);
        applyMoleculeStyle(viewer, style, highlightResidues);
        viewer.zoomTo();
        viewer.render();
        setStatus('ready');
      } catch (loadError) {
        if (cancelled) return;
        if (localPdb) {
          viewer.clear();
          viewer.addModel(localPdb, 'pdb');
          applyMoleculeStyle(viewer, style, highlightResidues);
          viewer.zoomTo();
          viewer.render();
          setStatus('ready');
          setError(loadError instanceof Error ? loadError.message : 'coordinate fetch failed; rendered artifact atoms');
          return;
        }
        setStatus('error');
        setError(loadError instanceof Error ? loadError.message : 'failed to load molecular coordinates');
      }
    }

    void loadStructure();
    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      viewer.spin(false);
      viewer.clear();
      viewerRef.current = null;
    };
  }, [highlightResidues, localPdb, structureUrl]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== 'ready' || webglUnavailable) return;
    applyMoleculeStyle(viewer, style, highlightResidues);
    viewer.spin(spinning ? 'y' : false, 0.7);
  }, [highlightResidues, spinning, status, style, webglUnavailable]);

  const resetView = () => {
    const viewer = viewerRef.current;
    if (!viewer || webglUnavailable) {
      setResetSignal((value) => value + 1);
      return;
    }
    viewer.zoomTo();
    viewer.render();
  };

  const toggleSpin = () => {
    setSpinning((value) => !value);
  };

  return (
    <div className="molecule-viewer-shell">
      <div className="molecule-toolbar" aria-label="Molecule viewer controls">
        <div className="molecule-segmented" role="group" aria-label="Representation">
          {(['cartoon', 'sticks', 'spheres', 'surface'] as MoleculeStyle[]).map((mode) => (
            <button key={mode} className={cx('molecule-mode-button', style === mode && 'active')} type="button" onClick={() => setStyle(mode)}>
              {mode}
            </button>
          ))}
        </div>
        <button className="icon-button" type="button" title="Reset view" aria-label="Reset view" onClick={resetView}>
          <RotateCcw size={15} />
        </button>
        <button className="icon-button" type="button" title={spinning ? 'Stop spin' : 'Start spin'} aria-label={spinning ? 'Stop spin' : 'Start spin'} onClick={toggleSpin}>
          {spinning ? <Pause size={15} /> : <Play size={15} />}
        </button>
      </div>
      {webglUnavailable ? (
        <FallbackMoleculeCanvas
          atoms={runtimeAtoms}
          pdbId={pdbId}
          ligand={ligand}
          pocketLabel={pocketLabel}
          style={style}
          spinning={spinning}
          resetSignal={resetSignal}
        />
      ) : (
        <div ref={ref} className="molecule-canvas" aria-label={`${pocketLabel} molecule viewer`} />
      )}
      <div className="molecule-status">
        <code>{pdbId}</code>
        <code>ligand={ligand}</code>
        <code>{runtimeAtoms.length} artifact atoms</code>
        {webglUnavailable ? <code>software 3D fallback</code> : null}
        {status === 'loading' ? <code>loading coordinates</code> : null}
        {error ? <code title={error}>fallback={error}</code> : null}
      </div>
    </div>
  );
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
