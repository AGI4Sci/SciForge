# Semantic Module Engineering

最后更新：2026-05-31

本文补齐 `Architecture.md` 中的 Agent Host Semantic Pipeline 细化设计。它描述如何把 UI、memory、skills、tools、project、artifact 和 Computer Use 都工程化为 typed resource graph 上的模块，而不是把 GUI、runtime adapter 或单个 capability 做成第二个 agent host。

## 核心模型

Semantic module engineering 有三个基本对象：

| 对象 | 含义 | 不变规则 |
|---|---|---|
| Resource | 可被引用、读取、展示或审计的对象。 | 大对象、敏感材料和可复用 evidence 必须用 ref，不内联 raw payload。 |
| Module | 暴露一组标准函数的能力边界。 | 公共入口只能是 `module.describe/query/read/invoke` 或 host 原生等价 surface。 |
| Pipeline Trace | Agent Host 串联模块时留下的 typed step ledger。 | 跨模块组合、approval、repair、completion 由 Agent Host 记录，模块不能偷偷串联其它模块。 |

Resource graph 的边必须表达语义关系，而不是实现调用关系。例如 `run -> artifact`、`observation -> screenshotRef`、`cursorEvent -> screenRef`、`verification -> evidenceRef` 是资源关系；`React component imported provider` 或 `runtime bridge called GUI directly` 不是合法语义边。

## L0/L1/L2 规则

| 层级 | 拥有什么 | 不拥有 |
|---|---|---|
| L2 Root Agent Host | 任务目标、模块选择、跨模块 pipeline、approval、repair、用户级 completion、pipeline trace。 | 单个模块的内部 cache、provider session 或 UI renderer。 |
| L1 Resource Adapter | 同一资源域的 session、cache、refs、events、version compatibility、backend lifecycle 和 L0 routing。 | 跨模块 planning、capability ranking、prompt route、workspace write policy、用户级 completion。 |
| L0 Handler | 一个具体动作，如 read、search、capture、ground、execute、verify、writeTrace、emitEvent。 | 调其它任务模块、直接操作 GUI、决定下一步或判断整个任务完成。 |

L1 不是小型 agent。它可以把一类资源整理成稳定接口，但不能扩大 Agent Host 看到的公共 API 面。L2 看到的入口仍是 `module.describe/query/read/invoke`、Codex native tool/plugin/MCP，或 host 原生等价机制。

## Resource Graph 设计

一个 resource 至少应有：

- 稳定 ref，例如 `gui:/hot-region.json`、`artifact:report.md`、`computer-use:evidence/<id>`。
- resource kind、owner module、schemaVersion 和 disclosure level。
- provenance，包括产生它的 run、operation、handler、source refs 和时间。
- freshness 或 invalidation 规则，尤其是可见状态、外部系统状态和 verifier evidence。
- size/hash metadata。大 payload 只放 bundle/local store，主结果只放 ref 和摘要。

关系边应优先表达为字段中的 ref 列表：

```json
{
  "schemaVersion": "sciforge.resource-node.v1",
  "ref": "computer-use:replay/bundle-123",
  "kind": "computer-use.replay-bundle",
  "ownerModule": "actions",
  "sourceRefs": ["computer-use:evidence/obs-1", "computer-use:trace/action-7"],
  "producedBy": {
    "moduleId": "actions",
    "intent": "execute",
    "operationRef": "operation:cu-123"
  }
}
```

## Import Boundaries

Semantic resource edges do not justify source imports. Use this rule:

| From | May import | Must not import |
|---|---|---|
| TUI capability package | shared contracts, package-private helpers, provider SDKs behind host ports. | React/UI, GUI renderer registry, `src/ui/**`, GUI private state. |
| GUI presentation package | shared contracts, GUI design system, presentation helpers. | TUI provider wrappers, action providers, workspace/runtime execution adapters. |
| Shared contract package | pure types, validators, normalizers. | TUI-owned packages, GUI-owned packages, filesystem/provider/runtime code. |
| `src/runtime/**` host assembly | shared contracts, TUI-owned packages, host-specific adapters. | React components or GUI renderer internals. |
| `src/ui/**` host assembly | shared contracts, GUI-owned presentation packages, GUI-local adapters. | Computer Use action provider, observe provider implementation, runtime bridge internals. |

