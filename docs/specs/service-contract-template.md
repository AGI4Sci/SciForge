# SciForge 服务契约模板 (Service Contract Template)

版本: 1.0.0 | 最后更新: 2026-06-10

---

## 1. 服务分类 (Service Taxonomy)

所有 SciForge 生态的服务必须明确自己属于以下三类之一：

| 类型 | 协议 | 调用方 | 典型用途 | 例子 |
|------|------|--------|---------|------|
| **HTTP LLM Service** | OpenAI-compatible `/v1/chat/completions` | Kun Agent Loop | 模型推理 | Model Router |
| **MCP Tool Service** | MCP stdio 或 Streamable HTTP | Kun Agent Loop → MCP Client | 工具/能力执行 | Browser, Computer Use |
| **HTTP Resource Service** | RESTful HTTP (非 LLM) | GUI Renderer 或 Agent Loop | 资源访问 | 知识库 API, 文件存储 |

**服务不得跨类型**。如果一个服务既做 LLM 推理又做工具执行，必须拆成两个独立服务。

---

## 2. HTTP LLM Service Contract

### 2.1 必须实现的端点

```
POST {baseUrl}/v1/chat/completions
```

### 2.2 请求契约

```typescript
// Kun → LLM Service
interface ChatCompletionRequest {
  model: string;                    // 模型 alias，例如 "sciforge-router"
  messages: ChatMessage[];          // 标准 OpenAI 格式
  tools?: ToolSpec[];               // 当前 turn 可用的工具列表
  stream?: boolean;                 // 必须支持 stream: true
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  reasoning_effort?: string;        // DeepSeek 扩展 (off|low|medium|high|max)
  response_format?: { type: "json_object" };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;  // JSON Schema
  };
}
```

### 2.3 响应契约 (Streaming)

```
// SSE 流，每行一个 JSON chunk
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"web_search","arguments":"{\"q"}}}]},"finish_reason":null}]}

// 最后一条带 usage
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}

data: [DONE]
```

### 2.4 必须返回的 Usage 字段

```typescript
interface UsageSnapshot {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  // DeepSeek 缓存字段（如果支持）：
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}
```

### 2.5 错误契约

```typescript
// HTTP 状态码
// 400 - 请求格式错误（模型不支持此请求格式）
// 401 - API Key 无效
// 429 - 速率限制
// 500 - 内部错误
// 503 - 服务不可用

interface ErrorResponse {
  error: {
    message: string;
    type: string;           // "invalid_request_error" | "authentication_error" | "rate_limit_error" | "server_error"
    code?: string;          // 机器可读的错误码
    param?: string;         // 出错的字段名
  };
}
```

### 2.6 Health Check

```
GET {baseUrl}/health
→ 200 {"status":"ok","version":"1.0.0","model":"sciforge-router"}
```

---

## 3. MCP Tool Service Contract

### 3.1 必须实现的 MCP 能力

每个 MCP Tool Service 必须实现以下 MCP 标准能力：

| MCP 能力 | 必须 | 说明 |
|----------|------|------|
| `tools/list` | ✅ | 返回工具列表及 JSON Schema |
| `tools/call` | ✅ | 执行工具调用 |
| `initialize` | ✅ | MCP 握手 |
| `resources/list` | 可选 | 如果有静态资源 |
| `prompts/list` | 可选 | 如果有 prompt 模板 |

### 3.2 工具定义契约 (Tool Manifest)

每个工具必须按以下 JSON Schema 定义：

```typescript
// 工具元数据（MCP tools/list 返回的每个条目）
interface McpToolDescriptor {
  name: string;                       // 工具名，snake_case，全局唯一建议加服务前缀
                                       // 例如: "browser_web_search", "cu_screenshot"
  title?: string;                     // 人类可读标题
  description: string;                // 一句话描述，会进入 agent prompt
  inputSchema: {                      // JSON Schema，定义输入参数
    type: "object";
    properties: Record<string, {
      type: string;                   // "string" | "number" | "boolean" | "object" | "array"
      description: string;
      enum?: string[];
      default?: unknown;
      items?: Record<string, unknown>;
    }>;
    required?: string[];
  };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;           // true = 纯读取，无副作用
    destructiveHint?: boolean;        // true = 破坏性操作（需要审批）
    idempotentHint?: boolean;         // true = 冪等，可安全重试
    openWorldHint?: boolean;          // true = 与外部世界交互（网络、桌面）
  };
}
```

