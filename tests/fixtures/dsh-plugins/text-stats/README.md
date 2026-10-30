# 文本统计（@sciforge/plugin-text-stats）

统计一段文本的字符数、中文/拉丁词数、行数、段落数和 UTF-8 字节数。**纯本地计算**：不联网、不读文件、不写文件、不需要账号。

## 用途与口径

| 字段 | 口径 |
|---|---|
| `characters` | Unicode 码点数量。不是 UTF-16 长度，也不是字素簇：一个由两个码点组成的 emoji 算 2。 |
| `cjkCharacters` | 中日韩文字：CJK 表意（U+3400–U+4DBF、U+4E00–U+9FFF、U+F900–U+FAFF）、假名（U+3040–U+30FF）、谚文音节（U+AC00–U+D7AF）。 |
| `latinWords` | 由空白或标点分隔、且**至少含一个拉丁字母**的字母数字串（允许 `-` `'` `’` 连接）。纯数字不算词。 |
| `words` | `cjkCharacters + latinWords`（中西文混合口径，随结果一起返回，不用猜）。 |
| `lines` | 按 LF / CRLF / CR 分行；**末尾单个换行不额外算一行**。 |
| `paragraphs` | 空行分隔的块（仅含空白的行也算空行）。 |
| `whitespaceCharacters` | Unicode 空白类码点。 |
| `utf8Bytes` | UTF-8 字节数（落盘占用）。 |
| `estimatedReadingMinutes` | 估算：`latinWords/200 + cjkCharacters/400`，保留 1 位小数。是估算，不是测量。 |

上限：单次最多 **1,000,000** 个码点，超出返回 `text_too_long`（有界失败，不耗尽资源）。

## 工具

- `text_stats_count`：入参 `{ text: string }`，返回上表字段 + `rulesVersion`。
- `text_stats_explain`：无入参，返回完整口径说明、上限与三个可对照的示例。

两个工具都返回 `{ ok: true, result }` 或 `{ ok: false, error: { code, message } }`，不抛异常给调用方。

## 使用示例

```
text_stats_count { "text": "SciForge 你好 world" }
→ { "ok": true, "result": { "characters": 17, "cjkCharacters": 2, "latinWords": 2,
                            "words": 4, "lines": 1, "paragraphs": 1, "utf8Bytes": 20, ... } }
```

## 依赖与平台

- 宿主提供：`@deepseek-ai/dsh-tools`（工具注册）。
- 随包携带：插件自身代码（esbuild 打成单文件 `dist/main.js`）。
- 无原生依赖、无 Python 依赖，macOS / Linux / Windows 均可运行（仅用 Node 标准能力）。

## 开发

```bash
npm run build     # esbuild 打包到 dist/main.js
npm test          # 先构建，再跑 tests/（node:test）
```

## 权限

- `text-stats.count` → `compute`（只做本地计算）
- `text-stats.explain` → `read`

不申请任何文件系统、网络或工作区写入权限。