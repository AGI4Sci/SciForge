export const BIOLOGY_ROOM_MCP_SERVER_ID = 'gui_workspace_intel'
export const BIOLOGY_ROOM_OBSERVE_TOOL_NAME = 'biology_room_observe'
export const BIOLOGY_ROOM_APPLY_TOOL_NAME = 'biology_room_apply'

const NON_DESTRUCTIVE_BIOLOGY_ROOM_OPERATIONS = new Set([
  'setActiveAsset',
  'setSelection',
  'setViewport',
  'setTrackVisibility',
  'setMolecularView'
])

export function biologyRoomApplyRequiresApproval(args: Record<string, unknown>): boolean {
  if (args.dryRun === true) return false
  if (!Array.isArray(args.operations) || args.operations.length === 0) return true
  return args.operations.some((operation) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return true
    const type = (operation as { type?: unknown }).type
    return typeof type !== 'string' || !NON_DESTRUCTIVE_BIOLOGY_ROOM_OPERATIONS.has(type)
  })
}

export function isBiologyRoomApplyTool(serverId: string, toolName: string): boolean {
  return serverId === BIOLOGY_ROOM_MCP_SERVER_ID && toolName === BIOLOGY_ROOM_APPLY_TOOL_NAME
}

export function isBiologyRoomTool(serverId: string, toolName: string): boolean {
  return serverId === BIOLOGY_ROOM_MCP_SERVER_ID &&
    (toolName === BIOLOGY_ROOM_OBSERVE_TOOL_NAME || toolName === BIOLOGY_ROOM_APPLY_TOOL_NAME)
}

export function isBiologyRoomToolContext(requestText: string | undefined): boolean {
  if (!requestText) return false
  return /\b(active\s+biology\s+room|biology\s*room|fasta|genbank|gff3?|vcf|mmcif|pdb|dna|rna|genom(?:e|ic)|plasmid|contig|sequence|protein\s+structure|residue|molecular|variant|genome\s+track|active\s+site|selection|chain|atom)\b/i.test(requestText) ||
    /(生物工作台|生物房间|基因组|质粒|序列|蛋白结构|残基|分子结构|变异|基因轨道|活性位点|选择区域|原子|分子链)/u.test(requestText)
}