### 3.3 工具输出契约

```typescript
// MCP tools/call 的 result.content 必须是以下结构之一：

// 成功时：
{
  "ok": true,
  "output": { /* 任意 JSON */ },
  "metadata": {
    "toolId": "browser_web_search",
    "elapsedMs": 1234,
    "refs": ["source-page-ref-1", "source-link-ref-2"],  // evidence refs
    "cacheHit": false
  }
}

// 失败时：
{
  "ok": false,
  "error": {
    "code": "RATE_LIMITED",           // 机器可读错误码
    "message": "请求过于频繁，请稍后重试",  // 人类可读消息
    "retryable": true,                // agent 可否重试
    "blockedReason": "rate_limit",    // 阻塞原因分类
    "details": {}                     // 可选附加信息
  },
  "metadata": {
    "toolId": "browser_web_search",
    "elapsedMs": 45
  }
}
```

### 3.4 错误码规范

| 错误码 | HTTP 类比 | 含义 | 默认 retryable |
|--------|----------|------|---------------|
| `INVALID_ARGUMENT` | 400 | 输入参数不符合 schema | false |
| `TIMEOUT` | 408 | 操作超时 | true |
| `RATE_LIMITED` | 429 | 速率限制 | true |
| `PERMISSION_DENIED` | 403 | 权限不足 | false |
| `UNAVAILABLE` | 503 | 服务暂时不可用 | true |
| `NOT_FOUND` | 404 | 目标资源不存在 | false |
| `BLOCKED_BY_POLICY` | 422 | 安全策略阻止 | false |
| `NEEDS_APPROVAL` | 422 | 需要用户审批 | false |
| `INTERNAL_ERROR` | 500 | 内部错误 | true |

### 3.5 工具 Policy 标签（annotations 效果）

```
readOnlyHint=true + !openWorldHint + !destructiveHint
  → policy: "auto"          (agent 可自动调用，无需审批)

readOnlyHint=true + openWorldHint=true
  → policy: "untrusted"     (agent 调用时需谨慎)

destructiveHint=true
  → policy: "on-request"    (每次调用需要审批)

无标注
  → policy: "on-request"    (默认需要审批)
```

### 3.6 Transport 选择

```
stdio:           本地工具，需要系统权限（如 Computer Use）
streamable-http: 网络工具，可部署在远程（如科学计算、可视化）
sse:             已弃用，新服务不使用
```

---

## 4. HTTP Resource Service Contract

用于非 LLM 调用、非工具执行的资源服务。

### 4.1 必须实现的端点

```
GET  {baseUrl}/health          → 健康检查
GET  {baseUrl}/manifest        → 服务清单（可选）
GET  {baseUrl}/{resource}      → 资源读取
POST {baseUrl}/{resource}      → 资源操作（可选）
```

### 4.2 Health Check

```
GET {baseUrl}/health
→ 200 {
    "status": "ok" | "degraded" | "unavailable",
    "version": "1.0.0",
    "serviceId": "sciforge-knowledge-api",
    "checkedAt": "2026-06-10T12:00:00Z",
    "dependencies": {
      "database": "ok",
      "upstream-api": "degraded"
    }
  }
```

### 4.3 Manifest（可选但推荐）

```
GET {baseUrl}/manifest
→ 200 {
    "protocolVersion": "sciforge.resources.v1",
    "serviceId": "sciforge-knowledge-api",
    "version": "1.0.0",
    "description": "SciForge 知识库 API",
    "resources": [
      {
        "path": "/papers",
        "method": "GET",
        "description": "搜索论文",
        "queryParams": { "q": "string", "limit": "number" }
      }
    ],
    "authRequired": true,
    "rateLimit": { "requestsPerMinute": 60 }
  }
```

---

## 5. 服务注册契约 (Registration Contract)

所有服务必须通过 Kun 的 MCP config 注册。以下是 GUI 的 MCP 配置 schema：

```typescript
// Kun config.json → capabilities.mcp.servers
interface McpServersConfig {
  [serverId: string]: {
    enabled: boolean;                           // 是否启用
    transport: "stdio" | "streamable-http";     // 传输协议
    trustScope: "user" | "workspace";           // 信任范围
    
    // stdio transport
    command?: string;                           // 启动命令
    args?: string[];                            // 启动参数
    env?: Record<string, string>;               // 环境变量
    cwd?: string;                               // 工作目录
    
    // streamable-http transport
    url?: string;                               // HTTP URL
    headers?: Record<string, string>;           // 请求头（含认证）
    
    // 通用
    timeoutMs?: number;                         // 超时 (默认 30000)
    description?: string;                       // 人类可读描述
  };
}
```

