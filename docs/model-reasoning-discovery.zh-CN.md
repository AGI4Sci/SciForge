# 模型思考档位自动识别与展示（设计说明 · 词表维护规则 · 回退方式）

本文件对应 `feat/model-reasoning-discovery` 的交付，覆盖：档位词表、绑定后自动检查、
三态与来源的表达、缓存与主动探测的语义边界。

## 1. 目的与本次范围

**做什么**：绑定模型 API 之后，回答"这个模型有哪些思考档位"。证据强弱固定为
**上游声明 > 词表 > 未知**；未知一律降级，绝不猜测、绝不阻断模型配置。

**本次交付**：

- 词表（`src/main/model-reasoning/reasoning-levels.ts`）：只收**有据**条目，精确匹配；
- 发现服务（`reasoning-discovery.ts`）：上游优先、词表兜底、失败降级不缓存、缓存按接入分键；
- 服务层（`service.ts`）+ IPC（`modelReasoning:discover | probe | cancel`）+ preload 类型；
- 应用装配（`src/main/index.ts`）与开发桥白名单；
- 单元测试 37 项 + 真实应用验收脚本。

**本次不交付（明确列出，避免误读）**：

- 设置页/档位选择处的**可视化接入**（状态、来源、刷新按钮）——见第 7 节"未完成"；
- 主动探测的**真实执行器**：入口与语义已实现，但普通用户不开放；
- 任何**真实上游的档位枚举验证**（本轮全部为 mock 与仓库既有凭据的历史记录）。

## 2. 三态与来源

| 状态 | 含义 | 展示要求 |
| --- | --- | --- |
| `known` | 有证据：给出档位列表 | 必须同时给出**来源**与**完整性** |
| `unsupported` | 上游**明确**说该模型没有档位 | 不得被词表覆盖；不得显示成"未知" |
| `unknown` | 没有证据 | **不得**显示成"不支持"；不得因此阻断配置 |

来源字段独立记录：`upstream` / `vocabulary` / `cache` / `none`，并保留 `verifiedAt`。
`completeness` 区分**完整声明**与**部分验证**：部分验证**不得**被当作完整档位列表，
也**不得**因此禁止用户选择列表之外的档位（人工输入框保持原样）。

## 3. 词表维护规则

1. **只收有据条目**：每条必须有 `source` 与 `verifiedAt`；没有一手验证就不写。
2. **不凭名称猜测**：不做前缀/家族匹配。`deepseek-v4-flash` 与 `deepseek-v4` 必须落 `unknown`，
   即使 `deepseek-v4-flash-0731` 已有条目。
3. **部分知识记成部分**：只验证过"显式 `high` 被接受"，就写 `levels: ['high']` + `completeness: 'partial'`，
   **不要**补全成完整阶梯；单次成功**不代表**思考效果，也不代表枚举完整。
4. **协议按实测请求体形状记**：`{"model":…,"messages":[…]}` ⇒ `chat-completions`；
   带 `input` ⇒ `responses`；`anthropic-messages` 另算。记错协议会让条目在真实链路上**永不命中**。
5. **端点无关条目匹配任意端点**，端点特定条目优先；两者都要有用例覆盖。
6. **`declaredUnsupported` 与 `levels` 互斥**；既无 levels 又非 unsupported 视为"无证据"。
7. 规则由 `reasoningLevelTableIssues()` 机器校验（重复条目、缺 source、缺 completeness、
   unsupported 带档位、首尾空格都会被拒），并有测试固定这些不变量。

## 4. 发现顺序与失败语义

1. 上游声明（若宿主注入了 `declarationProvider`）；
2. 词表；
3. `unknown`。

- 上游 `declared-unsupported` 是**终局**：词表不介入。
- 检查抛错 → `unknown`，**不缓存**（下次重试），**不阻断**绑定或对话。
- `unknown` 的默认行为 = **不携带任何 reasoning 参数**（延续线上事故后确立的安全默认）。

## 5. 缓存

- 键 = `provider + model + protocol + endpoint`（缺任一都可能把 A 接入的结论用到 B 上）。
- 有 TTL（默认 10 分钟）、显式失效（`invalidate`）、强制刷新（`force: true`）。
- 只缓存成功的检查；失败不写缓存。
- 缓存中不含密钥、不含请求正文。

## 6. 主动探测（本期不作为必交项）

- 只能由用户显式触发；本期**不在 UI 开放**。
- 有次数上限（默认 6）、单次超时（默认 20s）、可取消（按 `requestId`），并发上限 1。
- 结果语义固定为 `parameter-accepted-only`：**只代表参数被上游接受**，
  不宣称思考档位真的生效；**不写回词表**、**不进声明缓存**。
- 未配置执行器时如实返回 `probe runner is not configured in this build`，不假装发过请求。

## 7. 未完成与已知限制

1. **展示层未接入**：设置页与档位选择处的三态/来源/刷新入口尚未实现，`modelReasoning:*`
   目前通过 IPC 可用但界面未消费。这是紧随其后的下一提交。
2. **上游声明通道预留**：`declarationProvider` 已可注入；应用侧尚未接 `AgentRuntimeHost`
   的模型目录，因此当前实际生效的是"词表兜底"。目录中"没有档位条目"按 `unknown` 处理
   （而非"不支持"），避免误伤词表与误报用户。
3. **词表目前只有 1 条**（#83 的实测记录）；其余模型保持 `unknown`，符合"无可靠依据不猜"。
4. **真实上游验证未做**：本轮未产生新的付费调用；`verifiedAt` 全部来自仓库既有记录。

## 8. 回退方式

- **整体回退**：`git revert` 本分支的两个提交（不涉及任何公共接口与既有契约）。
- **只关功能**：从 `registerAppIpcHandlers` 的装配里去掉 `modelReasoning` 一行，
  IPC 会以"unavailable in this Host"拒绝，其余行为不变。
- **只收窄词表**：清空 `REASONING_LEVEL_TABLE.entries`，所有模型回到 `unknown`
  （即"不携带档位"），无副作用。
- **不改动**：`provider-compat.ts` 的档位映射、`/v1/models` 的 `null/[]` 语义、
  用户显式选择的透传行为，本 PR 全部保持原样。

## 9. 复验命令

```bash
# 单元与集成
npx vitest run src/main/model-reasoning src/main/ipc
npx tsc -p tsconfig.node.json --noEmit && npx tsc -p tsconfig.web.json --noEmit

# 真实应用（需先 npm run dev，隔离实例）
SCIFORGE_DEV_INSTANCE_ID=model-reasoning-verify npm run dev
python3 scripts/model-reasoning-app-verify.py
```