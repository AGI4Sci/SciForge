# Biology Room persistence

Biology Room is SciForge's persistent state service for sequence, genome-track,
and macromolecular-structure work. Viewer state and scientific annotations are
versioned separately from source files; the service never rewrites FASTA,
GenBank, PDB/mmCIF, GFF, BED, or VCF bytes.

There is no dedicated Biology Room renderer, preload namespace, IPC facade, or
MCP business path. Supported files enter the canonical Workspace Preview
manifest/provider chain. Callers that need persistent room state discover and
invoke the `biology-room.*` Broker capabilities through the same generic
capability transport used by every other domain.

## Supported formats

| Modality | Extensions | Viewer |
| --- | --- | --- |
| DNA/RNA/protein sequence | `.fa`, `.fasta`, `.fna`, `.faa` | Workspace Preview sequence contribution |
| Annotated sequence/plasmid | `.gb`, `.gbk` | Workspace Preview sequence contribution |
| Structure | `.pdb`, `.cif`, `.mmcif` | Workspace Preview molecular contribution |
| Genome feature | `.gff`, `.gff3`, `.bed` | Workspace Preview sequence contribution |
| Variant | `.vcf` | Workspace Preview sequence contribution |

Indexed FASTA accepts adjacent `.fai`; bgzip FASTA requires adjacent `.fai` and
`.gzi`. Compressed GFF3, BED, and VCF require an adjacent `.tbi` or `.csi`.
Remote viewer configurations and plugins are never loaded.

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
Renderer contributions must respect the same bounded observations and must not
buffer data beyond the provider limits.

## Agent interface

The generic capability surface exposes `biology-room.*` operations through
discover/observe/invoke/events. It does not create Biology-specific tool names.
Observation is bounded; mutation requires `roomId`, `baseRevision`, and typed
operations, and cannot modify biological source content.

Selection, viewport, camera, and track-visibility updates are non-destructive.
Asset/reference changes, persistent annotations, deletion, and revision restore
use the runtime's approval policy. Agent actor/task/turn provenance is supplied
by the runtime rather than trusted from model arguments.

## Main implementation areas

- Domain manifest and definition: `packages/domains/biology-room/sciforge.domain.json`, `src/definition.ts`
- Public contract: `packages/domains/biology-room/src/contract.ts`
- Persistent service and Broker contribution: `packages/domains/biology-room/src/service.ts`, `src/main.ts`
- Generic main composition: `src/main/modules/application-composition.ts`
- Generic renderer viewers: `src/renderer/src/workspace-preview/`

Focused validation:

```bash
npm --prefix packages/domains/biology-room test
npx vitest run \
  src/main/capabilities/app-registry.test.ts \
  src/renderer/src/workspace-preview/registry.test.ts
```

The hard multi-turn and interactive release matrix is documented in
`docs/biology-room-stress-suite.md`.