### 5.1 注册示例

```json
{
  "capabilities": {
    "mcp": {
      "enabled": true,
      "servers": {
        "sciforge-browser": {
          "enabled": true,
          "transport": "stdio",
          "trustScope": "workspace",
          "command": "node",
          "args": ["./mcp-servers/browser/dist/server.js"],
          "env": {
            "BROWSER_HEADLESS": "true"
          },
          "timeoutMs": 30000,
          "description": "SciForge Browser MCP — web search, read, download"
        },
        "sciforge-computer-use": {
          "enabled": true,
          "transport": "stdio",
          "trustScope": "user",
          "command": "node",
          "args": ["./mcp-servers/computer-use/dist/server.js"],
          "timeoutMs": 60000,
          "description": "SciForge Computer Use MCP — desktop automation"
        },
        "sciforge-visualization": {
          "enabled": true,
          "transport": "streamable-http",
          "trustScope": "workspace",
          "url": "http://localhost:4010/mcp",
          "headers": {
            "Authorization": "Bearer ${SCIFORGE_VIZ_API_KEY}"
          },
          "timeoutMs": 60000,
          "description": "SciForge Visualization MCP — scientific plotting"
        }
      }
    }
  }
}
```

---

## 6. 版本管理契约 (Versioning)

### 6.1 语义版本

```
MAJOR.MINOR.PATCH
  ↑     ↑     ↑
  │     │     └─ 向后兼容修复
  │     └─────── 向后兼容新功能
  └───────────── 不兼容变更

规则：
- MAJOR 变更 = 删除工具、修改现有 inputSchema required 字段、修改输出契约
- MINOR 变更 = 新增工具、新增可选字段、新增错误码
- PATCH 变更 = bug 修复、性能优化、文档更新
```

### 6.2 弃用流程

```
1. 新版本标记工具为 deprecated（在 description 中注明）
2. 最少保留 2 个 MINOR 版本的向后兼容
3. MAJOR 版本时可以删除 deprecated 工具
4. 删除前必须在 changelog 中公告
```

### 6.3 服务 Manifest 版本字段

```json
{
  "protocolVersion": "sciforge.tools.v1",  // 协议版本（很少变）
  "serviceVersion": "1.2.0",              // 服务自身版本（semver）
  "minClientVersion": "1.0.0"             // 最低兼容客户端版本
}
```

---

## 7. 安全契约 (Security)

### 7.1 API Key 管理

```
- GUI 通过 settings 存储 API key（electron-store 加密）
- MCP server 需要的 key 通过 env 注入（不硬编码）
- 所有 key 在日志/错误消息中必须被 redact
- 不得将 key 写入 tool call arguments 或 agent history
```

### 7.2 沙箱级别

```typescript
// 每个服务声明自己的沙箱要求，GUI 根据 trustScope 决定行为
type SandboxLevel =
  | "workspace-write"    // 可读写当前 workspace
  | "read-only"          // 只读（文件、网络）
  | "danger-full-access" // 完全访问（需用户显式授权）
  | "external-sandbox";  // 服务自身管理沙箱
```

### 7.3 敏感操作审批

```
满足以下任一条件，GUI 必须弹出 hard-confirm：
- annotations.destructiveHint === true
- 输出包含 error.code === "NEEDS_APPROVAL"
- trustScope === "user" 且执行写操作

hard-confirm 必须展示：
- action: 将要执行什么
- target: 作用对象
- impact: 预期影响
- evidence: 当前证据引用
```

---

## 8. 服务清单 (Service Catalog)

每个独立服务仓库必须包含 `SERVICE.md`，内容：

