import type { ObjectReference, PreviewDescriptor } from '@sciforge-ui/runtime-contract';

export interface PreviewPackageAutoRunPromptRequest {
  reference: ObjectReference;
  path?: string;
  descriptor?: PreviewDescriptor;
}

export function previewPackageAutoRunPromptPolicy({
  reference,
  path,
  descriptor,
}: PreviewPackageAutoRunPromptRequest): string {
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
    `1. 先检查 packages/presentation/components 下已有组件和 manifest，优先复用现有 package；不够再新增专门的 preview package。`,
    `2. 新 package 要包含 manifest、必要的 renderer/README/test，并接入 UI registry 或现有 preview 分发链路。`,
    `3. 未能完整渲染时要给用户明确 unsupported 状态和 fallback 操作，不能让右侧面板空白或崩溃。`,
    `4. 完成后运行相关测试/类型检查，并再次尝试聚焦 ${target}，报告 preview 是否已可用。`,
  ].join('\n');
}
