import { getI18n, useTranslation } from 'react-i18next'

const requirementsMessages: Readonly<Record<string, string>> = {
  "AI 补全": "Complete with AI",
  "等待负责人确认需求后即可接受邀请。": "Wait for the owner to confirm requirements before accepting the invitation.",
  "手动编辑工作模块与验收标准": "Edit work modules and acceptance criteria",
  "模块标题": "Module title",
  "模块目标": "Module objective",
  "依赖模块": "Module dependencies",
  "必交文件": "Required output file",
  "文件名": "File name",
  "文件媒体类型": "File media type",
  "文件大小上限（字节）": "Maximum file size (bytes)",
  "验证方式": "Evidence method",
  "删除标准": "Remove criterion",
  "添加验收标准": "Add acceptance criterion",
  "删除模块": "Remove module",
  "添加工作模块": "Add work module",
  "项目验收标准": "Project acceptance criteria",
  "项目整体": "Overall project",
  "未找到对应工作模块": "Work module not found",
  "草稿待确认": "Draft ready for confirmation",
  "存在未保存的修改，请先保存再补全或确认。": "Save your changes before AI completion or confirmation.",
  "请填写有效的模块、文件与验收信息；依赖不得循环或引用已删除模块。": "Enter valid modules, output files and acceptance criteria. Dependencies must not contain cycles or missing modules.",
  "AI 补全需求": "Complete requirements with AI",
  "AI 将根据已保存的目标与边界重新生成工作模块和验收标准，替换其中的手动内容。是否继续？": "AI will regenerate work modules and acceptance criteria from the saved goals and boundaries, replacing manual content in those sections. Continue?",
  "继续 AI 补全": "Continue AI completion",
  "可手动编辑，也可选择 AI 补全；每个模块对应一张任务卡": "Edit manually or use optional AI completion; each module corresponds to one task card",
  "添加工作模块后保存，或保存目标与边界后选择 AI 补全。": "Add work modules and save, or save goals and boundaries before choosing AI completion."
}

const prefix = 'collaborationWorkspace.'
export type WorkspaceTranslationValues = Readonly<Record<string, string | number>>

/** Only explicit package-owned UI strings enter this translation boundary. */
export function translateWorkspace(source: string, values: WorkspaceTranslationValues = {}): string {
  const i18n = getI18n()
  if (!i18n?.isInitialized) return source.replace(/\{\{(\w+)\}\}/gu, (_, key: string) => String(values[key] ?? `{{${key}}}`))
  const defaultValue = i18n.resolvedLanguage?.startsWith('en') || i18n.language?.startsWith('en') ? requirementsMessages[source] ?? source : source
  return String(i18n.t(`${prefix}${source}`, { ns: 'common', keySeparator: false, defaultValue, ...values }))
}

export function useWorkspaceTranslation(): typeof translateWorkspace {
  useTranslation('common')
  return translateWorkspace
}

export function workspaceTranslationResources(messages: Readonly<Record<string, string>>, language: 'en' | 'zh'): Record<string, string> {
  return Object.fromEntries(Object.entries(messages).map(([source, english]) => [`${prefix}${source}`, language === 'en' ? english : source]))
}
