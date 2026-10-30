export type SciForgeTaskSummaryInput = Readonly<{
  title: string
  goal?: string
  result?: string
  completedAt: string
}>

const clean = (value: string | undefined, limit = 12_000): string =>
  (value ?? '').trim().slice(0, limit)

export function renderSciForgeTaskSummary(input: SciForgeTaskSummaryInput): string {
  const section = (title: string, body: string): string => body ? `\n## ${title}\n${body}\n` : ''
  const title = clean(input.title, 200) || '未命名任务'
  return [
    `# 本轮总结：${title}`,
    '',
    `- 记录时间：${clean(input.completedAt, 64)}`,
    '- 来源：SciForge',
    section('任务目标', clean(input.goal)),
    section('本轮结果', clean(input.result))
  ].join('\n').trim() + '\n'
}

