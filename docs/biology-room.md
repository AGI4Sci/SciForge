# Biology Room

Biology Room is SciForge's persistent, chat-adjacent workbench for sequence,
genome-track, and macromolecular-structure files. Viewer state and scientific
annotations are versioned separately from the source files; Biology Room never
rewrites FASTA, GenBank, PDB/mmCIF, GFF, BED, or VCF bytes.

## Open a room

- Open any supported file from Files, chat scientific objects, or another workspace-file link;
  SciForge routes it directly into Biology Room.
- A GFF3, BED, or VCF track can be opened before its reference. The viewer stays
  blocked until the user selects a real FASTA assembly.

The workbench contains an Assets/Tracks rail, a central lazy-loaded viewer, and
Selection, Annotations, Versions, and Provenance inspectors. Its single component
tree adapts from the full three-pane layout to a horizontal asset rail and stacked
inspector in a narrow right sidebar, so the scientific viewer keeps a usable width.
**Add selection to
chat** sends the source path and SHA-256, a human-readable coordinate label, the
exact zero-based half-open selection JSON, room revision, and matching
non-orphaned annotations to the composer.

## Supported formats

| Modality | Extensions | Viewer |
| --- | --- | --- |
| DNA/RNA/protein sequence | `.fa`, `.fasta`, `.fna`, `.faa` | SeqViz linear/circular |
| Annotated sequence/plasmid | `.gb`, `.gbk` | SeqViz linear/circular |
| Structure | `.pdb`, `.cif`, `.mmcif` | Mol* 3D |
| Genome feature | `.gff`, `.gff3`, `.bed` | JBrowse linear genome view |
| Variant | `.vcf` | JBrowse linear genome view |

Indexed FASTA accepts adjacent `.fai`; bgzip FASTA requires adjacent `.fai` and
`.gzi`. Compressed GFF3, BED, and VCF require an adjacent `.tbi` or `.csi`.
Remote JBrowse configurations and plugins are never loaded.

Common indexing commands (run outside SciForge) include:

```bash
samtools faidx genome.fa
bgzip -i genome.fa
samtools faidx genome.fa.gz
tabix -p gff genes.gff3.gz
tabix -p bed regions.bed.gz
tabix -p vcf variants.vcf.gz
```

SciForge does not bgzip, index, copy, or otherwise rewrite user source files.

## Coordinates and stable identity

- Internal sequence/genome ranges are zero-based, half-open: `[start, end)`.
- GenBank and VCF/UI coordinates are converted only at parser/viewer boundaries.
- Molecular selections persist model, author-chain, author-residue, insertion
  code, residue, and atom identifiers. Mol* runtime `Loci` objects are never
  written to a room manifest.

## Persistence and concurrency

Room state is stored in the workspace:

```text
.sciforge/biology/rooms/<room-id>/
  room.json
  revisions/<revision>.json
  events.ndjson
```

Writes use optimistic `baseRevision` checks, a cross-process room lock, immutable
revision snapshots, and a recovery journal. A stale user/agent write returns a
revision conflict instead of overwriting newer state. External source changes
are fingerprinted and refresh the open viewer; invalid selections are cleared
and invalid annotations become orphaned.

Default limits are 25 MiB per unindexed asset and 100 MiB of source assets per
room. Large/random-access data must use the standard indexes above.
The full-record SeqViz surface also has a 25 MiB decoded-text safety bound;
larger indexed FASTA references are navigated through a linked genome track in
JBrowse instead of being buffered as one sequence document.

## Agent interface

The workspace-intel MCP surface exposes only two state-only tools while the same
room is active in visible GUI context:

- `biology_room_observe`: bounded room, selection, visible-track, annotation,
  viewer-state, and source-hash summary.
- `biology_room_apply`: typed operations with `roomId`, `baseRevision`, and
  optional `dryRun`; it cannot modify biological source content.

Selection, viewport, camera, and track-visibility updates are non-destructive.
Asset/reference changes, persistent annotations, deletion, and revision restore
use the runtime's approval policy. Agent actor/task/turn provenance is supplied
by the runtime rather than trusted from model arguments.

## Main implementation areas

- Shared contract: `src/shared/biology-room.ts`
- Persistent service: `src/main/services/biology-room-service.ts`
- Desktop API/IPC: `src/shared/sciforge-api.ts`, `src/preload/index.ts`, and
  `src/main/ipc/register-app-ipc-handlers.ts`
- Agent tools: `src/main/biology-room-mcp-tools.ts`
- Workbench bridge: `src/renderer/src/components/BiologyRoomPanelBridge.tsx`
- Viewers and room shell: `src/renderer/src/biology-room/`

Focused validation:

```bash
npx vitest run \
  src/shared/biology-room.test.ts \
  src/main/services/biology-room-service.test.ts \
  src/main/biology-room-mcp-tools.test.ts \
  src/renderer/src/biology-room/biology-room.test.ts
```

The hard multi-turn and interactive release matrix is documented in
`docs/biology-room-stress-suite.md`.
