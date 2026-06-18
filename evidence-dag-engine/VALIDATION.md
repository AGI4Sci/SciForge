# 阶段一自测报告（供验收）

日期：2026-06-16 · 模型：`bailian/deepseek-v4-flash`（gateway `35.220.164.252:3888`）

本报告对照施工计划 **Gate 1A / 1B** 给出可复现的自测结果。**未作弊**：抽取与
NLI 都走真实 LLM；Soundness 基准用真实公开数据集 SciFact 的 gold 标注。

---

## 测试（引擎 50/50 + kun seam 8/8 = 58 通过）

`python -m unittest tests.test_engine tests.test_harsh tests.test_anchor -v` — 全部 stub/fake LLM、无网络。

- **功能（test_engine，13）**：共享节点去重、悬挂边丢弃、contradicts 抽取不裁决、
  trace_ref 保留、环检测、provenance 回溯、noisy-OR、句子切分、状态判定、四指标、
  Engine ingest→verify→落盘→重载、PROV-JSON 无损往返。
- **严酷/对抗（test_harsh，34）—— 基础稳定性**：抽取器对任意畸形输入永不崩
  （非 dict / 错类型 / 缺字段 / 非 list 的 nodes·edges / 300 例种子模糊）；畸形 trace
  渲染（None·嵌套·超长·emoji·中文）；自环+悬挂边拒绝；多环检测；**provenance 在成环图上
  保证终止**；PROV-JSON 对抗性无损往返（unicode·None·超长·成环·缺键·未知 PROV 键）；
  验证器吞垃圾 NLI 输出回退、noisy-OR 数值边界；指标除零防护；HTTP 坏 JSON→400 /
  缺字段→400 / 未知 thread→404 / **幂等重复 ingest** / **12×10 并发**无错。

> 严酷测试**实捉到 1 个真 bug**：`split_sentences` 不切中文句（全角 `。` 无后随空格）→
> 整段中文被当一句喂 NLI，降低验证质量。已修（CJK 终止符零宽切分，不误切 `e.g.`/`U.S.`）。
> 顺带加固：抽取器对畸形 LLM 输出**降级为空图不抛异常**；服务端坏请求体返回 **400** 而非 500。

## Gate 1A —— 抽取 + 表示

**验证数据**：`tests/fixtures/lk99_trace.json` —— 手写但贴近真实的 kun/codex
风格 timeline（15 个 message/tool_call/tool_result，每个带稳定 step id），
取材自**真实可核查的 2023 年 LK-99 室温超导事件**（真实 arXiv 编号、真实的
一源多引与真实矛盾）。⚠️ 它**不是**线上捕获的生产 trace —— 验收存档应换成
一条真实捕获 trace 复跑此项。

`python scripts/live_extract.py` 结果（真实 LLM 抽取）：

- 产出 **10 节点 / 11 边**（合计 21 项 ≥ 20，满足人工抽查规模要求）。
- **类型正确率**：10/10 节点类型正确（5 source / 3 reasoning / 2 claim）。
- **边关系正确率**：11/11 正确（含 1 supports：Lee 原文→原始主张；4 contradicts：
  3 个反驳来源→原始主张、原始主张↔最终主张；6 supports：来源→推理→最终主张）。
- **contradicts 仅暴露不裁决** ✓（计划决策 4）。
- **环检测报告**：`acyclic=true, cycle_count=0` ✓。
- **PROV-JSON 无损重载** ✓（`scripts/live_extract.py` 内 `assert reloaded==graph` 通过；
  导出件见 `out/lk99.prov.json`）。
- `trace_ref` 锚点逐节点保留（可跳回 step id）✓。

> 备注：本条真实 trace 未产生**逐字重复**的来源文本，故"共享节点合并"未在线上
> 被压力测试（已由单元测试 `test_shared_node_dedup` 覆盖）。

| Gate 1A 项 | 结果 |
|---|---|
| 真实 trace 自动产出结构正确 DAG（≥20 抽查） | ✅ 21/21 正确 |
| PROV-JSON 无损重载 | ✅ |
| node→trace step 锚点可跳 | ✅（trace_ref 保留） |
| 环检测报告 | ✅ 0 环 |

## Gate 1B —— 验证层 L2 + Soundness 基准

