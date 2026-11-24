import { expect, it } from 'vitest'
import { comparableMarkdown } from './markdown.js'

it('accepts real SiYuan export spacing, list markers and caret placeholders without discarding body text', () => {
  const submitted = '# 标题\n\n- 中文\n- **粗体**和`代码`\n\n```ts\nconst verified = true\n```\n\n第一行。  \n第二行。\n'
  const exported = '\n# 标题\n\n* 中文\n* **粗体**和\u200b`代码`\n\n```ts\nconst verified = true\n```\n\n第一行。  \n第二行。\n\n'
  expect(comparableMarkdown(exported)).toBe(comparableMarkdown(submitted))
})

it('accepts caret separators between adjacent native references while preserving their targets and labels', () => {
  const first = "((20261112173441-hw6jkxg '20261112173441-hw6jkxg'))"
  const second = "((20261112173447-8guqvxe '20261112173447-8guqvxe'))"
  expect(comparableMarkdown(first + '\u200b' + second)).toBe(comparableMarkdown(first + second))
  expect(comparableMarkdown(first + '\u200b正文')).not.toBe(comparableMarkdown(first + '正文'))
  expect(comparableMarkdown('`' + first + '\u200b' + second + '`')).not.toBe(comparableMarkdown('`' + first + second + '`'))
  expect(comparableMarkdown(first + second.replace('8guqvxe', 'aaaaaaa'))).not.toBe(comparableMarkdown(first + second))
  expect(comparableMarkdown(first + second.replace("'20261112173447-8guqvxe'", "'different label'"))).not.toBe(comparableMarkdown(first + second))
})

it.each([
  ['第一行。  \n第二行。', '第一行。\n第二行。'],
  ['`secret`', '`changed`'],
  ['```txt\na\u200bb\n```', '```txt\nab\n```'],
  ['正文\u200b内容', '正文内容'],
  ['[地址](https://one.test)', '[地址](https://two.test)'],
  ['- [ ] 未完成', '- [x] 未完成'],
  ['| a | b |\n| --- | --- |\n| 1 | 2 |', '| a | b |\n| --- | --- |\n| 1 | 3 |'],
  ['# 请求的标题\n\n正文', '正文']
])('rejects a meaningful change between %j and %j', (before, after) => {
  expect(comparableMarkdown(before)).not.toBe(comparableMarkdown(after))
})
