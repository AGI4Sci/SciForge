# Kun Research Search 功能说明

本文档说明 Kun runtime 新增的 `research_search` 能力。该功能面向 AI4S 场景的科研调研，不是通用 Google 搜索替代品；它会把论文检索、CNS 官网检索和有限的网页检索结果作为内部证据，再交给模型生成面向用户的自然语言总结。

## 目标

`research_search` 解决的是“用户用一句很短的话提出科研调研需求”的场景，例如：

```text
帮我调研一下 AI protein design 方向最新发展
```

期望行为是：

- 自动识别这是科研调研/最新进展类请求。
- 自动调用 `research_search`，不要求用户手写工具参数。
- 优先覆盖 arXiv、bioRxiv、Semantic Scholar 和 CNS 官网结果。
- 工具返回结构化证据后，由模型用中文总结主要方向、代表论文/网页、证据来源和当前 gap。
- 不直接把 raw JSON 返回给用户。
- 同一个用户回合内避免重复调用同一个搜索工具，防止 tool loop；后续新用户回合仍可以再次搜索。

## 工具接口

工具名：

```text
research_search
```

输入参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | 是 | 用户调研主题或检索问题。 |
| `intent` | enum | 否 | `overview`、`latest`、`baseline`、`sota`、`dataset`、`code`、`gap`。 |
| `domain` | enum | 否 | `ai4s`、`biology`、`chemistry`、`materials`、`physics`、`climate`、`general`。 |
| `sinceYear` | number | 否 | 只关注某一年之后的结果，适合“最新进展”。 |
| `maxResults` | number | 否 | 返回上限，受 runtime 配置的 `maxResults` 限制。 |
| `sources` | string[] | 否 | 可选值：`arxiv`、`biorxiv`、`semantic_scholar`、`web`、`cns`。不传时使用当前启用的全部 source。 |

典型内部调用：

```json
{
  "query": "AI protein design latest developments",
  "intent": "latest",
  "domain": "biology",
  "sinceYear": 2025,
  "maxResults": 10,
  "sources": ["arxiv", "biorxiv", "semantic_scholar", "cns"]
}
```

## 数据源

当前实现支持 5 类 source：

| Source | 用途 | API Key | 备注 |
| --- | --- | --- | --- |
| `arxiv` | 检索 arXiv 预印本。 | 不需要 | 免费公开接口。 |
| `biorxiv` | 检索 bioRxiv 预印本。 | 不需要 | 免费公开接口。 |
| `semantic_scholar` | 获取论文元数据、摘要、年份、引用等。 | 推荐配置 | 未配置 key 时仍可能可用，但更容易受限。 |
| `web` | 通用网页补充检索。 | 需要 Tavily key | 用于补足论文库之外的信息。 |
| `cns` | Nature、Science、Cell 官网定向检索。 | 需要 Tavily key | 默认域名为 `nature.com`、`science.org`、`cell.com`。 |

注意：CNS 官网检索不是直接抓取每个站点的私有 API，而是通过 Tavily 做域名约束搜索，因此可用性取决于 Tavily 配额、站点可访问性和索引结果质量。

## 配置

Research capability 位于 Kun capability config 的 `research` 节点。示例：

```json
{
  "capabilities": {
    "research": {
      "enabled": true,
      "arxivEnabled": true,
      "biorxivEnabled": true,
      "semanticScholarEnabled": true,
      "tavilyEnabled": true,
      "cnsEnabled": true,
      "semanticScholarApiKey": "<SEMANTIC_SCHOLAR_API_KEY>",
      "tavilyApiKey": "<TAVILY_API_KEY>",
      "cnsDomains": ["nature.com", "science.org", "cell.com"],
      "defaultSinceYear": 2024,
      "maxResults": 10,
      "timeoutMs": 15000
    }
  }
}
```

不要把真实 API key 提交到仓库。实际 key 应只保存在本机 Kun 配置或用户环境中。PR 中只应出现占位符。

配置项说明：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 是否启用 research capability。 |
| `arxivEnabled` | `true` | 是否启用 arXiv provider。 |
| `biorxivEnabled` | `true` | 是否启用 bioRxiv provider。 |
| `semanticScholarEnabled` | `true` | 是否启用 Semantic Scholar provider。 |
| `tavilyEnabled` | `false` | 是否启用 Tavily 通用网页搜索。 |
| `cnsEnabled` | `false` | 是否启用 CNS 官网定向搜索。 |
| `semanticScholarApiKey` | `""` | Semantic Scholar API key。 |
| `tavilyApiKey` | `""` | Tavily API key，用于 `web` 和 `cns`。 |
| `cnsDomains` | `["nature.com", "science.org", "cell.com"]` | CNS 官网检索域名。 |
| `defaultSinceYear` | 未设置 | 默认时间过滤年份。 |
| `maxResults` | `10` | 单次工具调用最大结果数，硬上限为 50。 |
| `timeoutMs` | `15000` | 单 provider 请求超时，硬上限为 60000 ms。 |