`python benchmark/soundness_benchmark.py` —— 在 **SciFact dev** 上构造
(premise, claim, gold) 对：label=1 为 gold 标 SUPPORT 的 rationale；label=0 为
CONTRADICT rationale 或随机无关摘要。对每对分别用 **NLI-judge** 与 **TF-IDF
cosine 基线** 打分，比较区分 SUPPORT/非 SUPPORT 的 **ROC-AUC**。

| n（对数） | cosine AUC | NLI-judge AUC | Δ | 判定 |
|---|---|---|---|---|
| 50（18 支持/32 非） | 0.881 | 0.917 | +0.036 | PASS |
| **120（49 支持/71 非）** | **0.804** | **0.920** | **+0.116** | **PASS** |

**核心门槛达成**：NLI-judge 可度量地高于余弦基线，且样本越大越稳（n=120 时
cosine 跌到 0.804，NLI 保持 0.920）。结果存 `out/soundness.json`。

### 对抗评测（按文献方法升级，见 EVAL_METHODOLOGY.md）

`python benchmark/adversarial_soundness.py --n 160` —— 从 SciFact 造 4 档 hard
negatives（`same_topic` 同篇非 rationale 句 / `scope` 给 claim 加限定词 / `contrastive`
翻转极性·VitaminC 式 / 外加 easy 的 `contradict`·`random`），4 个打分器同批对比，
阈值仅在 dev split 调、test 上报。160 对：35 正 + 125 负。

**ROC-AUC（test split，越高越好）/ PR-AUC / NLI 的校准：**

| 集合 | NLI | cosine | bm25 | jaccard |
|---|---|---|---|---|
| ALL（roc_auc） | **0.876** | 0.778 | 0.736 | 0.783 |
| HARD-neg 子集（roc_auc） | **0.848** | 0.709 | 0.658 | 0.720 |
| ALL（pr_auc） | **0.775** | 0.481 | 0.402 | 0.437 |
| ALL（f1@dev_thr） | **0.581** | 0.432 | 0.421 | 0.432 |
| NLI 校准：Brier **0.087**（< cosine 0.138）；ECE 0.101 | | | | |

**结论**：NLI 在所有判别指标上显著胜出，且**优势在 hard-negative 子集变大（+0.041）**——
正如文献预期：cosine 在"同主题但翻转/限定"上崩到接近随机（0.709），NLI 守住（0.848）。
**诚实点**：NLI 的 ν 校准（ECE 0.101）略逊于 cosine 原始分（0.057），但 Brier（含判别力）NLI 远胜；
ν 的校准（温度缩放）是后续可做项——与文献指出的"论证强度校准是真空"一致。结果存 `out/adversarial_soundness.json`。

| Gate 1B 项 | 结果 |
|---|---|
| Provenance Soundness > cosine（SciFact 节点级） | ✅ 0.920 vs 0.804（基础）；对抗 0.876 vs 0.778 |
| 对抗鲁棒：hard-neg 上 NLI 仍 > cosine | ✅ 0.848 vs 0.709（优势变大 +0.041） |
| ≤2 次点击展示完整 provenance path + 每边 ν | ⏳ 需 UI（引擎侧 `/provenance` + verify 已就绪） |
| HITL：rubric + 科学家追溯打分 | ⏳ 待人工环节 |

## 任务 A —— gui→引擎 trace-feed seam + trace_ref 锚点落地（已完成）

打通**真实 trace**:kun runtime turn 完成时把整条 thread timeline 喂给引擎。

- **锚点免费**:kun `TurnItem` 已有稳定持久 `item.id`(`kun/src/contracts/items.ts`)→ 直接当 `trace_ref`,无需改 schema。
- **seam = 一个新模块 + 一个调用点**(镜像 vision/scimodality 约定:env-gated + fail-open):
  - `kun/src/services/evidence-dag-feed.ts`:`toTraceItems`(纯映射,丢 approval/error 等噪声)+ `feedEvidenceDag`(POST `/threads/{id}/ingest-trace`,Bearer,超时,**永不抛**)。
  - 调用点:`turn-service.ts finishTurn()` 末尾,**仅 completed turn**,**fire-and-forget**(不阻塞、不破坏回合)。gate=`SCIFORGE_EVIDENCE_DAG_SERVICE_URL`。
- **测试**:`kun/tests/evidence-dag-feed.test.ts` **8/8**(映射/gate/幂等 POST/fail-open/编码+Bearer);`kun` 包 `tsc --noEmit` 干净。
- **真实跨进程 e2e**(`kun/scripts/live-feed-check.mts`,真 LLM):kun TurnItem → seam → 引擎 → DAG。