If a module needs another module's data, it should return refs or ask L2 to call `module.read/query/invoke`. It should not import the other module's implementation.

## Computer Use Mapping

Computer Use is the strictest application of this model because it combines visible state, external side effects and replay evidence.

| Resource | Owner | Notes |
|---|---|---|
| `VirtualDesktopSession` | L1 Computer Use resource adapter | Session root tying display group, actors, evidence ledger and replay bundle together. |
| `VirtualDisplayGroup` | L1 | Collaboration space display topology. Docker/container is only backend packaging, not the concurrency model. |
| `VirtualScreen` | L1 | Stable screen identity, geometry, scale, backend binding, capture source and window namespace. |
| `ActorCursor` and cursor log | L1 | Presence, move, point, annotate and proposal state. Cursor movement is not a mutating GUI action. |
| `ActionProposal` | L1 contract plus L0 validation | Actor/cursor/screen/window provenance, risk, target scope and required approval. |
| `ExecutorLease` | L1 scheduler | Window-local or screen-global lease with owner, timeout, cancellation and stale-evidence invalidation rules. |
| `ExecutorEvent` | L0 executor handler | Concrete click/type/drag/scroll/hotkey/open-menu/save event, never bare global coordinates. |
| Observation and grounding refs | `packages/observe/vision` plus L0 capture/ground handlers | Read-only evidence with screen/window provenance and no inline screenshots. |
| Replay bundle and viewer overlay refs | L1 trace/replay contract, GUI presentation renderer | Multi-screen frames, cursor overlays, lease owner and source evidence refs. GUI renders only. |
| Acceptance verdict | L2 plus verifier | Computer Use may return domain-local verdict or candidate completion refs; user-level success belongs to L2. |

Computer Use public execution must enter through Codex app-server native tool/plugin/MCP in production, or through Codex CLI/native plugin as a debug path. `CodexExecJsonAdapter`, `AgentServer`, runtime gateway and GUI `/computer-use` Workspace Gateway paths are legacy/test-only/diagnostic shims. They may read or replay old traces, but they must not become new public API or product fallback.

## Allowed And Forbidden For Computer Use L1

Allowed for L1:

- Manage display group, screen, actor cursor, input queue, executor lease, evidence ledger and replay refs.
- Track backend/provider readiness, version compatibility and resource lifecycle.
- Route to L0 handlers and normalize L0 results into refs-first events.
- Enforce fail-closed checks for missing provenance, stale evidence, missing lease, unsupported backend and shared-input isolation risk.
- Return `blocked`, `needs-confirmation`, `approvalRequest`, `repairHint`, `candidateCompletionRefs` or compact domain-local results.

Forbidden for L1:

- Choose browser/file/verifier/gui next steps or call those modules directly.
- Rank capabilities, choose provider route, assemble hidden prompts or own retry/repair policy.
- Treat a Computer Use domain-local verdict as user-level completion.
- Import GUI renderer implementation, Workbench, AnnotationSidebar, `src/ui/**`, or runtime-private bridge code.
- Accept naked global coordinates, placeholder-only viewer evidence, cross-bundle refs or inline raw screenshot/base64 payloads as acceptance evidence.

## Engineering Checklist

When adding a module or resource:

1. Define the ref shape and owner.
2. Decide if a simple L0 handler is enough.
3. Add L1 only when multiple L0 handlers share one resource lifecycle.
4. Keep cross-module order in L2 pipeline trace.
5. Put raw payloads behind refs and add no-secret validation.
6. State import boundaries before adding implementation imports.
7. Make legacy/test-only adapters explicit in names, manifests and docs.
