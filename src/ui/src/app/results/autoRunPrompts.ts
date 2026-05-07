import type { ScenarioId } from '../../data';
import type { ObjectReference, PreviewDescriptor, RuntimeArtifact } from '../../domain';

export function handoffAutoRunPrompt(targetScenario: ScenarioId, artifact: RuntimeArtifact, sourceScenarioName: string, targetScenarioName: string): string {
  const focus = artifactFocusTerm(artifact);
  if (targetScenario === 'literature-evidence-review' && focus) {
    return `${focus} clinical trials，返回 paper-list JSON artifact、claims、ExecutionUnit。`;
  }
  if (targetScenario === 'structure-exploration' && focus) {
    return `分析 ${focus} 的结构，返回 structure-summary artifact、dataRef、质量指标和 ExecutionUnit。`;
  }
  if (targetScenario === 'biomedical-knowledge-graph' && focus) {
    return `${focus} gene/protein knowledge graph，返回 knowledge-graph、来源链接、数据库访问日期和 ExecutionUnit。`;
  }
  return [
    `消费 handoff artifact ${artifact.id} (${artifact.type})。`,
    `来源 Scenario: ${sourceScenarioName}。`,
    `请按${targetScenarioName}的 input contract 生成下一步 claims、ExecutionUnit、UIManifest 和 runtime artifact。`,
  ].join('\n');
}

export function previewPackageAutoRunPrompt(reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor): string {
  const target = path || descriptor?.ref || reference.ref;
  const ext = target.includes('.') ? target.split(/[?#]/)[0].split('.').pop() : undefined;
  return [
    `右侧预览点击了一个当前不支持内联 preview 的文件，但它仍然必须保持为可引用对象。`,
    `请为这个文件类型设计并实现一个 SciForge preview package 插件，然后自动尝试再次 preview/review。`,
    ``,
    `目标文件引用：${reference.ref}`,
    `目标文件路径：${target}`,
    `文件扩展名：${ext || 'unknown'}`,
    `当前 preview descriptor：${JSON.stringify({
      kind: descriptor?.kind,
      inlinePolicy: descriptor?.inlinePolicy,
      mimeType: descriptor?.mimeType,
      actions: descriptor?.actions,
      diagnostics: descriptor?.diagnostics,
    }, null, 2)}`,
    ``,
    `实施要求：`,
    `1. 先检查 packages/ui-components 下已有组件和 manifest，优先复用现有 package；不够再新增专门的 preview package。`,
    `2. 新 package 要包含 manifest、必要的 renderer/README/test，并接入 UI registry 或现有 preview 分发链路。`,
    `3. 未能完整渲染时要给用户明确 unsupported 状态和 fallback 操作，不能让右侧面板空白或崩溃。`,
    `4. 完成后运行相关测试/类型检查，并再次尝试聚焦 ${target}，报告 preview 是否已可用。`,
  ].join('\n');
}

function artifactFocusTerm(artifact: RuntimeArtifact): string | undefined {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  return asString(metadata.entity)
    || asString(metadata.accession)
    || asString(metadata.uniprotAccession)
    || asString(data.uniprotId)
    || asString(data.pdbId)
    || rowValue(data.rows, 'entity')
    || rowValue(data.rows, 'uniprot_accession')
    || nodeId(data.nodes, ['gene', 'protein']);
}

function rowValue(value: unknown, key: string): string | undefined {
  const rows = Array.isArray(value) ? value.filter(isRecord) : [];
  const found = rows.find((row) => asString(row.key)?.toLowerCase() === key.toLowerCase());
  return asString(found?.value);
}

function nodeId(value: unknown, preferredTypes: string[]): string | undefined {
  const nodes = Array.isArray(value) ? value.filter(isRecord) : [];
  const found = nodes.find((node) => {
    const type = asString(node.type)?.toLowerCase();
    return type ? preferredTypes.includes(type) : false;
  }) ?? nodes[0];
  return asString(found?.id) || asString(found?.label);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