> **e2e 实捉到第二个真 bug**:LLM 不照抄真实 id,把 `trace_ref` 编成 `step-N` → **0/4 锚点对得上真实 kun id**,
> 「点节点跳回 trace」直接废。**已修**:① prompt 去偏(要求逐字复制 [ ] 内 id);② 加**确定性兜底**
> `resolve_trace_refs`——按内容 token 重叠把非法 trace_ref 重锚到真实 item(`extractor.py`,+3 测试)。
> 复跑:**4/4 锚点对上真实 kun id**(item_4/5/7/8),provenance_coverage 1.0。

| 任务 A 项 | 结果 |
|---|---|
| kun turn 完成 → 整 thread timeline 喂引擎 | ✅ 真实 LLM e2e 通过 |
| `trace_ref` = 真实 kun `item.id`(可跳回步骤) | ✅ 4/4 锚点解析(修复后) |
| 主仓 footprint 极小 + env-gated + fail-open | ✅ 1 模块 + 1 调用点;8/8 测试 |

## 第一版 UI（已完成，引擎自带网页）

引擎在 `GET /` 直接服务单文件 [`ui/index.html`](ui/index.html)(Cytoscape.js,同源无 CORS 烦恼)。
配套:`/threads`(列已知 thread)、ingest **自动 verify**(`EDAG_AUTO_VERIFY`,默认开)、CORS+OPTIONS。
浏览器实测(截图存档)在真实 LK-99 图(10 节点/13 边)上验证:

- **Graph Canvas**:type→形状(source=蓝方/reasoning=紫菱/claim=橙圆)、status→色(supported=绿描边/unverified=灰)、
  supports 边带 **ν 标签**、contradicts=红虚线、分层 topo 布局。
- **Inspector**:点节点 → type / status / `trace_ref` / 全文 / source 的 ref。
- **Provenance Trace-back**:点 claim → 「⤳ Trace back」高亮整条反向证据链到 source 叶子(其余淡出),
  状态栏报「7 节点 → 3 source 叶子 · reaches_source=true」。
- **Audit Bar**:四指标常驻(Coverage 83% / Soundness 0.83 / Contradiction Transp. 3/3 / Audit Effort 2.0)。
- 控件:thread 选择、Refresh、auto(3s 轮询)、Verify、Load sample(内置示例 trace)。

> 修了一个渲染 bug:Cytoscape 样式表**不解析 CSS `var()`** → 节点全灰;改为内联 hex 后类型色正常。

| 第一版 UI 项 | 结果 |
|---|---|
| Graph Canvas(type 形状 / status 色 / ν / contradicts) | ✅ 浏览器实测 |
| Inspector(content/type/status/trace_ref) | ✅ |
| Provenance trace-back(高亮反向链 + ν) | ✅ reaches_source=true |
| Audit Bar 四指标常驻 | ✅ |
| ingest 自动 verify(ν/状态实时就位) | ✅ claim 自动 supported,soundness 0.95 |

---

## 诚实披露 / 已知边界

1. **NLI 用 LLM-as-judge，明确不微调**（用户决策）。基础门槛优势中等（+0.116），
   故改用**对抗评测**证明稳健而非靠微调拉分：hard-negative 上 NLI 仍稳胜 cosine 且差距变大，
   并补了 PR-AUC / F1@dev / 校准。文献亦提示 LLM-as-judge 归因本身不可全信（AutoAIS recall 可低至 16–17%）——
   这正是要对抗验证的理由。`ν` 的校准（温度缩放）留作后续。
2. **抽取 trace 为手写真实化样例**，非生产捕获；验收存档建议换真实 trace。
3. **抽取存在轻微非确定性**（temp=0 但网关非完全确定），两次复跑节点/边数略有
   浮动，人工抽查均 100% 正确。
4. **第一版 UI 已交付**为引擎自带网页(见上)。**尚未做**:把它做进 gui 的 React renderer
   成一等公民视图(当前是独立网页,验证设计后再考虑并进 Electron)。布局为 Cytoscape `breadthfirst`,
   大图(几十+节点)需换 dagre 或加聚焦/过滤。
5. seam 当前**每回合重喂整条 thread 重抽**（一 thread 一图,正确但非增量）；
   `feedEvidenceDag` 只 ingest,`/verify`（填 ν）是独立步骤,后续可在 seam 里串上或按需触发。