```markdown
# {服务名}

## 元数据
- serviceId: sciforge-browser
- type: MCP Tool Service
- protocol: MCP stdio
- version: 1.0.0
- repository: github.com/sciforge/mcp-browser

## 工具列表
| 工具名 | 描述 | Policy | 超时 |
|--------|------|--------|------|
| browser_web_search | 网页搜索 | auto | 15s |
| browser_web_read | 页面读取 | auto | 30s |
| browser_web_download | 文件下载 | on-request | 60s |

## 依赖
- 运行时: Node.js >= 20
- 系统: Playwright (会自动安装)
- 外部服务: 无

## 环境变量
- BROWSER_HEADLESS: 是否无头模式 (默认 true)
- BROWSER_TIMEOUT_MS: 页面加载超时 (默认 15000)

## 启动命令
npx sciforge-mcp-browser --headless

## 验证
curl -X POST http://localhost:{port}/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

---

## 9. 合规检查清单 (Compliance Checklist)

新服务上线前必须逐项确认：

### HTTP LLM Service

- [ ] 实现 `POST /v1/chat/completions`，兼容 OpenAI 协议
- [ ] 支持 `stream: true` (SSE)
- [ ] 返回标准 `usage` 字段 (prompt_tokens, completion_tokens, total_tokens)
- [ ] 返回标准错误格式 (error.message, error.type)
- [ ] 实现 `GET /health`
- [ ] 不将 secret/key 写入日志或响应
- [ ] 提供 `SERVICE.md` 文档

### MCP Tool Service

- [ ] 实现 MCP `initialize` 握手
- [ ] 实现 `tools/list`，每个工具有完整的 annotations
- [ ] 实现 `tools/call`，返回标准 `{ok, output, metadata}` 或 `{ok, error}`
- [ ] 每个工具输入有 JSON Schema
- [ ] 每个工具输出有明确的 `refs`（evidence refs）
- [ ] 错误码使用标准枚举
- [ ] 支持 stdio 或 streamable-http transport
- [ ] 超时后正确清理资源
- [ ] 进程退出时优雅关闭
- [ ] 提供 `SERVICE.md` 文档

### HTTP Resource Service

- [ ] 实现 `GET /health`
- [ ] 实现 `GET /manifest`（推荐）
- [ ] 返回标准 Health 格式 (status, version, checkedAt)
- [ ] 认证错误返回 401
- [ ] 提供 `SERVICE.md` 文档

---

## 10. 快速启动模板 (Quick Start)

### MCP Server (TypeScript)

```typescript
// mcp-servers/my-service/src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
  {
    name: "sciforge-my-service",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler("tools/list", async () => ({
  tools: [
    {
      name: "my_tool",
      description: "我的工具 — 做什么事",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          limit: { type: "number", description: "返回数量上限", default: 10 },
        },
        required: ["query"],
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
  ],
}));

server.setRequestHandler("tools/call", async (request) => {
  try {
    const { query, limit = 10 } = request.params.arguments as {
      query: string;
      limit?: number;
    };
    const result = await doWork(query, limit);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            output: result,
            metadata: {
              toolId: "my_tool",
              elapsedMs: 123,
              refs: ["result-ref-1"],
            },
          }),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: err instanceof Error ? err.message : String(err),
              retryable: true,
            },
            metadata: { toolId: "my_tool", elapsedMs: 0 },
          }),
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

### SERVICE.md 模板

复制 `docs/specs/SERVICE.template.md` 并填写。

---

## 11. 与 DeepSeek-GUI Kun 的粘合层

### 服务被 GUI 发现和使用的完整链路

```
1. 服务开发者
   └─ 创建独立 Git 仓库
   └─ 实现 MCP 协议 / HTTP 协议
   └─ 编写 SERVICE.md
   └─ 发布（npm / Docker / 二进制）

2. 用户
   └─ 安装服务（npm install / docker pull / 下载二进制）
   └─ 在 GUI Settings → MCP Servers 中注册
   └─ 或者编辑 config.json 添加 servers 条目

3. GUI (Kun)
   └─ 启动时读取 config.json → capabilities.mcp.servers
   └─ 为每个 enabled server 创建 MCP client
   └─ 调用 tools/list 获取工具清单
   └─ 将工具注入 agent loop 的可用工具列表
   └─ Agent 调用时，通过 MCP client.callTool() 执行

4. Agent Loop
   └─ modelStep() → LLM 决定调用某个 MCP 工具
   └─ dispatchToolCalls() → 路由到对应的 MCP client
   └─ 工具结果注入 conversation history
   └─ 继续 modelStep()，直到产生最终回答
```

### 关键约束

```
- MCP 服务不得直接调用 LLM（那应该走 HTTP LLM Service）
- MCP 服务之间不得互相调用（串糖葫芦）
- MCP 服务的错误不得让 agent loop 崩溃（必须 catch 并转为 error item）
- MCP 服务的输出不得超过 64KB（超过用 refs 引用，不内联）
```