## 执行流程

一次科研调研请求的执行路径如下：

1. Agent loop 判断用户请求是否属于科研调研意图，例如“调研”“最新进展”“SOTA”“gap”“baseline”等。
2. 如果 research capability 可用，本回合只向模型暴露 `research_search`，并注入调用要求。
3. `research_search` 根据 `query / intent / domain` 生成最多 3 个子查询。
4. 启用的 provider 并发检索，包括 arXiv、bioRxiv、Semantic Scholar、Tavily 和 CNS 定向搜索。
5. 工具对论文和网页结果做归一化、去重、合并和排序。
6. 工具返回内部证据，包括 `papers`、`webResults`、`themes`、`gaps`、`suggestedFollowups`、`diagnostics` 和 `citations`。
7. 工具成功返回后，同一回合不再继续暴露搜索/抓取工具，让模型基于证据直接合成最终回答。
8. 如果用户在后续新回合再次提出新的调研问题，可以再次触发 `research_search`。

这个设计的关键点是“搜索一次，然后总结”。它降低了重复搜索、同参 tool loop 和 raw JSON 泄漏给用户的概率。

## 输出形态

面向用户的最终回答应是自然语言总结，而不是工具原始结构。例如：

- 先给出 3-5 条主要趋势。
- 列出代表论文或网页，并包含标题、年份、来源和 URL。
- 说明证据主要来自哪些 provider。
- 明确当前资料的局限和可能的 research gap。
- 如果某个 provider 失败或没有返回结果，应在回答中简短说明。

`research_search` 的结构化输出只作为内部证据使用，除非用户明确要求查看 raw data。

## 费用和频率限制

不同 provider 的限制不同：

- arXiv：公开免费接口，不需要 key；应避免高频重复请求。
- bioRxiv：公开免费接口，不需要 key；应避免高频重复请求。
- Semantic Scholar：有公开 API 和限流策略，配置 API key 后通常更稳定。
- Tavily：按账号配额或套餐计费，是 `web` 和 `cns` 搜索的主要成本来源。

当前实现通过以下方式降低调用成本：

- 默认一次用户调研请求只调用一次 `research_search`。
- 单次工具调用最多扩展 3 个子查询。
- `maxResults` 默认 10，并受配置上限控制。
- 同一回合工具成功后不再暴露搜索工具，避免模型重复搜索。

## 与通用 Web Search 的区别

Kun 中的 `web.search` 和 `research_search` 是两个不同能力：

- `web.search` 是通用网页搜索能力，可能在配置中关闭。
- `research_search` 是 AI4S/科研调研能力，有独立的 `research` 配置和 provider 诊断。

因此看到 “web search is disabled by config” 不代表 `research_search` 不可用。判断科研搜索是否可用，应查看 runtime capability manifest 中的 `research` 状态。

## 已知限制

Stage 1 仍是检索和摘要级能力，不是完整论文阅读系统：

- 不会自动下载并深读所有 PDF。
- CNS 结果依赖 Tavily 对官网内容的索引和站点访问情况。
- bioRxiv provider 主要依赖 bioRxiv details API，再做本地过滤，结果质量受 API 返回窗口影响。
- 当前排序偏保守，主要根据标题、摘要、年份、引用和 source 合并信息判断相关性。
- 工具无法保证“最新”覆盖所有当天发布内容，仍受上游索引延迟影响。

后续 Stage 2/3 可以继续补充 PDF 解析、引用图谱、跨轮 research memory、主动追问和多步 agent planning。

## 验证方式

推荐的手工 E2E prompt：

```text
帮我调研一下 AI protein design 方向最新发展
```

预期：

- 本回合会自动调用一次 `research_search`。
- 参数会自动推断为最新进展类调研，domain 通常为 biology 或 ai4s。
- 最终回答是中文总结，不是 raw JSON。
- 回答中会包含代表论文/网页、来源和 gap。
- 在同一回合不会反复调用同一个工具。

推荐的自动化验证：

```powershell
npm --prefix kun run test -- research-search.test.ts
npm --prefix kun run test -- loop.test.ts -t "research"
npm --prefix kun run typecheck
npm --prefix kun run build
```

这些测试覆盖：

- `research_search` 工具注册、provider 聚合、去重和诊断。
- Tavily key 缺失时的 provider 可用性报告。
- 短 prompt 自动路由到 `research_search`。
- 工具成功返回后同一回合不再重复暴露搜索工具。
- 同一个聊天中的后续新用户回合仍可再次触发科研搜索。

